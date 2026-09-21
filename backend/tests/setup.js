/**
 * tests/setup.js — Test environment setup.
 *
 * Uses in-memory SQLite so tests never touch the real data/caygnus.db.
 * Must be loaded before any service imports the db singleton.
 */

process.env.DB_PATH = ':memory:';

// Apply the schema to the in-memory DB before any test runs
const { migrate } = require('../src/db/migrate');
migrate();
