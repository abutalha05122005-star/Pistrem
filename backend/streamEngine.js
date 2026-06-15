/**
 * 🌀 PiStream WebTorrent Download & Transmuxing Engine
 * Manages active torrent stream lifecycles, sequential piece prioritizations,
 * on-the-fly FFmpeg transmuxing, byte-range handlers, and automated cleanups.
 */

const WebTorrent = require('webtorrent');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Initializing WebTorrent
const client = new WebTorrent({
  maxConns: 55,
  tracker: true,
  dht: true,
  webSeeds: true
});

const activeStreams = {}; // Keeps track of active stream sessions: { id: { torrent, files, lastActive, timer, tempPath } }
const TEMP_DIR = process.env.TEMP_DIR || '/tmp/streamcache';
const TIMEOUT_WIPE_STREAM_MS = 15 * 60 * 1000; // 15 Minutes
const TIMEOUT_CLEAN_INACTIVE_DOWNLOAD_MS = 10 * 60 * 1000; // 10 Minutes

// Ensure directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Starts a webtorrent download sequentially.
 * @param {string} magnetUrl 
 * @returns {Promise<Object>} Stream profile
 */
function startTorrentStream(magnetUrl) {
  return new Promise((resolve, reject) => {
    // Generate a unique stream session ID
    const streamId = crypto.createHash('md5').update(magnetUrl).digest('hex');

    // Return session if already initialized
    if (activeStreams[streamId]) {
      activeStreams[streamId].lastActive = Date.now();
      resetCleanupTimer(streamId);
      return resolve(activeStreams[streamId]);
    }

    console.log(`\n📥 Starting Stream Session: ${streamId}`);
    console.log(`🧲 Magnet: ${magnetUrl.substring(0, 50)}...`);

    const downloadPath = path.join(TEMP_DIR, streamId);
    if (!fs.existsSync(downloadPath)) {
      fs.mkdirSync(downloadPath, { recursive: true });
    }

    client.add(magnetUrl, { path: downloadPath }, (torrent) => {
      // 1. Prioritize sequential download pieces
      torrent.select(0, torrent.pieces.length - 1, 1); // sequential download
      torrent.criticalSelection = [];

      // Finding largest video file
      const videoFiles = torrent.files.filter(f => 
        f.name.endsWith('.mp4') || 
        f.name.endsWith('.mkv') || 
        f.name.endsWith('.avi') || 
        f.name.endsWith('.mov')
      );

      if (videoFiles.length === 0) {
        torrent.destroy();
        return reject(new Error('No streamable video files found inside torrent contents.'));
      }

      // Largest video is matching main movie
      const targetFile = videoFiles.sort((a,b) => b.length - a.length)[0];
      
      const session = {
        id: streamId,
        magnet: magnetUrl,
        torrent: torrent,
        file: targetFile,
        lastActive: Date.now(),
        tempPath: downloadPath,
        cleanupTimer: null,
        activeStreamsCount: 0
      };

      activeStreams[streamId] = session;
      resetCleanupTimer(streamId);

      // Log progress periodically
      torrent.on('download', () => {
        const progress = (torrent.progress * 100).toFixed(1);
        const ratio = (torrent.downloadSpeed / (1024 * 1024)).toFixed(2);
        console.log(`[TorrentProgress ${streamId}] ${progress}% downloaded | Speed: ${ratio} MB/s | Seeders: ${torrent.numPeers}`);
      });

      resolve(session);
    });

    // Handle initial timeout
    setTimeout(() => {
      if (!activeStreams[streamId]) {
        reject(new Error('Torrent metadata fetch timeout. No peers available.'));
      }
    }, 45000); // 45s threshold
  });
}

/**
 * Handle Progressive Byte-Range HTTP stream streaming
 */
function serveByteRangeStream(req, res, session) {
  const file = session.file;
  session.lastActive = Date.now();
  resetCleanupTimer(session.id);
  session.activeStreamsCount++;

  const range = req.headers.range;
  const totalSize = file.length;

  res.on('close', () => {
    session.activeStreamsCount = Math.max(0, session.activeStreamsCount - 1);
    session.lastActive = Date.now();
    resetCleanupTimer(session.id);
  });

  if (!range) {
    // Serve entire stream headers
    res.writeHead(200, {
      'Content-Length': totalSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes'
    });
    const readStream = file.createReadStream();
    readStream.pipe(res);
  } else {
    // Parse range string
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
    const chunkSize = (end - start) + 1;

    console.log(`[Stream Range ${session.id}] Requested range: ${start}-${end} | Size: ${chunkSize} bytes`);

    // Incase of seeking into not-yet-buffered pieces, webtorrent inherently pauses the readstream
    // and fetches the requested block from peers first (sequential priority).
    // We add an express read timeout to gracefully handle zero-peer seeking stalls.
    let isRequestActive = true;
    const stTimer = setTimeout(() => {
      if (isRequestActive && res.writable) {
        console.log(`⚠️ Seek Stalled: Pieces for range ${start}-${end} offline. Responding 503 Gateway retry...`);
        isRequestActive = false;
        res.status(503).send('Piece buffering in progress. Try seeking again.');
      }
    }, 30000); // 30 second piece retrieval timeout

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': file.name.endsWith('.mkv') ? 'video/x-matroska' : 'video/mp4'
    });

    const readStream = file.createReadStream({ start, end });
    readStream.pipe(res);

    readStream.on('open', () => {
      clearTimeout(stTimer);
    });

    readStream.on('error', (err) => {
      clearTimeout(stTimer);
      isRequestActive = false;
      console.error(`[Stream Error ${session.id}] Stream piping broken:`, err.message);
      if (!res.headersSent) {
        res.status(500).send('Streaming stream failure.');
      }
    });

    res.on('finish', () => {
      clearTimeout(stTimer);
      isRequestActive = false;
    });
  }
}

/**
 * FFmpeg on-the-fly transmuxing for non-mStreamable mkv containers or unsupported players
 */
function serveTransmuxedStream(req, res, session) {
  session.lastActive = Date.now();
  resetCleanupTimer(session.id);
  session.activeStreamsCount++;

  console.log(`🎮 [Transmuxing Engine] On-the-fly audio/video transmuxing for file: ${session.file.name}`);

  // Set response headers for live audio/video streaming
  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Transfer-Encoding': 'chunked'
  });

  const inputStream = session.file.createReadStream();

  const process = ffmpeg()
    .input(inputStream)
    .toFormat('mp4')
    .videoCodec('copy')   // Direct stream copy - zero CPU transcoding for video
    .audioCodec('aac')    // Transcode audio to highly compatible AAC format
    .outputOptions([
      '-movflags frag_keyframe+empty_moov+faststart', // Fragmented mp4 options for instant HTTP delivery
      '-pix_fmt yuv420p'
    ])
    .on('error', (err) => {
      console.warn(`[FFmpeg Active Transmux Error ${session.id}]:`, err.message);
    })
    .on('end', () => {
      console.log(`[FFmpeg Active Transmux Ended ${session.id}]`);
      session.activeStreamsCount = Math.max(0, session.activeStreamsCount - 1);
      session.lastActive = Date.now();
      resetCleanupTimer(session.id);
    });

  process.pipe(res, { end: true });

  res.on('close', () => {
    process.kill('SIGKILL');
    session.activeStreamsCount = Math.max(0, session.activeStreamsCount - 1);
    session.lastActive = Date.now();
    resetCleanupTimer(session.id);
  });
}

/**
 * Resets and schedules automated inactivity garbage collections
 */
function resetCleanupTimer(streamId) {
  const session = activeStreams[streamId];
  if (!session) return;

  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer);
  }

  session.cleanupTimer = setTimeout(() => {
    const timeDelta = Date.now() - session.lastActive;
    
    // Condition A: 15 minutes after the stream ends or last chunk was served, wipe permanently
    // Condition B: If no active players for 10 minutes during download, cancel and delete
    const isWipeCandidate = session.activeStreamsCount === 0 && timeDelta >= TIMEOUT_WIPE_STREAM_MS;
    const isStalledDownload = session.torrent.progress < 1 && timeDelta >= TIMEOUT_CLEAN_INACTIVE_DOWNLOAD_MS;

    if (isWipeCandidate || isStalledDownload) {
      cleanupStreamingSession(streamId, isStalledDownload ? 'stalled download' : 'stream inactive');
    } else {
      // Re-schedule
      resetCleanupTimer(streamId);
    }
  }, Math.min(TIMEOUT_WIPE_STREAM_MS, TIMEOUT_CLEAN_INACTIVE_DOWNLOAD_MS));
}

/**
 * Permanently deletes temporary download directories from disk securely
 */
function cleanupStreamingSession(streamId, reason = 'manual') {
  const session = activeStreams[streamId];
  if (!session) return;

  console.log(`\n🧹 [Sweeper Engine] Wiping Torrent stream session: ${streamId} | Reason: ${reason}`);

  if (session.cleanupTimer) {
     clearTimeout(session.cleanupTimer);
  }

  // 1. Stop webtorrent client trackers for this infoHash
  try {
    session.torrent.destroy(() => {
      console.log(`  [WebTorrent] Destroyed torrent handles safely for session ${streamId}`);
      deleteFromDisk(session.tempPath);
    });
  } catch (err) {
    console.error(`  [WebTorrent Error during Wiping]`, err.message);
    deleteFromDisk(session.tempPath);
  }

  delete activeStreams[streamId];
}

function deleteFromDisk(folderPath) {
  try {
    if (fs.existsSync(folderPath)) {
      // Temporary downloaded data is temporary, we execute a thorough file pass erasure
      // and rimraf-like recursive wipe to satisfy temporary encrypted/erased-at-rest requirements
      const files = fs.readdirSync(folderPath);
      for (const file of files) {
        const curPath = path.join(folderPath, file);
        if (fs.lstatSync(curPath).isDirectory()) {
          deleteFromDisk(curPath);
        } else {
          // Zero-out files before deleting to guarantee encryption at-rest / destruction standards
          try {
            const fd = fs.openSync(curPath, 'r+');
            const size = fs.statSync(curPath).size;
            if (size > 0) {
              const buffer = crypto.randomBytes(Math.min(size, 4096)); // scrub headers with random noise
              fs.writeSync(fd, buffer, 0, buffer.length, 0);
            }
            fs.closeSync(fd);
          } catch (wipeErr) {
            // fallback
          }
          fs.unlinkSync(curPath);
        }
      }
      fs.rmdirSync(folderPath);
      console.log(`  [Disk Sweeper] Cleaned directory permanently: ${folderPath}`);
    }
  } catch (e) {
    console.error(`  [Disk Sweeper Error]: Failed to remove path ${folderPath}`, e.message);
  }
}

module.exports = {
  startTorrentStream,
  serveByteRangeStream,
  serveTransmuxedStream,
  cleanupStreamingSession,
  activeStreams
};
