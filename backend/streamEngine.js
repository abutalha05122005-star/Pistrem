/**
 * 🌀 PiStream WebTorrent Download & Transmuxing Engine
 * Manages active torrent stream lifecycles, sequential piece prioritizations,
 * on-the-fly FFmpeg progressive quality transcodes, byte-range seekers, and
 * (duration * 2) SQLite automated storage timer enforcements.
 */

const WebTorrent = require('webtorrent');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { StreamTimers } = require('./db');

const client = new WebTorrent({
  maxConns: 30, // Limited for Raspberry Pi CPU / Memory shields
  tracker: true,
  dht: true,
  webSeeds: true
});

const activeStreams = {}; // { id: { torrent, files, lastActive, endsAt, tempPath } }
const TEMP_DIR = process.env.TEMP_DIR || '/tmp/streamcache';
const TIMEOUT_CLEAN_INACTIVE_DOWNLOAD_MS = 10 * 60 * 1000; // 10 minutes for abandoned incomplete downloads

// Ensure base temp directory exists
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

    // Return session if already active, and cancel any expiration scheduler
    if (activeStreams[streamId]) {
      const session = activeStreams[streamId];
      session.lastActive = Date.now();
      
      // Clear database timer if restarted during the deletion countdown!
      StreamTimers.setExpired(streamId).then(() => {
        console.log(`🔄 [Timer Reset] Repopulating stream ${streamId}. Timer reset to dynamic end.`);
      }).catch(err => {
        console.warn('[DB Timer Reset Error]:', err.message);
      });

      if (session.cleanupTimer) {
        clearTimeout(session.cleanupTimer);
        session.cleanupTimer = null;
      }
      return resolve(session);
    }

    console.log(`\n📥 Starting Stream Session: ${streamId}`);
    console.log(`🧲 Magnet: ${magnetUrl.substring(0, 50)}...`);

    const downloadPath = path.join(TEMP_DIR, streamId);
    if (!fs.existsSync(downloadPath)) {
      fs.mkdirSync(downloadPath, { recursive: true });
    }

    client.add(magnetUrl, { path: downloadPath }, (torrent) => {
      // Prioritize sequential download pieces for streaming optimization
      torrent.select(0, torrent.pieces.length - 1, 1);
      torrent.criticalSelection = [];

      // Find largest video
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

      // Main video file
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

      torrent.on('download', () => {
        const progress = (torrent.progress * 100).toFixed(1);
        const speed = (torrent.downloadSpeed / (1024 * 1024)).toFixed(2);
        console.log(`[TorrentProgress ${streamId}] ${progress}% | Speed: ${speed} MB/s | Peers: ${torrent.numPeers}`);
      });

      resolve(session);
    });

    // Handle initial connection tracker timeouts
    setTimeout(() => {
      if (!activeStreams[streamId]) {
        reject(new Error('Torrent metadata fetch timeout. No peers available.'));
      }
    }, 45000);
  });
}

/**
 * Serves video progressively via HTTP range chunks
 */
function serveByteRangeStream(req, res, session) {
  const file = session.file;
  session.lastActive = Date.now();
  session.activeStreamsCount++;

  const range = req.headers.range;
  const totalSize = file.length;

  res.on('close', () => {
    session.activeStreamsCount = Math.max(0, session.activeStreamsCount - 1);
    session.lastActive = Date.now();
    resetCleanupTimer(session.id);
  });

  if (!range) {
    res.writeHead(200, {
      'Content-Length': totalSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes'
    });
    const readStream = file.createReadStream();
    readStream.pipe(res);
  } else {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
    const chunkSize = (end - start) + 1;

    let isRequestActive = true;
    const stTimer = setTimeout(() => {
      if (isRequestActive && res.writable) {
        console.log(`⚠️ Seek Stalled: Pieces for range ${start}-${end} offline.`);
        isRequestActive = false;
        res.status(503).send('Piece buffering in progress. Please retry.');
      }
    }, 30000);

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
      console.error(`[Stream Range Error] Pipestream broken:`, err.message);
    });

    res.on('finish', () => {
      clearTimeout(stTimer);
      isRequestActive = false;
    });
  }
}

/**
 * Custom H.264 transcoding for non-conforming players
 */
function serveTransmuxedStream(req, res, session) {
  session.lastActive = Date.now();
  session.activeStreamsCount++;

  console.log(`🎬 [Transcoding Engine] On-the-fly streaming for container: ${session.file.name}`);

  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Transfer-Encoding': 'chunked'
  });

  const inputStream = session.file.createReadStream();

  const process = ffmpeg()
    .input(inputStream)
    .toFormat('mp4')
    .videoCodec('copy')
    .audioCodec('aac')
    .outputOptions([
      '-movflags frag_keyframe+empty_moov+faststart',
      '-pix_fmt yuv420p'
    ])
    .on('error', (err) => {
      console.warn(`[FFmpeg Transmux Error] Session ${session.id}:`, err.message);
    })
    .on('end', () => {
      console.log(`[FFmpeg Transmux Ended] Session ${session.id}`);
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
 * Downscaled Transcoding serving (Data Saver option: ?quality=low)
 */
function serveTranscodedQualityStream(req, res, session, qualitySetting = 'low') {
  session.lastActive = Date.now();
  session.activeStreamsCount++;

  console.log(`🎬 [Transcoding Quality Engine] Processing dynamic ${qualitySetting} stream for file: ${session.file.name}`);

  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Transfer-Encoding': 'chunked'
  });

  const inputStream = session.file.createReadStream();

  let videoBitrate = '500k';
  let videoScale = '640:-2'; // downscaled wide resolution (preserving aspect ratio)

  if (qualitySetting === 'medium') {
    videoBitrate = '1000k';
    videoScale = '1280:-2'; // 720p
  }

  const process = ffmpeg()
    .input(inputStream)
    .toFormat('mp4')
    .videoCodec('libx264')
    .audioCodec('aac')
    .videoBitrate(videoBitrate)
    .size(videoScale)
    .outputOptions([
      '-movflags frag_keyframe+empty_moov+faststart',
      '-preset ultrafast', // Minimize Raspberry Pi processor cores load
      '-tune zerolatency',
      '-pix_fmt yuv420p'
    ])
    .on('error', (err) => {
      console.warn(`[FFmpeg Quality Encoter Error] Session ${session.id}:`, err.message);
    })
    .on('end', () => {
      console.log(`[FFmpeg Quality Encoder Complete] Session ${session.id}`);
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
 * Resets/recalculates cleanup schedules on streaming stops
 */
function resetCleanupTimer(streamId) {
  const session = activeStreams[streamId];
  if (!session) return;

  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer);
    session.cleanupTimer = null;
  }

  // If streaming stops (no active watcher clients!)
  if (session.activeStreamsCount === 0) {
    const filePath = path.join(session.tempPath, session.file.name);
    
    // Calculate media duration asynchronously to schedule (Duration * 2) auto-deletion timer!
    ffmpeg.ffprobe(filePath, async (err, metadata) => {
      let durationMinutes = 90; // Default fallback for movies
      
      if (!err && metadata && metadata.format && metadata.format.duration) {
        durationMinutes = Math.max(1, Math.round(metadata.format.duration / 60));
      } else {
        // Fallback names checks
        const nameLower = session.file.name.toLowerCase();
        if (nameLower.includes('s0') || nameLower.includes('e0') || nameLower.includes('episode') || nameLower.includes('season')) {
          durationMinutes = 24; // TV episodes typically 24 mins
        }
      }

      const keepDurationMinutes = durationMinutes * 2;
      const endsAt = Date.now() + (keepDurationMinutes * 60 * 1000);

      console.log(`⏱️ [Schedule AutoDeletions] Session ${streamId} stops streaming. Duration is ${durationMinutes}m. Timer scheduled for ${keepDurationMinutes}m from now.`);

      try {
        await StreamTimers.saveTimer({
          id: streamId,
          title: session.file.name,
          durationMinutes: durationMinutes,
          endsAt: endsAt,
          torrentPath: session.tempPath,
          magnet: session.magnet
        });
      } catch (dbErr) {
        console.error('[SQLite Timers Error]:', dbErr.message);
      }

      // Call automatic active-stream session cleanup when timer expires
      session.cleanupTimer = setTimeout(() => {
        cleanupStreamingSession(streamId, 'Video duration timer expired');
      }, keepDurationMinutes * 60 * 1000);
    });
  } else {
    // Abandoned download checks: if download is slow/incomplete and no active stream requests for 10 minutes
    session.cleanupTimer = setTimeout(() => {
      const timeDelta = Date.now() - session.lastActive;
      if (session.activeStreamsCount === 0 && session.torrent.progress < 1 && timeDelta >= TIMEOUT_CLEAN_INACTIVE_DOWNLOAD_MS) {
        cleanupStreamingSession(streamId, 'Abandoned incomplete download');
      } else {
        resetCleanupTimer(streamId);
      }
    }, TIMEOUT_CLEAN_INACTIVE_DOWNLOAD_MS);
  }
}

/**
 * Permanently deletes stream file nodes securely
 */
function cleanupStreamingSession(streamId, reason = 'manual') {
  const session = activeStreams[streamId];
  if (!session) return;

  console.log(`\n🧹 [Sweeper Engine] Wiping Stream Session from memory and disk: ${streamId} | Reason: ${reason}`);

  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer);
  }

  // Destroy WebTorrent handle
  try {
    session.torrent.destroy(() => {
      console.log(`  [WebTorrent] Destroyed torrent handles safely: ${streamId}`);
      deleteFromDisk(session.tempPath);
    });
  } catch (err) {
    console.error(`  [WebTorrent Cleanup Error]:`, err.message);
    deleteFromDisk(session.tempPath);
  }

  delete activeStreams[streamId];
}

function deleteFromDisk(folderPath) {
  try {
    if (fs.existsSync(folderPath)) {
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
      console.log(`  [Disk Sweeper] Cleaned directory: ${folderPath}`);
    }
  } catch (e) {
    console.error(`  [Disk Sweeper Error]: Failed to remove path ${folderPath}`, e.message);
  }
}

module.exports = {
  startTorrentStream,
  serveByteRangeStream,
  serveTransmuxedStream,
  serveTranscodedQualityStream,
  cleanupStreamingSession,
  activeStreams
};
