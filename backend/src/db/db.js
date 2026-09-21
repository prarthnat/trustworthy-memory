/**
 * db.js — Singleton better-sqlite3 database instance.
 *
 * Synchronous by design: eliminates async race conditions and trivially
 * satisfies the determinism requirement (no Promise interleaving).
 *
 * WAL mode: allows concurrent reads while a write is in progress,
 * which is the right trade-off for an Express server where reads
 * (retrieval) vastly outnumber writes (memory creation).
 */

'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH  = path.join(DATA_DIR, 'caygnus.db');

// Allow override for tests (pass ':memory:' via env)
const resolvedPath = process.env.DB_PATH || DB_PATH;

if (resolvedPath !== ':memory:') {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(resolvedPath, {
  // verbose: process.env.NODE_ENV === 'development' ? console.log : undefined,
});

// Enable WAL mode for better read concurrency
db.pragma('journal_mode = WAL');

// Enforce foreign key constraints (disabled by default in SQLite)
db.pragma('foreign_keys = ON');

module.exports = db;
