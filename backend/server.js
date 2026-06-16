/**
 * 🔒 PiStream Transparent Encryption Hook (Must be imported before ANY file IO!)
 */
import './encryptedFs.js';

/**
 * 🛰️ PiStream Torrent Streamer API Gateway
 * Core express router powering multi-source searches, TMDB metadata fetches,
 * customizable transcode streaming lines, seek previews, and continuous progress syncs.
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { createClient } from 'redis';

import { searchAllTorrents } from './scrapers.js';
import { 
  startTorrentStream, 
  serveByteRangeStream, 
  serveTransmuxedStream, 
  serveTranscodedQualityStream,
  cleanupStreamingSession,
  activeStreams 
} from './streamEngine.js';

import { startCacheService, enforceCacheLimit, getCacheSize } from './cacheService.js';
import { Watchlist, Progress, StreamTimers } from './db.js';
import { fetchMetadata } from './metadata.js';
import { generateThumbnailFrame, getPlaceholderThumbnail } from './thumbnailGenerator.js';

const app = express();
const PORT = process.env.PORT || 3000;
const TEMP_DIR = process.env.TEMP_DIR || '/tmp/streamcache';
let redisClient = null;

app.use(cors());
app.use(bodyParser.json());

// Root endpoint returning server status
app.get('/', (req, res) => {
  res.send('PiStream Server is Running!');
});

// Establish Redis Connection if URI configured
(async () => {
  if (process.env.REDIS_URL) {
    try {
      redisClient = createClient({ url: process.env.REDIS_URL });
      redisClient.on('error', (err) => console.warn('Redis Cache connection error:', err.message));
      await redisClient.connect();
      console.log('⚡ Redis dynamic Cache pipeline active.');
    } catch (e) {
      console.warn('Redis could not start, defaulting to local SQLite/Memory caches.');
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
    let searchQuery = query;
    if (type === 'series' && season && episode) {
      const s = String(season).padStart(2, '0');
      const e = String(episode).padStart(2, '0');
      searchQuery += ` S${s}E${e}`;
    }

    const cacheKey = `search:${searchQuery.toLowerCase().trim()}:${type}`;
    let torrentResults = null;
    let cached = false;

    // 1. Check Redis Cache for Torrent Results
    if (redisClient) {
      try {
        const cachedResults = await redisClient.get(cacheKey);
        if (cachedResults) {
          torrentResults = JSON.parse(cachedResults);
          cached = true;
          console.log(`⚡ [Redis Cache Hit] Served search: ${cacheKey}`);
        }
      } catch (cacheErr) {
        console.warn('⚠️ [Redis] Cache read failing, falling back:', cacheErr.message);
      }
    }

    // 2. Fall back to Live Scraping
    if (!torrentResults) {
      torrentResults = await searchAllTorrents(searchQuery, type);
      if (redisClient && torrentResults.length > 0) {
        try {
          await redisClient.set(cacheKey, JSON.stringify(torrentResults), { EX: 7200 }); // cache 2 hrs
        } catch (setErr) {}
      }
    }

    // 3. Fetch detailed TMDB/IMDb media metadata to return Movie details!
    let metadataRecord = null;
    try {
      metadataRecord = await fetchMetadata(query, type);
    } catch (metaErr) {
      console.warn('⚠️ [Metadata Error] Custom scrape failed, using defaults:', metaErr.message);
    }

    res.json({
      success: true,
      query: searchQuery,
      totalResults: torrentResults.length,
      results: torrentResults,
      meta: metadataRecord,
      cached: cached
    });
  } catch (err) {
    console.error('API Search Error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Torrent scraping crashed.',
      message: err.message
    });
  }
});

/**
 * 🎬 GET /api/stream/:magnetHash
 * Serves the requested magnet dynamically. Supports ?quality=low to downscale transcode.
 */
app.get('/api/stream/:magnetHash', async (req, res) => {
  const magnetHash = req.params.magnetHash;
  const quality = req.query.quality || 'high'; // 'low' | 'medium' | 'high'
  const rawMagnet = Buffer.from(magnetHash, 'base64').toString('ascii');

  if (!rawMagnet.startsWith('magnet:?')) {
    return res.status(400).json({ error: 'Invalid Magnet file format.' });
  }

  try {
    try {
      enforceCacheLimit();
    } catch (e) {
      console.warn('[Server] Proactive cache sweep failed:', e.message);
    }

    const session = await startTorrentStream(rawMagnet);

    // Save streaming active status in SQLite
    await StreamTimers.setExpired(session.id);

    // If low quality / data saver requested, trigger real-time downscaler transcoding
    if (quality === 'low' || quality === 'medium') {
      serveTranscodedQualityStream(req, res, session, quality);
    } else if (session.file.name.endsWith('.mkv')) {
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
 * 📸 GET /api/thumbnails/:id/:time
 * Generates an on-the-fly preview thumbnail JPEG at specific seconds
 */
app.get('/api/thumbnails/:id/:time', async (req, res) => {
  const sessionId = req.params.id;
  const timeSeconds = parseFloat(req.params.time) || 0;
  const session = activeStreams[sessionId];

  if (!session) {
    return res.redirect(getPlaceholderThumbnail());
  }

  const videoPath = path.join(session.tempPath, session.file.name);
  const targetOutputDir = path.join(TEMP_DIR, `thumbs-${sessionId}`);

  try {
    const outputJpgPath = await generateThumbnailFrame(videoPath, timeSeconds, targetOutputDir);
    res.sendFile(outputJpgPath);
  } catch (err) {
    console.warn(`[Thumb Capture Redirect]:`, err.message);
    res.redirect(getPlaceholderThumbnail());
  }
});

/**
 * 🏷️ GET /api/subtitles/:id
 * Serves subtitle files inside the downloaded torrent or falls back to Web/OpenSubtitles mock entries
 */
app.get('/api/subtitles/:id', (req, res) => {
  const sessionId = req.params.id;
  const session = activeStreams[sessionId];

  // If no active session, send fallback online default english VTT
  if (!session) {
    return res.send(`WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\n[PiStream Web subtitle channel offline]`);
  }

  // Search inside torrent directory files for sub tracks
  const subtitleFiles = session.torrent.files.filter(f => f.name.endsWith('.srt') || f.name.endsWith('.vtt'));

  if (subtitleFiles.length === 0) {
    // Return standard fallback subtitle
    res.writeHead(200, { 'Content-Type': 'text/vtt' });
    return res.end(`WEBVTT\n\n1\n00:00:00.500 --> 00:00:04.000\n[English subtitle decoded automatically]`);
  }

  const subFile = subtitleFiles[0];
  res.writeHead(200, {
    'Content-Type': 'text/vtt',
    'Content-Disposition': `attachment; filename="${subFile.name.replace('.srt', '.vtt')}"`
  });

  const stream = subFile.createReadStream();
  let dataBuffer = '';

  stream.on('data', chunk => { dataBuffer += chunk.toString(); });
  stream.on('end', () => {
    let vttContent = dataBuffer;
    if (subFile.name.endsWith('.srt')) {
      vttContent = 'WEBVTT\n\n' + dataBuffer
        .replace(/\r/g, '')
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    }
    res.end(vttContent);
  });

  stream.on('error', () => {
    res.status(500).send('Subtitle stream broken.');
  });
});

/**
 * 🔄 WATCHING PROGRESS / API SYNC
 */
app.post('/api/progress', async (req, res) => {
  const { id, tmdbId, title, type, position, duration } = req.body;
  if (!id || position === undefined || !duration) {
    return res.status(400).json({ error: 'Missing sync progress values.' });
  }

  try {
    await Progress.save({ id, tmdbId, title, type, position, duration });
    res.json({ success: true, message: 'Playback progress synced.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/progress/:id', async (req, res) => {
  try {
    const row = await Progress.get(req.params.id);
    if (!row) {
      return res.json({ position: 0 });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/continue-watching', async (req, res) => {
  try {
    const rows = await Progress.getContinueWatching();
    res.json({ success: true, results: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 🍿 WATCHLIST API ENDPOINTS
 */
app.post('/api/watchlist', async (req, res) => {
  const { id, tmdbId, imdbId, title, poster, backdrop, year, rating, synopsis, type } = req.body;
  if (!id || !title) {
    return res.status(400).json({ error: 'Missing required watchlist parameters.' });
  }

  try {
    await Watchlist.add({ id, tmdbId, imdbId, title, poster, backdrop, year, rating, synopsis, type });
    res.json({ success: true, message: 'Saved to Watchlist.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/watchlist', async (req, res) => {
  try {
    const rows = await Watchlist.getAll();
    res.json({ success: true, results: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/watchlist/:id', async (req, res) => {
  try {
    await Watchlist.remove(req.params.id);
    res.json({ success: true, message: 'Removed from Watchlist.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 🛑 DELETE /api/stop/:id
 * Manual shutdown for cache session
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
 * 🛰️ GET /api/version
 * Performs version checking against GitHub Releases or env config
 */
app.get('/api/version', async (req, res) => {
  const owner = process.env.GITHUB_OWNER || 'abutalha0512';
  const repo = process.env.GITHUB_REPO || 'pistream';
  
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'PiStream-Updater'
      }
    });
    
    if (!response.ok) {
      throw new Error(`GitHub API returned status ${response.status}`);
    }
    
    const release = await response.json();
    const apkAsset = release.assets.find(asset => asset.name.endsWith('.apk'));
    
    res.json({
      success: true,
      latestVersion: release.tag_name.replace(/^v/, ''),
      releaseNotes: release.body,
      publishedAt: release.published_at,
      apkUrl: apkAsset ? apkAsset.browser_download_url : null,
      assets: release.assets.map(a => ({
        name: a.name,
        size: a.size,
        downloadUrl: a.browser_download_url
      }))
    });
  } catch (err) {
    console.error('Error checking latest version from GitHub:', err.message);
    res.json({
      success: false,
      error: 'Failed to retrieve version info from GitHub',
      message: err.message,
      latestVersion: '1.0.0',
      apkUrl: null,
      assets: []
    });
  }
});

/**
 * 📊 GET /api/status
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

// Startup Server dynamically checking for ports starting from PORT
let currentPort = parseInt(PORT, 10);
const startServer = (port) => {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`\n🛸 ========================================================`);
    console.log(`🌐 PiStream Torrent Server actively listening on port: ${port}`);
    console.log(`📂 Temp Buffer Path: ${TEMP_DIR}`);
    console.log(`🛸 ========================================================\n`);

    // Start the storage checks and SQLite stream expiration queues
    startCacheService();
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Port ${port} is occupied. Retrying with next fallback port: ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('❌ Server startup error:', err.message);
    }
  });
};

startServer(currentPort);
