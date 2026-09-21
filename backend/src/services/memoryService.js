/**
 * memoryService.js — Create, read, update, and soft-delete memories.
 *
 * All writes are wrapped in transactions to ensure atomicity between
 * the memories table and the audit log.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../db/db');

// ─── Helpers ────────────────────────────────────────────────────────────────

function now() {
  return Date.now();
}

/**
 * Fetch tags for a memory as an array of strings.
 */
function fetchTags(memoryId) {
  return db
    .prepare('SELECT tag FROM memory_tags WHERE memory_id = ? ORDER BY tag ASC')
    .all(memoryId)
    .map((r) => r.tag);
}

/**
 * Hydrate a raw memory row into a full object including tags.
 */
function hydrate(row) {
  if (!row) return null;
  return {
    ...row,
    metadata: JSON.parse(row.metadata || '{}'),
    tags: fetchTags(row.id),
  };
}

/**
 * Write an event to the audit log.
 */
function logEvent({ memoryId, eventType, oldValue, newValue, actor, notes }) {
  db.prepare(
    `INSERT INTO memory_audit_log
     (id, memory_id, event_type, old_value, new_value, actor, event_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uuidv4(),
    memoryId,
    eventType,
    oldValue ? JSON.stringify(oldValue) : null,
    newValue ? JSON.stringify(newValue) : null,
    actor || 'system',
    now(),
    notes || null
  );
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Create a new memory.
 *
 * @param {object} params
 * @param {string} params.content
 * @param {string} params.topic       - Dot-delimited hierarchy, e.g. "user.preferences"
 * @param {string} params.source      - Provenance identifier
 * @param {string} params.source_type - 'user' | 'system' | 'inferred'
 * @param {number} [params.confidence=1.0]
 * @param {string[]} [params.tags=[]]
 * @param {number|null} [params.valid_from]
 * @param {number|null} [params.valid_until]
 * @param {object} [params.metadata={}]
 * @param {string} [params.actor]
 * @returns {object} The created memory
 */
const createMemory = db.transaction((params) => {
  const {
    content,
    topic,
    source,
    source_type,
    confidence = 1.0,
    tags = [],
    valid_from = null,
    valid_until = null,
    metadata = {},
    actor = 'system',
  } = params;

  const id = uuidv4();
  const ts = now();

  db.prepare(
    `INSERT INTO memories
     (id, content, topic, source, source_type, confidence, status,
      created_at, updated_at, valid_from, valid_until, metadata)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
  ).run(
    id,
    content.trim(),
    topic.trim().toLowerCase(),
    source,
    source_type,
    confidence,
    ts,
    ts,
    valid_from,
    valid_until,
    JSON.stringify(metadata)
  );

  // Insert tags
  const insertTag = db.prepare(
    'INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)'
  );
  for (const tag of tags) {
    insertTag.run(id, tag.trim().toLowerCase());
  }

  logEvent({
    memoryId: id,
    eventType: 'created',
    newValue: { content, topic, source, source_type, confidence, tags },
    actor,
  });

  return hydrate(db.prepare('SELECT * FROM memories WHERE id = ?').get(id));
});

// ─── Read ────────────────────────────────────────────────────────────────────

function getMemoryById(id) {
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
  return hydrate(row);
}

/**
 * List memories with optional filters.
 *
 * @param {object} filters
 * @param {string} [filters.status]      - default: 'active'
 * @param {string} [filters.topic]
 * @param {string} [filters.source_type]
 * @param {string} [filters.tag]
 * @param {number} [filters.limit=100]
 * @param {number} [filters.offset=0]
 */
function listMemories(filters = {}) {
  const {
    status,
    topic,
    source_type,
    tag,
    limit = 100,
    offset = 0,
  } = filters;

  let sql = 'SELECT DISTINCT m.* FROM memories m';
  const conditions = [];
  const params = [];

  if (tag) {
    sql += ' JOIN memory_tags mt ON mt.memory_id = m.id';
    conditions.push('mt.tag = ?');
    params.push(tag.toLowerCase());
  }

  if (status) {
    conditions.push('m.status = ?');
    params.push(status);
  } else {
    // Default: exclude deleted
    conditions.push("m.status != 'deleted'");
  }

  if (topic) {
    // Match exact or children (prefix match)
    conditions.push("(m.topic = ? OR m.topic LIKE ?)");
    params.push(topic.toLowerCase(), topic.toLowerCase() + '.%');
  }

  if (source_type) {
    conditions.push('m.source_type = ?');
    params.push(source_type);
  }

  if (conditions.length) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(sql).all(...params).map(hydrate);
}

// ─── Update ──────────────────────────────────────────────────────────────────

/**
 * Patch a memory's content and/or metadata.
 * Triggers an 'updated' audit log event.
 */
const updateMemory = db.transaction(({ id, updates, actor = 'system' }) => {
  const existing = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
  if (!existing) return null;
  if (existing.status === 'deleted') {
    throw new Error('Cannot update a deleted memory. Restore it first.');
  }

  const allowed = ['content', 'confidence', 'valid_from', 'valid_until', 'metadata', 'topic'];
  const setClauses = [];
  const params = [];
  const oldSnap = {};
  const newSnap = {};

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      oldSnap[key] = existing[key];
      newSnap[key] = key === 'metadata' ? JSON.stringify(updates[key]) : updates[key];
      setClauses.push(`${key} = ?`);
      params.push(newSnap[key]);
    }
  }

  if (!setClauses.length) return hydrate(existing);

  setClauses.push('updated_at = ?');
  params.push(now());
  params.push(id);

  db.prepare(`UPDATE memories SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

  // Handle tag updates
  if (updates.tags !== undefined) {
    db.prepare('DELETE FROM memory_tags WHERE memory_id = ?').run(id);
    const insertTag = db.prepare(
      'INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)'
    );
    for (const tag of updates.tags) {
      insertTag.run(id, tag.trim().toLowerCase());
    }
    oldSnap.tags = fetchTags(id);
    newSnap.tags = updates.tags;
  }

  logEvent({ memoryId: id, eventType: 'updated', oldValue: oldSnap, newValue: newSnap, actor });

  return hydrate(db.prepare('SELECT * FROM memories WHERE id = ?').get(id));
});

// ─── Soft Delete ─────────────────────────────────────────────────────────────

const deleteMemory = db.transaction(({ id, actor = 'system' }) => {
  const existing = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
  if (!existing) return null;
  if (existing.status === 'deleted') return hydrate(existing);

  const ts = now();
  db.prepare(`UPDATE memories SET status = 'deleted', updated_at = ? WHERE id = ?`).run(ts, id);

  logEvent({
    memoryId: id,
    eventType: 'deleted',
    oldValue: { status: existing.status },
    newValue: { status: 'deleted' },
    actor,
  });

  return hydrate(db.prepare('SELECT * FROM memories WHERE id = ?').get(id));
});

// ─── Restore ─────────────────────────────────────────────────────────────────

const restoreMemory = db.transaction(({ id, actor = 'system' }) => {
  const existing = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
  if (!existing) return null;
  if (existing.status !== 'deleted') return hydrate(existing);

  const ts = now();
  db.prepare(`UPDATE memories SET status = 'active', updated_at = ? WHERE id = ?`).run(ts, id);

  logEvent({
    memoryId: id,
    eventType: 'restored',
    oldValue: { status: 'deleted' },
    newValue: { status: 'active' },
    actor,
  });

  return hydrate(db.prepare('SELECT * FROM memories WHERE id = ?').get(id));
});

// ─── Status helpers (used by correctionResolver) ─────────────────────────────

function setStatus(id, status, actor, notes) {
  const ts = now();
  const existing = db.prepare('SELECT status FROM memories WHERE id = ?').get(id);
  if (!existing) return;

  db.prepare('UPDATE memories SET status = ?, updated_at = ? WHERE id = ?').run(status, ts, id);

  logEvent({
    memoryId: id,
    eventType: status === 'superseded' ? 'superseded'
             : status === 'contradicted' ? 'contradiction_flagged'
             : 'updated',
    oldValue: { status: existing.status },
    newValue: { status },
    actor,
    notes,
  });
}

module.exports = {
  createMemory,
  getMemoryById,
  listMemories,
  updateMemory,
  deleteMemory,
  restoreMemory,
  setStatus,
  logEvent,
  fetchTags,
};
