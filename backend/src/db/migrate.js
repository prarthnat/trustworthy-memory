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
  console.log('[migrate] Schema applied successfully');
}

module.exports = { migrate };
