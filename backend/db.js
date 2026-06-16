/**
 * 🗄️ PiStream SQLite Database Service
 * Manages local database schemas for watchlists, playback continuation history (resume points),
 * and live stream-cache timers for (duration * 2) auto-deletion schedules on the Raspberry Pi.
 */

import sqlite3Init from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const sqlite3 = sqlite3Init.verbose();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = path.join(__dirname, 'pistream.db');

// Instantiate DB
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('❌ Failed to open SQLite database:', err.message);
  } else {
    console.log('🗄️ SQLite database successfully initialized at:', DB_PATH);
  }
});

// Helper for running migrations in sequence
function setupDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 1. Watchlist Table
      db.run(`
        CREATE TABLE IF NOT EXISTS watchlist (
          id TEXT PRIMARY KEY,
          tmdbId TEXT,
          imdbId TEXT,
          title TEXT NOT NULL,
          poster TEXT,
          backdrop TEXT,
          year TEXT,
          rating TEXT,
          synopsis TEXT,
          type TEXT,
          addedAt INTEGER
        )
      `);

      // 2. Continual Watching / Resume Progress Table
      db.run(`
        CREATE TABLE IF NOT EXISTS progress (
          id TEXT PRIMARY KEY,
          tmdbId TEXT,
          title TEXT,
          type TEXT,
          position REAL NOT NULL,
          duration REAL NOT NULL,
          lastUpdated INTEGER
        )
      `, (err) => {
        // Safe check in case sqlite syntax gets complex or in case we need to alter schemas
      });

      // Simple patch if table exists without lastUpdated schema
      db.run(`
        CREATE TABLE IF NOT EXISTS progress_v2 (
          id TEXT PRIMARY KEY,
          tmdbId TEXT,
          title TEXT,
          type TEXT,
          position REAL NOT NULL,
          duration REAL NOT NULL,
          lastUpdated INTEGER
        )
      `);

      // 3. Active Torrent Stream Timers Table (Recalculated (Duration * 2) after steam ends)
      db.run(`
        CREATE TABLE IF NOT EXISTS stream_timers (
          id TEXT PRIMARY KEY,
          title TEXT,
          durationMinutes REAL,
          endsAt INTEGER,
          torrentPath TEXT,
          magnet TEXT,
          isExpired INTEGER DEFAULT 0
        )
      `);

      resolve();
    });
  });
}

// Ensure database setup triggers instantly
setupDatabase().then(() => {
  console.log('✅ SQLite Schema Migrations applied.');
}).catch(err => {
  console.error('❌ SQLite Schema Error:', err);
});

// Generic promise wrappers
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/**
 * 🍿 WATCHLIST METHODS
 */
const Watchlist = {
  async add(item) {
    const { id, tmdbId, imdbId, title, poster, backdrop, year, rating, synopsis, type } = item;
    const sql = `
      INSERT OR REPLACE INTO watchlist (id, tmdbId, imdbId, title, poster, backdrop, year, rating, synopsis, type, addedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    return runQuery(sql, [id, tmdbId, imdbId, title, poster, backdrop, year, rating, synopsis, type, Date.now()]);
  },

  async remove(id) {
    const sql = 'DELETE FROM watchlist WHERE id = ?';
    return runQuery(sql, [id]);
  },

  async getAll() {
    const sql = 'SELECT * FROM watchlist ORDER BY addedAt DESC';
    return allQuery(sql);
  },

  async isSaved(id) {
    const sql = 'SELECT id FROM watchlist WHERE id = ?';
    const row = await getQuery(sql, [id]);
    return !!row;
  }
};

/**
 * 🔄 RESUME / PROGRESS WATCHING METHODS
 */
const Progress = {
  async save(progress) {
    const { id, tmdbId, title, type, position, duration } = progress;
    const sql = `
      INSERT OR REPLACE INTO progress_v2 (id, tmdbId, title, type, position, duration, lastUpdated)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    return runQuery(sql, [id, tmdbId, title, type, position, duration, Date.now()]);
  },

  async get(id) {
    const sql = 'SELECT * FROM progress_v2 WHERE id = ?';
    return getQuery(sql, [id]);
  },

  async getContinueWatching() {
    // Return sorted list of items with progress, excluding fully watched ones (e.g. > 95% complete)
    const sql = `
      SELECT * FROM progress_v2 
      WHERE (position / duration) < 0.95 
      ORDER BY lastUpdated DESC 
      LIMIT 12
    `;
    return allQuery(sql);
  }
};

/**
 * ⏰ FILE AUTO-DELETION TIMER METHODS
 */
const StreamTimers = {
  async saveTimer(timer) {
    const { id, title, durationMinutes, endsAt, torrentPath, magnet } = timer;
    const sql = `
      INSERT OR REPLACE INTO stream_timers (id, title, durationMinutes, endsAt, torrentPath, magnet, isExpired)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `;
    return runQuery(sql, [id, title, durationMinutes, endsAt, torrentPath, magnet]);
  },

  async getTimer(id) {
    const sql = 'SELECT * FROM stream_timers WHERE id = ?';
    return getQuery(sql, [id]);
  },

  async getActiveTimers() {
    const sql = 'SELECT * FROM stream_timers WHERE isExpired = 0';
    return allQuery(sql);
  },

  async setExpired(id) {
    const sql = 'UPDATE stream_timers SET isExpired = 1 WHERE id = ?';
    return runQuery(sql, [id]);
  }
};

export {
  db,
  Watchlist,
  Progress,
  StreamTimers
};
