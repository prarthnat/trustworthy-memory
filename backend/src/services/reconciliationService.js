/**
 * reconciliationService.js — Deterministic correction and ambiguity handling.
 *
 * Supersession requires the same canonical fact key. Ambiguous conflicts are
 * annotated separately and do not change lifecycle state.
 */

'use strict';

const db = require('../db/db');
const {
  createSupersession,
  recordAmbiguousConflict,
} = require('./memoryService');

const REPLACEMENT_SIGNALS = [
  'moved to',
  'moved back to',
  'now',
  'no longer',
  'instead',
  'changed to',
  'switched to',
  'correcting',
  'actually',
  'current',
  'new',
];

const COEXISTENCE_SIGNALS = [
  'recently',
  'sometimes',
  'also',
  'trying',
  'occasionally',
  'from time to time',
  'been enjoying',
];

const SINGLE_VALUED_SUFFIXES = [
  'home_city',
  'current',
  'primary',
  'favorite',
  'name',
  'timezone',
  'diet.current',
  'currency',
];

function normalise(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function metadataOf(memory) {
  if (!memory || !memory.metadata) return {};
  if (typeof memory.metadata === 'object') return memory.metadata;
  try {
    return JSON.parse(memory.metadata);
  } catch (_err) {
    return {};
  }
}

function canonicalKey(memory) {
  const metadata = metadataOf(memory);
  return normalise(metadata.canonical_key || memory.canonical_key || memory.topic);
}

function tagsOf(memory) {
  if (Array.isArray(memory.tags)) return memory.tags.map(normalise);
  return db
    .prepare('SELECT tag FROM memory_tags WHERE memory_id = ? ORDER BY tag ASC')
    .all(memory.id)
    .map((row) => normalise(row.tag));
}

function hasAnySignal(content, signals) {
  const text = normalise(content);
  return signals.some((signal) => text.includes(signal));
}

function isSingleValuedKey(key) {
  return SINGLE_VALUED_SUFFIXES.some((suffix) => key === suffix || key.endsWith(`.${suffix}`));
}

function sameCanonicalFact(existing, incoming) {
  return canonicalKey(existing) === canonicalKey(incoming);
}

function directUserAssertion(memory) {
  return memory.source_type === 'user' && (memory.confidence ?? 1) >= 0.9;
}

function possiblyRelatedPreference(existing, incoming) {
  const existingTags = new Set(tagsOf(existing));
  const incomingTags = tagsOf(incoming);
  const sharedTags = incomingTags.filter((tag) => existingTags.has(tag));
  if (sharedTags.length === 0) return false;

  const existingTopic = normalise(existing.topic);
  const incomingTopic = normalise(incoming.topic);
  return (
    existingTopic.startsWith('user.preference') ||
    incomingTopic.startsWith('user.preference') ||
    existingTags.has('ide') ||
    existingTags.has('language')
  );
}

function classify(existing, incoming) {
  const existingContent = normalise(existing.content);
  const incomingContent = normalise(incoming.content);
  const incomingKey = canonicalKey(incoming);

  if (existingContent === incomingContent) {
    return {
      action: 'duplicate',
      rule: 'EXACT_CONTENT_MATCH',
      reason: 'Incoming content is identical to an existing memory.',
    };
  }

  if (existing.status === 'deleted' || existing.status === 'superseded') {
    return {
      action: 'accept',
      rule: 'ONLY_ACTIVE_MEMORIES_RECONCILED',
      reason: 'Historical memory does not affect a new active memory.',
    };
  }

  if (existing.valid_until && existing.valid_until < Date.now() && sameCanonicalFact(existing, incoming)) {
    return {
      action: 'supersede',
      rule: 'TEMPORAL_SUPERSESSION',
      reason: `Existing memory expired at ${new Date(existing.valid_until).toISOString()}.`,
    };
  }

  if (
    sameCanonicalFact(existing, incoming) &&
    directUserAssertion(incoming) &&
    (isSingleValuedKey(incomingKey) || hasAnySignal(incoming.content, REPLACEMENT_SIGNALS))
  ) {
    return {
      action: 'supersede',
      rule: 'EXPLICIT_CANONICAL_REPLACEMENT',
      reason: `Incoming user memory replaces canonical fact "${incomingKey}".`,
    };
  }

  if (
    !sameCanonicalFact(existing, incoming) &&
    possiblyRelatedPreference(existing, incoming) &&
    (hasAnySignal(incoming.content, COEXISTENCE_SIGNALS) || hasAnySignal(existing.content, COEXISTENCE_SIGNALS))
  ) {
    return {
      action: 'annotate_conflict',
      rule: 'AMBIGUOUS_NON_REPLACEMENT',
      reason: 'Related preference can coexist; annotate ambiguity without supersession.',
    };
  }

  return {
    action: 'accept',
    rule: 'NO_REPLACEMENT',
    reason: 'No explicit canonical replacement was detected.',
  };
}

function findReconciliationCandidates(incoming) {
  return db
    .prepare(
      `SELECT * FROM memories
       WHERE status = 'active'
         AND id != ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(incoming.id || '__none__');
}

const reconcileMemory = db.transaction((newMemory, actor = 'system') => {
  const candidates = findReconciliationCandidates(newMemory);
  const decisions = [];

  for (const existing of candidates) {
    const decision = classify(existing, newMemory);

    if (decision.action === 'supersede') {
      createSupersession({
        oldMemoryId: existing.id,
        newMemoryId: newMemory.id,
        reason: decision.reason,
        actor,
      });
    }

    if (decision.action === 'annotate_conflict') {
      recordAmbiguousConflict({
        memoryId: existing.id,
        relatedMemoryId: newMemory.id,
        reason: decision.reason,
        actor,
      });
    }

    if (decision.action !== 'accept') {
      decisions.push({ existing_id: existing.id, new_id: newMemory.id, ...decision });
    }
  }

  return {
    reconciled: decisions.length > 0,
    decisions,
  };
});

function manualSupersede(oldId, newId, reason, actor = 'system') {
  return createSupersession({
    oldMemoryId: oldId,
    newMemoryId: newId,
    reason,
    actor,
  });
}

function getSupersessionChain(memoryId) {
  const previous = db
    .prepare(
      `SELECT s.*, m.content AS old_content, m.topic AS old_topic, m.status AS old_status
       FROM memory_supersessions s
       JOIN memories m ON m.id = s.old_memory_id
       WHERE s.new_memory_id = ?
       ORDER BY s.superseded_at ASC, s.old_memory_id ASC`
    )
    .all(memoryId);

  const next = db
    .prepare(
      `SELECT s.*, m.content AS new_content, m.topic AS new_topic, m.status AS new_status
       FROM memory_supersessions s
       JOIN memories m ON m.id = s.new_memory_id
       WHERE s.old_memory_id = ?
       ORDER BY s.superseded_at ASC, s.new_memory_id ASC`
    )
    .all(memoryId);

  return {
    supersedes: previous,
    superseded_by: next,
  };
}

module.exports = {
  classify,
  canonicalKey,
  findReconciliationCandidates,
  reconcileMemory,
  resolveConflicts: reconcileMemory,
  manualSupersede,
  getSupersessionChain,
};
