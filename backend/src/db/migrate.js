/**
 * migrate.js — Applies schema.sql idempotently using CREATE TABLE IF NOT EXISTS.
 * Safe to run on every server start.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const db   = require('./db');

const schemaPath = path.join(__dirname, 'schema.sql');
const schema     = fs.readFileSync(schemaPath, 'utf8');

function migrate() {
  db.exec(schema);
  const retrievalColumns = db.prepare('PRAGMA table_info(retrieval_log)').all().map((col) => col.name);
  if (!retrievalColumns.includes('scorer')) {
    db.prepare("ALTER TABLE retrieval_log ADD COLUMN scorer TEXT DEFAULT '{}'").run();
  }
  console.log('[migrate] Schema applied successfully');
}

module.exports = { migrate };
