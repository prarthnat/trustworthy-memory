/**
 * tests/setup.js — Test environment setup.
 *
 * Uses in-memory SQLite so tests never touch the real data/caygnus.db.
 * Must be loaded before any service imports the db singleton.
 */

const fs = require('fs');
const path = require('path');

process.env.DB_PATH = path.join('/tmp', 'caygnus-vitest.db');

try {
  fs.unlinkSync(process.env.DB_PATH);
} catch (_err) {
  // File may not exist on the first test run.
}

// Apply the schema to the in-memory DB before any test runs
const { migrate } = require('../src/db/migrate');
migrate();
