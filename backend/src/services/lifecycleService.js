/**
 * lifecycleService.js — Audit log queries for memory lifecycle history.
 */

'use strict';

const db = require('../db/db');

/**
 * Get the full audit trail for a single memory, ordered chronologically.
 */
function getLifecycle(memoryId) {
  const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId);
  if (!memory) return null;

  const events = db
    .prepare(
      `SELECT * FROM memory_audit_log
       WHERE memory_id = ?
       ORDER BY event_at ASC`
    )
    .all(memoryId)
    .map((e) => ({
      ...e,
      old_value: e.old_value ? JSON.parse(e.old_value) : null,
      new_value: e.new_value ? JSON.parse(e.new_value) : null,
    }));

  const supersedes = db
    .prepare(
      `SELECT * FROM memory_supersessions
       WHERE new_memory_id = ?
       ORDER BY superseded_at ASC, old_memory_id ASC`
    )
    .all(memoryId);

  const supersededBy = db
    .prepare(
      `SELECT * FROM memory_supersessions
       WHERE old_memory_id = ?
       ORDER BY superseded_at ASC, new_memory_id ASC`
    )
    .all(memoryId);

  const conflicts = db
    .prepare(
      `SELECT * FROM memory_conflicts
       WHERE memory_id = ?
       ORDER BY created_at ASC, related_memory_id ASC`
    )
    .all(memoryId);

  return {
    memory: {
      ...memory,
      metadata: memory.metadata ? JSON.parse(memory.metadata) : {},
    },
    events,
    supersession: {
      supersedes,
      superseded_by: supersededBy,
    },
    conflicts,
  };
}

/**
 * Get the most recent lifecycle events across all memories.
 *
 * @param {number} [limit=50]
 * @param {string} [eventType]  - filter to a specific event type
 */
function getRecentEvents({ limit = 50, eventType } = {}) {
  let sql = `
    SELECT l.*, m.content AS memory_content, m.topic AS memory_topic
    FROM memory_audit_log l
    JOIN memories m ON m.id = l.memory_id
  `;
  const params = [];

  if (eventType) {
    sql += ' WHERE l.event_type = ?';
    params.push(eventType);
  }

  sql += ' ORDER BY l.event_at DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params).map((e) => ({
    ...e,
    old_value: e.old_value ? JSON.parse(e.old_value) : null,
    new_value: e.new_value ? JSON.parse(e.new_value) : null,
  }));
}

module.exports = { getLifecycle, getRecentEvents };
