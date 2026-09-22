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

function normaliseTopic(topic) {
  return (topic || 'general').trim().toLowerCase();
}

function normaliseTag(tag) {
  return String(tag || '').trim().toLowerCase();
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch (_err) {
    return fallback;
  }
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
    metadata: parseJson(row.metadata, {}),
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
    id = uuidv4(),
    created_at,
    updated_at,
    status = 'active',
  } = params;

  const ts = created_at || now();
  const updateTs = updated_at || ts;

  db.prepare(
    `INSERT INTO memories
     (id, content, topic, source, source_type, confidence, status,
      created_at, updated_at, valid_from, valid_until, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    content.trim(),
    normaliseTopic(topic),
    source,
    source_type,
    confidence,
    status,
    ts,
    updateTs,
    valid_from,
    valid_until,
    JSON.stringify(metadata)
  );

  // Insert tags
  const insertTag = db.prepare(
    'INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)'
  );
  for (const tag of tags) {
    const normalised = normaliseTag(tag);
    if (normalised) insertTag.run(id, normalised);
  }

  logEvent({
    memoryId: id,
    eventType: 'created',
    newValue: { content, topic: normaliseTopic(topic), source, source_type, confidence, tags, status },
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

  const allowed = ['content', 'confidence', 'valid_from', 'valid_until', 'metadata', 'topic', 'source', 'source_type'];
  const setClauses = [];
  const params = [];
  const oldSnap = {};
  const newSnap = {};

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      oldSnap[key] = existing[key];
      const nextValue = key === 'metadata'
        ? JSON.stringify(updates[key])
        : key === 'topic'
          ? normaliseTopic(updates[key])
          : updates[key];
      newSnap[key] = nextValue;
      setClauses.push(`${key} = ?`);
      params.push(nextValue);
    }
  }

  if (!setClauses.length) return hydrate(existing);

  setClauses.push('updated_at = ?');
  params.push(now());
  params.push(id);

  db.prepare(`UPDATE memories SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

  // Handle tag updates
  if (updates.tags !== undefined) {
    oldSnap.tags = fetchTags(id);
    db.prepare('DELETE FROM memory_tags WHERE memory_id = ?').run(id);
    const insertTag = db.prepare(
      'INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)'
    );
    for (const tag of updates.tags) {
      const normalised = normaliseTag(tag);
      if (normalised) insertTag.run(id, normalised);
    }
    newSnap.tags = updates.tags.map(normaliseTag).filter(Boolean);
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

  const replacement = db
    .prepare(
      `SELECT m.id
       FROM memory_supersessions s
       JOIN memories m ON m.id = s.new_memory_id
       WHERE s.old_memory_id = ? AND m.status = 'active'
       LIMIT 1`
    )
    .get(id);
  if (replacement) {
    throw new Error(`Cannot restore memory ${id}; active successor ${replacement.id} exists.`);
  }

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
  if (!['active', 'superseded', 'deleted'].includes(status)) {
    throw new Error(`Invalid memory status "${status}"`);
  }
  const ts = now();
  const existing = db.prepare('SELECT status FROM memories WHERE id = ?').get(id);
  if (!existing) return;

  db.prepare('UPDATE memories SET status = ?, updated_at = ? WHERE id = ?').run(status, ts, id);

  logEvent({
    memoryId: id,
    eventType: status === 'superseded' ? 'superseded'
             : status === 'deleted' ? 'deleted'
             : status === 'active' ? 'restored'
             : 'updated',
    oldValue: { status: existing.status },
    newValue: { status },
    actor,
    notes,
  });
}

const createSupersession = db.transaction(({
  oldMemoryId,
  newMemoryId,
  reason,
  actor = 'system',
  supersededAt = now(),
}) => {
  if (oldMemoryId === newMemoryId) {
    throw new Error('A memory cannot supersede itself.');
  }

  const oldMem = db.prepare('SELECT * FROM memories WHERE id = ?').get(oldMemoryId);
  const newMem = db.prepare('SELECT * FROM memories WHERE id = ?').get(newMemoryId);
  if (!oldMem) throw new Error(`Memory ${oldMemoryId} not found`);
  if (!newMem) throw new Error(`Memory ${newMemoryId} not found`);
  if (oldMem.status === 'deleted') throw new Error('Cannot supersede a deleted memory.');

  setStatus(oldMemoryId, 'superseded', actor, reason);
  db.prepare(
    `INSERT OR IGNORE INTO memory_supersessions
     (id, old_memory_id, new_memory_id, reason, superseded_at, superseded_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(uuidv4(), oldMemoryId, newMemoryId, reason, supersededAt, actor);

  return {
    old_memory_id: oldMemoryId,
    new_memory_id: newMemoryId,
    reason,
    action: 'superseded',
  };
});

const recordAmbiguousConflict = db.transaction(({
  memoryId,
  relatedMemoryId,
  reason,
  actor = 'system',
}) => {
  if (memoryId === relatedMemoryId) {
    throw new Error('A memory cannot conflict with itself.');
  }

  const ts = now();
  db.prepare(
    `INSERT OR IGNORE INTO memory_conflicts
     (id, memory_id, related_memory_id, conflict_type, reason, created_at)
     VALUES (?, ?, ?, 'ambiguous', ?, ?)`
  ).run(uuidv4(), memoryId, relatedMemoryId, reason, ts);

  db.prepare(
    `INSERT OR IGNORE INTO memory_conflicts
     (id, memory_id, related_memory_id, conflict_type, reason, created_at)
     VALUES (?, ?, ?, 'ambiguous', ?, ?)`
  ).run(uuidv4(), relatedMemoryId, memoryId, reason, ts);

  logEvent({
    memoryId,
    eventType: 'contradiction_flagged',
    newValue: { related_memory_id: relatedMemoryId, conflict_type: 'ambiguous' },
    actor,
    notes: reason,
  });
  logEvent({
    memoryId: relatedMemoryId,
    eventType: 'contradiction_flagged',
    newValue: { related_memory_id: memoryId, conflict_type: 'ambiguous' },
    actor,
    notes: reason,
  });

  return { memory_id: memoryId, related_memory_id: relatedMemoryId, conflict_type: 'ambiguous', reason };
});

function getConflicts(memoryId) {
  return db
    .prepare(
      `SELECT c.*, m.content AS related_content, m.topic AS related_topic, m.status AS related_status
       FROM memory_conflicts c
       JOIN memories m ON m.id = c.related_memory_id
       WHERE c.memory_id = ? AND c.resolved_at IS NULL
       ORDER BY c.created_at ASC, c.related_memory_id ASC`
    )
    .all(memoryId);
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
  createSupersession,
  recordAmbiguousConflict,
  getConflicts,
};
