/**
 * correctionResolver.js — Classify incoming corrections and resolve conflicts.
 *
 * Decision rules (ordered by precedence):
 *
 *   1. DUPLICATE         — content identical → skip
 *   2. HIGH_CONFIDENCE   — user source + conf ≥ 0.9 + same topic → supersede
 *   3. TEMPORAL_EXPIRED  — old memory valid_until < now → supersede (expired)
 *   4. USER_OVER_SYSTEM  — new=user, old=system → supersede
 *   5. CONTRADICTION     — low confidence or inferred → flag both as contradicted
 *   6. SAME_SOURCE_UPDATE — same source, different content → update in place
 *
 * Returns a structured decision that the route handler can act on.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../db/db');
const { setStatus, logEvent } = require('./memoryService');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalise(str) {
  return (str || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function topicsMatch(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

// ─── Core classifier ─────────────────────────────────────────────────────────

/**
 * Classify the relationship between an existing memory and a proposed new one.
 *
 * @param {object} existing  - full memory object from DB
 * @param {object} incoming  - proposed new memory (not yet inserted)
 * @returns {{ action: string, reason: string, rule: string }}
 *
 *   action: 'duplicate' | 'supersede' | 'contradict' | 'update_in_place' | 'accept'
 */
function classify(existing, incoming) {
  const existingContent = normalise(existing.content);
  const incomingContent = normalise(incoming.content);

  // ── Rule 1: Exact duplicate ───────────────────────────────────────────────
  if (existingContent === incomingContent) {
    return {
      action: 'duplicate',
      rule:   'EXACT_CONTENT_MATCH',
      reason: 'Incoming content is identical to existing memory. Skipping.',
    };
  }

  // ── Rule 2: High-confidence user correction ───────────────────────────────
  if (
    incoming.source_type === 'user' &&
    (incoming.confidence || 1.0) >= 0.9 &&
    topicsMatch(existing.topic, incoming.topic)
  ) {
    return {
      action: 'supersede',
      rule:   'HIGH_CONFIDENCE_CORRECTION',
      reason: `User assertion (confidence=${incoming.confidence}) supersedes existing memory on topic "${existing.topic}".`,
    };
  }

  // ── Rule 3: Temporal expiry ───────────────────────────────────────────────
  if (existing.valid_until && existing.valid_until < Date.now()) {
    return {
      action: 'supersede',
      rule:   'TEMPORAL_SUPERSESSION',
      reason: `Existing memory expired at ${new Date(existing.valid_until).toISOString()}.`,
    };
  }

  // ── Rule 4: User assertion over system memory ─────────────────────────────
  if (existing.source_type === 'system' && incoming.source_type === 'user') {
    return {
      action: 'supersede',
      rule:   'SYSTEM_VS_USER',
      reason: 'User assertion always supersedes system-generated memory.',
    };
  }

  // ── Rule 5: Same source, different content → update in place ─────────────
  if (existing.source === incoming.source && topicsMatch(existing.topic, incoming.topic)) {
    return {
      action: 'update_in_place',
      rule:   'SAME_SOURCE_UPDATE',
      reason: `Same source "${existing.source}" updating its own memory.`,
    };
  }

  // ── Rule 6: Conservative contradiction ───────────────────────────────────
  // (low confidence OR inferred source → don't pick a winner)
  if (
    (incoming.confidence || 1.0) < 0.9 ||
    incoming.source_type === 'inferred'
  ) {
    return {
      action: 'contradict',
      rule:   'LOWER_CONFIDENCE_CONFLICT',
      reason: `Incoming memory (confidence=${incoming.confidence}, source_type="${incoming.source_type}") conflicts but cannot safely supersede. Both flagged as contradicted.`,
    };
  }

  // Default: accept the new memory without touching the old one
  return {
    action: 'accept',
    rule:   'NO_CONFLICT',
    reason: 'No conflict detected with existing memories. Accepted as new memory.',
  };
}

// ─── Find conflicting memories ────────────────────────────────────────────────

/**
 * Search for existing active/contradicted memories on the same topic
 * that might conflict with incoming content.
 *
 * Uses a conservative heuristic: same topic = potential conflict.
 *
 * @param {object} incoming
 * @returns {object[]} existing memories on same topic
 */
function findConflicts(incoming) {
  const topic = (incoming.topic || '').toLowerCase();

  return db
    .prepare(
      `SELECT * FROM memories
       WHERE topic = ?
         AND status IN ('active', 'contradicted')
         AND id != ?`
    )
    .all(topic, incoming.id || '__none__');
}

// ─── Execute resolution ───────────────────────────────────────────────────────

/**
 * After a new memory is inserted, resolve any conflicts with existing memories.
 * This is called transactionally from the memories route.
 *
 * @param {object} newMemory  - the freshly inserted memory object
 * @param {string} actor
 * @returns {{ resolved: boolean, conflicts: object[], decisions: object[] }}
 */
const resolveConflicts = db.transaction((newMemory, actor = 'system') => {
  const conflicts = findConflicts(newMemory);
  const decisions = [];

  for (const existing of conflicts) {
    const decision = classify(existing, newMemory);

    if (decision.action === 'duplicate') {
      decisions.push({ existing_id: existing.id, ...decision });
      continue;
    }

    if (decision.action === 'supersede') {
      // Mark old as superseded
      setStatus(existing.id, 'superseded', actor, decision.reason);

      // Record the supersession edge
      db.prepare(
        `INSERT INTO memory_supersessions
         (id, old_memory_id, new_memory_id, reason, superseded_at, superseded_by)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        uuidv4(),
        existing.id,
        newMemory.id,
        decision.reason,
        Date.now(),
        actor
      );
    }

    if (decision.action === 'contradict') {
      setStatus(existing.id, 'contradicted', actor, decision.reason);
      setStatus(newMemory.id, 'contradicted', actor, decision.reason);
    }

    if (decision.action === 'update_in_place') {
      // Treat as supersession (old is replaced by new from same source)
      setStatus(existing.id, 'superseded', actor, decision.reason);
      db.prepare(
        `INSERT INTO memory_supersessions
         (id, old_memory_id, new_memory_id, reason, superseded_at, superseded_by)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        uuidv4(),
        existing.id,
        newMemory.id,
        decision.reason,
        Date.now(),
        actor
      );
    }

    decisions.push({ existing_id: existing.id, new_id: newMemory.id, ...decision });
  }

  return {
    resolved: decisions.length > 0,
    conflicts: conflicts.map((c) => c.id),
    decisions,
  };
});

/**
 * Manually supersede a memory with another (explicit operator action).
 *
 * @param {string} oldId
 * @param {string} newId
 * @param {string} reason
 * @param {string} actor
 */
const manualSupersede = db.transaction((oldId, newId, reason, actor = 'system') => {
  const oldMem = db.prepare('SELECT * FROM memories WHERE id = ?').get(oldId);
  const newMem = db.prepare('SELECT * FROM memories WHERE id = ?').get(newId);

  if (!oldMem) throw new Error(`Memory ${oldId} not found`);
  if (!newMem) throw new Error(`Memory ${newId} not found`);

  setStatus(oldId, 'superseded', actor, reason);

  db.prepare(
    `INSERT INTO memory_supersessions
     (id, old_memory_id, new_memory_id, reason, superseded_at, superseded_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(uuidv4(), oldId, newId, reason, Date.now(), actor);

  return {
    old_memory_id: oldId,
    new_memory_id: newId,
    reason,
    action: 'superseded',
  };
});

/**
 * Get the full supersession chain for a memory (upstream and downstream).
 */
function getSupersessionChain(memoryId) {
  // Downstream: what did this memory supersede?
  const superseded = db
    .prepare(
      `SELECT s.*, m.content AS old_content, m.topic AS old_topic, m.status AS old_status
       FROM memory_supersessions s
       JOIN memories m ON m.id = s.old_memory_id
       WHERE s.new_memory_id = ?
       ORDER BY s.superseded_at ASC`
    )
    .all(memoryId);

  // Upstream: what superseded this memory?
  const supersededBy = db
    .prepare(
      `SELECT s.*, m.content AS new_content, m.topic AS new_topic, m.status AS new_status
       FROM memory_supersessions s
       JOIN memories m ON m.id = s.new_memory_id
       WHERE s.old_memory_id = ?
       ORDER BY s.superseded_at ASC`
    )
    .all(memoryId);

  return { superseded_memories: superseded, superseded_by: supersededBy };
}

module.exports = {
  classify,
  findConflicts,
  resolveConflicts,
  manualSupersede,
  getSupersessionChain,
};
