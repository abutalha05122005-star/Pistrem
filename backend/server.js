/**
 * 🛰️ PiStream Torrent Streamer API Gateway
 * Core express router powering multi-source searches, torrent pipe creations,
 * secure ranges streaming streams, and scheduled storage cleanups.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { createClient } = require('redis');
const { searchAllTorrents } = require('./scrapers');
const { 
  startTorrentStream, 
  serveByteRangeStream, 
  serveTransmuxedStream, 
  cleanupStreamingSession,
  activeStreams 
} = require('./streamEngine');
const { startCacheService, enforceCacheLimit, getCacheSize } = require('./cacheService');

const app = express();
const PORT = process.env.PORT || 3000;
let redisClient = null;

// Cross Origin Resource Sharing and parse configs
app.use(cors());
app.use(bodyParser.json());

// Establish Redis Connection if URI configured
(async () => {
  if (process.env.REDIS_URL) {
    try {
      redisClient = createClient({ url: process.env.REDIS_URL });
      redisClient.on('error', (err) => console.warn('Redis Cache connection error:', err.message));
      await redisClient.connect();
      console.log('⚡ Redis dynamic Cache pipeline active.');
    } catch (e) {
      console.warn('Redis could not start, defaulting to local RAM memory cache channels.');
    }
  }
})();

/**
 * 🔍 POST /api/search
 * Body: { query, type?: 'movie' | 'series' | 'anime' | 'all', season?, episode? }
 */
app.post('/api/search', async (req, res) => {
  const { query, type = 'all', season, episode } = req.body;
  if (!query || query.trim().length === 0) {
    return res.status(400).json({ error: 'Search query field cannot be empty.' });
  }

  try {
    // Append season and episode codes automatically for TV series searches if supplied
    let searchQuery = query;
    if (type === 'series' && season && episode) {
      const s = String(season).padStart(2, '0');
      const e = String(episode).padStart(2, '0');
      searchQuery += ` S${s}E${e}`;
    }

    const cacheKey = `search:${searchQuery.toLowerCase().trim()}:${type}`;
    
    // Attempt Redis cache lookup if connected
    if (redisClient) {
      try {
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
          const parsed = JSON.parse(cachedResults);
          console.log(`⚡ [Redis Cache Hit] Serving results for: ${cacheKey}`);
          return res.json({
            success: true,
            query: searchQuery,
            totalResults: parsed.length,
            results: parsed,
            cached: true
          });
        }
      } catch (cacheErr) {
        console.warn('⚠️ [Redis] Cache read failure, falling back to live scrape:', cacheErr.message);
      }
    }

    const results = await searchAllTorrents(searchQuery, type);

    // Save back to Redis cache if connected and results returned
    if (redisClient && results && results.length > 0) {
      try {
        await redisClient.set(cacheKey, JSON.stringify(results), {
          EX: 7200 // Cache searches for 2 hours (can be changed via environment config)
        });
        console.log(`⚡ [Redis Cache Set] Cached ${results.length} results for: ${cacheKey}`);
      } catch (cacheSetErr) {
        console.warn('⚠️ [Redis] Cache write failure:', cacheSetErr.message);
      }
    }

    res.json({
      success: true,
      query: searchQuery,
      totalResults: results.length,
      results: results,
      cached: false
    });
  } catch (err) {
    console.error('API Search Error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Torrent scraping iteration stalled.',
      message: err.message
    });
  }
});

/**
 * 🎬 GET /api/stream/:magnetHash
 * Serves the requested magnet dynamically using byte-range headers or transmuxing.
 */
app.get('/api/stream/:magnetHash', async (req, res) => {
  const magnetHash = req.params.magnetHash;
  // magnet encoded in base64 to avoid URI breaks in routing
  const rawMagnet = Buffer.from(magnetHash, 'base64').toString('ascii');

  if (!rawMagnet.startsWith('magnet:?')) {
    return res.status(400).json({ error: 'Invalid Magnet format' });
  }

  try {
    // Proactively check and enforce cache limits to keep local storage under 5GB
    try {
      enforceCacheLimit();
    } catch (e) {
      console.warn('[Server] Error running proactive cache sweep:', e.message);
    }

    const session = await startTorrentStream(rawMagnet);

    // If mkv, transmux on-the-fly to mp4 to resolve player codec issues.
    // If mp4, stream directly using progressive ranges.
    if (session.file.name.endsWith('.mkv')) {
      serveTransmuxedStream(req, res, session);
    } else {
      serveByteRangeStream(req, res, session);
    }
  } catch (err) {
    console.error('API Stream Setup Error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Unable to stream torrent.',
        reason: err.message
      });
    }
  }
});

/**
 * 🏷️ GET /api/subtitles/:id
 * Grabs movie/show subtitles matching files inside torrent directories.
 */
app.get('/api/subtitles/:id', (req, res) => {
  const sessionId = req.params.id;
  const session = activeStreams[sessionId];

  if (!session) {
    return res.status(404).json({ error: 'Offline stream session. No subtitles available.' });
  }

  // Look for any .vtt or .srt files inside torrent streams
  const subtitleFiles = session.torrent.files.filter(f => f.name.endsWith('.srt') || f.name.endsWith('.vtt'));

  if (subtitleFiles.length === 0) {
    return res.status(404).json({ error: 'No subtitles found inside the torrent archive.' });
  }

  const subFile = subtitleFiles[0];
  res.writeHead(200, {
    'Content-Type': 'text/vtt',
    'Content-Disposition': `attachment; filename="${subFile.name.replace('.srt', '.vtt')}"`
  });

  // Simple on-the-fly SRT to VTT converting stream pipeline
  const stream = subFile.createReadStream();
  let dataBuffer = '';

  stream.on('data', chunk => {
    dataBuffer += chunk.toString();
  });

  stream.on('end', () => {
    let vttContent = dataBuffer;
    if (subFile.name.endsWith('.srt')) {
      // Simple srt to vtt string conversions (replace commas with dots and append header)
      vttContent = 'WEBVTT\n\n' + dataBuffer
        .replace(/\r/g, '')
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    }
    res.end(vttContent);
  });

  stream.on('error', () => {
    res.status(500).send('Subtitles stream pipe failure.');
  });
});

/**
 * 🛑 DELETE /api/stop/:id
 * Manual trigger for immediate session cleanups and cache removals.
 */
app.delete('/api/stop/:id', (req, res) => {
  const sessionId = req.params.id;
  const session = activeStreams[sessionId];

  if (!session) {
    return res.status(404).json({ error: 'Session not active.' });
  }

  cleanupStreamingSession(sessionId, 'Manual API Request');
  res.json({ success: true, message: `Session ${sessionId} destroyed successfully.` });
});

/**
 * 📊 GET /api/status
 * Administrative summary of server active transcode lines and memory tracks
 */
app.get('/api/status', (req, res) => {
  const activeKeys = Object.keys(activeStreams);
  const statusList = activeKeys.map(k => {
    const s = activeStreams[k];
    return {
      sessionId: k,
      name: s.file.name,
      size: `${(s.file.length / (1024 * 1024)).toFixed(1)} MB`,
      progress: `${(s.torrent.progress * 100).toFixed(1)}%`,
      peers: s.torrent.numPeers,
      downloadSpeed: `${(s.torrent.downloadSpeed / 1024).toFixed(1)} KB/s`,
      watchersCount: s.activeStreamsCount,
      secondsSinceLastHeartbeat: Math.floor((Date.now() - s.lastActive) / 1000)
    };
  });

  const totalCacheBytes = getCacheSize();
  const limitBytes = parseInt(process.env.MAX_CACHE_SIZE, 10) || 5 * 1024 * 1024 * 1024;

  res.json({
    activeTorrentStreamsCount: activeKeys.length,
    activeSessions: statusList,
    cacheDiskUsage: {
      usedBytes: totalCacheBytes,
      usedMB: (totalCacheBytes / (1024 * 1024)).toFixed(2),
      usedGB: (totalCacheBytes / (1024 * 1024 * 1024)).toFixed(2),
      limitBytes: limitBytes,
      limitGB: (limitBytes / (1024 * 1024 * 1024)).toFixed(2),
      percentUsed: ((totalCacheBytes / limitBytes) * 100).toFixed(1) + '%'
    }
  });
});

// Startup API
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🛸 ========================================================`);
  console.log(`🌐 PiStream Torrent Server actively listening on port: ${PORT}`);
  console.log(`📂 Temp Buffer Path: /tmp/streamcache`);
  console.log(`🛸 ========================================================\n`);

  // Start the automated storage limit check on cache folder
  startCacheService();
});
