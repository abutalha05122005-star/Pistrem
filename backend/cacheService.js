/**
 * 🧹 PiStream Cache Manager & Garbage Collection Service
 * Manages the /tmp/streamcache directory, monitoring total space and eviction policies
 * to keep total disk usage under a configurable 5GB limit, and queries SQLite stream timers
 * every minute to enforce (duration * 2) auto-deletion schedules on the Raspberry Pi.
 */

const fs = require('fs');
const path = require('path');
const { activeStreams, cleanupStreamingSession } = require('./streamEngine');
const { StreamTimers } = require('./db');

const TEMP_DIR = process.env.TEMP_DIR || '/tmp/streamcache';
// 5 GB Limit, fall back to environment variable if configured (default to 5GB in bytes)
const CACHE_LIMIT_BYTES = parseInt(process.env.MAX_CACHE_SIZE, 10) || 5 * 1024 * 1024 * 1024; 
const CHECK_INTERVAL_MS = 2 * 60 * 1000; // Check storage every 2 minutes
const TIMER_INTERVAL_MS = 60 * 1000; // Check expired SQLite timers every 1 minute

/**
 * Calculate directory size recursively and get modification stats
 * @param {string} dirPath 
 * @returns {{size: number, maxMtime: number}}
 */
function getDirectoryStats(dirPath) {
  let size = 0;
  let maxMtime = 0;

  try {
    if (!fs.existsSync(dirPath)) return { size, maxMtime };
    const stat = fs.statSync(dirPath);
    maxMtime = stat.mtimeMs;

    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const fileStat = fs.statSync(filePath);

      if (fileStat.isDirectory()) {
        const subStats = getDirectoryStats(filePath);
        size += subStats.size;
        if (subStats.maxMtime > maxMtime) {
          maxMtime = subStats.maxMtime;
        }
      } else {
        size += fileStat.size;
        if (fileStat.mtimeMs > maxMtime) {
          maxMtime = fileStat.mtimeMs;
        }
      }
    }
  } catch (err) {
    console.warn(`[Cache Service] Error reading statistics for path ${dirPath}:`, err.message);
  }

  return { size, maxMtime };
}

/**
 * Fallback recursive deletion of folders from disk securely
 * @param {string} folderPath 
 */
function deleteFolderRecursive(folderPath) {
  try {
    if (fs.existsSync(folderPath)) {
      const files = fs.readdirSync(folderPath);
      for (const file of files) {
        const curPath = path.join(folderPath, file);
        if (fs.lstatSync(curPath).isDirectory()) {
          deleteFolderRecursive(curPath);
        } else {
          // Secure erasure fallback before unlinking
          try {
            const fd = fs.openSync(curPath, 'r+');
            const size = fs.statSync(curPath).size;
            if (size > 0) {
              const crypto = require('crypto');
              const buffer = crypto.randomBytes(Math.min(size, 4096));
              fs.writeSync(fd, buffer, 0, buffer.length, 0);
            }
            fs.closeSync(fd);
          } catch (e) {}
          fs.unlinkSync(curPath);
        }
      }
      fs.rmdirSync(folderPath);
      console.log(`[Cache Service] Cleaned orphan cache folder permanently: ${folderPath}`);
    }
  } catch (e) {
    console.error(`[Cache Service] Failed to remove folder ${folderPath}:`, e.message);
  }
}

/**
 * Sweeps block allocation and enforces cache boundaries under 5GB limit
 */
function enforceCacheLimit() {
  if (!fs.existsSync(TEMP_DIR)) {
    console.log(`[Cache Service] Temp directory not present. Skipping check...`);
    return;
  }

  try {
    const items = fs.readdirSync(TEMP_DIR);
    let cacheFolders = [];
    let totalSize = 0;

    for (const item of items) {
      const itemPath = path.join(TEMP_DIR, item);
      const stat = fs.statSync(itemPath);

      if (stat.isDirectory()) {
        const stats = getDirectoryStats(itemPath);
        cacheFolders.push({
          id: item,
          path: itemPath,
          size: stats.size,
          mtime: stats.maxMtime || stat.mtimeMs,
          isActive: !!activeStreams[item]
        });
        totalSize += stats.size;
      }
    }

    const currentSizeMB = (totalSize / (1024 * 1024)).toFixed(1);
    const limitMB = (CACHE_LIMIT_BYTES / (1024 * 1024)).toFixed(1);

    console.log(`[Cache Service Monitor] Storage check: ${currentSizeMB} MB / ${limitMB} MB current utilization.`);

    // If cache threshold breached, begin eviction sequence
    if (totalSize > CACHE_LIMIT_BYTES) {
      console.warn(`[Cache Warning] Storage limit of ${limitMB} MB breached by ${currentSizeMB} MB. Evicting data segments...`);

      // Sorting strategy: Inactive orphans first, then sort by oldest modification date (Least Recently Used)
      cacheFolders.sort((a, b) => {
        if (a.isActive !== b.isActive) {
          return a.isActive ? 1 : -1; // Inactive streams evicted first
        }
        return a.mtime - b.mtime; // Oldest folders first
      });

      // Target to clear until we're back safely below 80% of limit to prevent immediate thrashing
      const targetSize = CACHE_LIMIT_BYTES * 0.8;

      for (const folder of cacheFolders) {
        if (totalSize <= targetSize) {
          break;
        }

        const sizeMB = (folder.size / (1024 * 1024)).toFixed(1);
        console.log(`[Cache Service Sweep] Evicting folder: ${folder.id} | Size: ${sizeMB} MB | Active stream: ${folder.isActive}`);

        if (folder.isActive) {
          // Destroys torrent metadata buffers and webseeder processes, then purges folder
          cleanupStreamingSession(folder.id, 'Cache space optimization');
        } else {
          // Wipe orphaned file directory
          deleteFolderRecursive(folder.path);
        }

        totalSize -= folder.size;
      }

      const finalSizeMB = (totalSize / (1024 * 1024)).toFixed(1);
      console.log(`[Cache Service Sweep] Eviction complete. Adjusted Cache Size: ${finalSizeMB} MB`);
    }
  } catch (err) {
    console.error(`[Cache Service Error] Failed to enforce storage quotas:`, err);
  }
}

/**
 * Sweeps and auto-deletes expired video streams based on their (Duration * 2) SQLite database timers
 */
async function checkExpiredStreamTimers() {
  try {
    const activeTimers = await StreamTimers.getActiveTimers();
    const now = Date.now();

    for (const timer of activeTimers) {
      if (now >= timer.endsAt) {
        console.log(`⏰ [Expired Timer Triggered] Session ${timer.id} reached its limits. Wiping cache files: ${timer.torrentPath}...`);
        
        // Wipe active running session
        cleanupStreamingSession(timer.id, 'SQLite expiration schedule');
        
        // Mark as expired in DB
        await StreamTimers.setExpired(timer.id);
        
        // Ensure files are wiped from disk permanently
        if (fs.existsSync(timer.torrentPath)) {
          deleteFolderRecursive(timer.torrentPath);
        }
        
        // Wipe secondary associated thumbnail directories for this session
        const thumbDir = path.join(TEMP_DIR, `thumbs-${timer.id}`);
        if (fs.existsSync(thumbDir)) {
          deleteFolderRecursive(thumbDir);
        }
      }
    }
  } catch (err) {
    console.error('❌ [Cache Service Timer Check Error]:', err.message);
  }
}

/**
 * Initializes background interval sweeps
 */
function startCacheService() {
  console.log(`🛸 Initializing PiStream Cache Service...`);
  console.log(`📊 Target Storage limit: ${(CACHE_LIMIT_BYTES / (1024 * 1024 * 1024)).toFixed(2)} GB`);
  console.log(`⏱️ Sweep intervals: Space Sweep=${CHECK_INTERVAL_MS / 1000}s, SQLite Timers Sweep=${TIMER_INTERVAL_MS / 1000}s`);

  // Run initial enforcement check
  enforceCacheLimit();
  checkExpiredStreamTimers();

  // Schedule storage limits sweeps
  setInterval(() => {
    enforceCacheLimit();
  }, CHECK_INTERVAL_MS);

  // Schedule (Duration * 2) auto-deletion timer checks from SQLite db
  setInterval(() => {
    checkExpiredStreamTimers();
  }, TIMER_INTERVAL_MS);
}

module.exports = {
  startCacheService,
  enforceCacheLimit,
  getCacheSize: () => {
    let totalSize = 0;
    try {
      if (fs.existsSync(TEMP_DIR)) {
        const items = fs.readdirSync(TEMP_DIR);
        for (const item of items) {
          const itemPath = path.join(TEMP_DIR, item);
          const stat = fs.statSync(itemPath);
          if (stat.isDirectory()) {
            totalSize += getDirectoryStats(itemPath).size;
          }
        }
      }
    } catch (e) {}
    return totalSize;
  }
};
