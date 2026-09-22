/**
 * retrievalEngine.js — Deterministic memory retrieval with scoring and explanation.
 *
 * SCORING FORMULA (all components normalised to [0, 1]):
 *
 *   score = W_category   × categoryScore
 *         + W_keywords   × keywordScore
 *         + W_tags       × tagScore
 *         + W_recency    × recencyScore
 *         + W_provenance × provenanceScore
 *         − statusPenalty
 *
 * Tie-breaking: status rank, updated_at DESC, created_at DESC, then id ASC.
 *
 * No randomness, no embeddings, no external calls.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../db/db');

// ─── Default weights (configurable via process.env) ──────────────────────────

const WEIGHTS = {
  category:   parseFloat(process.env.W_CATEGORY   || process.env.W_TOPIC || '0.40'),
  keywords:   parseFloat(process.env.W_KEYWORDS   || '0.25'),
  tags:       parseFloat(process.env.W_TAGS       || '0.15'),
  recency:    parseFloat(process.env.W_RECENCY    || '0.10'),
  provenance: parseFloat(process.env.W_PROVENANCE || '0.10'),
};
const SCORER_VERSION = 'deterministic-v2';
const HALF_LIFE_DAYS = parseFloat(process.env.HALF_LIFE_DAYS || '30');
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

// ─── Stop words ───────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','are','was','were','be','been','has','have','had',
  'do','does','did','will','would','could','should','may','might',
  'what','which','who','how','when','where','why','that','this','these',
  'those','it','its','my','your','our','their','his','her','i','you',
  'we','they','he','she','me','him','us','them',
]);

// ─── Topic matcher ────────────────────────────────────────────────────────────

/**
 * Score topic match deterministically.
 *
 * @param {string} queryTopic  - from query params (may be undefined)
 * @param {string} memTopic    - from memory row
 * @returns {{ score: number, matchType: string }}
 */
function topicMatch(queryTopic, memTopic) {
  if (!queryTopic) return { score: 0.5, matchType: 'none' }; // no filter = neutral

  const q = queryTopic.toLowerCase();
  const m = memTopic.toLowerCase();

  if (q === m)           return { score: 1.0, matchType: 'exact' };
  if (m.startsWith(q + '.')) return { score: 0.7, matchType: 'prefix' }; // query is parent
  if (q.startsWith(m + '.')) return { score: 0.5, matchType: 'parent' }; // memory is parent

  // Partial segment overlap (e.g. "user.pref" vs "user.profile")
  const qParts = q.split('.');
  const mParts = m.split('.');
  const shared = qParts.filter((p, i) => mParts[i] === p).length;
  if (shared > 0) return { score: 0.25 * (shared / Math.max(qParts.length, mParts.length)), matchType: 'partial' };

  return { score: 0.0, matchType: 'none' };
}

// ─── Tag scorer ───────────────────────────────────────────────────────────────

/**
 * Jaccard-like tag score.
 *
 * @param {string[]} queryTags  - requested tags (may be empty)
 * @param {string[]} memTags    - tags on the memory
 * @returns {{ score: number, matches: string[] }}
 */
function tagScore(queryTags, memTags) {
  if (!queryTags || queryTags.length === 0) return { score: 0.5, matches: [] };

  const qSet = new Set(queryTags.map((t) => t.toLowerCase()));
  const mSet = new Set(memTags.map((t) => t.toLowerCase()));
  const matches = [...qSet].filter((t) => mSet.has(t));

  const score = matches.length / qSet.size;
  return { score, matches };
}

// ─── Keyword scorer ───────────────────────────────────────────────────────────

/**
 * Tokenise a string into meaningful lowercase tokens.
 */
function tokenise(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Intersection-over-query keyword score (deterministic, no IDF).
 *
 * @param {string} queryText
 * @param {string} contentText
 * @returns {{ score: number, matches: string[] }}
 */
function keywordScore(queryText, contentText) {
  if (!queryText) return { score: 0, matches: [] };

  const qTokens = [...new Set(tokenise(queryText))];
  if (qTokens.length === 0) return { score: 0, matches: [] };

  const cTokens = new Set(tokenise(contentText));
  const matches = qTokens.filter((t) => cTokens.has(t));

  const score = matches.length / qTokens.length;
  return { score, matches };
}

// ─── Recency scorer ───────────────────────────────────────────────────────────

/**
 * Smooth exponential decay.
 * score = 1 / (1 + days / HALF_LIFE_DAYS)
 *
 * @param {number} createdAt - Unix ms timestamp
 * @returns {{ score: number, daysSinceCreated: number }}
 */
function recencyScore(createdAt, nowMs = Date.now()) {
  const daysSinceCreated = Math.max(0, (nowMs - createdAt) / (1000 * 60 * 60 * 24));
  const score = 1 / (1 + daysSinceCreated / HALF_LIFE_DAYS);
  return { score, daysSinceCreated: Math.round(daysSinceCreated) };
}

// ─── Status penalty ───────────────────────────────────────────────────────────

function statusPenalty(status) {
  if (status === 'superseded')   return 0.50; // heavily penalised
  return 0;
}

function provenanceScore(sourceType) {
  if (sourceType === 'user') return 1.0;
  if (sourceType === 'system') return 0.7;
  if (sourceType === 'inferred') return 0.4;
  return 0.0;
}

function statusRank(status) {
  if (status === 'active') return 0;
  if (status === 'superseded') return 1;
  return 2;
}

function evidenceLabels({ category, tags, kw, memory, penalty }) {
  const evidence = [];
  if (category.matchType !== 'none') evidence.push('topic_match');
  if (kw.matches.length > 0) evidence.push('keyword_match');
  if (tags.matches.length > 0) evidence.push('tag_match');
  if (memory.status === 'active') evidence.push('status_active');
  if (memory.status === 'superseded') evidence.push('status_superseded');
  if (memory.source_type) evidence.push(`source_${memory.source_type}`);
  if (penalty > 0) evidence.push('status_penalty');
  return evidence;
}

// ─── Main score function (exported for unit tests) ───────────────────────────

/**
 * Compute the full deterministic score for a memory against a query.
 *
 * @param {object} query
 * @param {object} memory  - hydrated memory row (includes .tags)
 * @param {object} [weights] - override default weights
 * @returns {{ score: number, explanation: object }}
 */
function computeScore(query, memory, weights = WEIGHTS) {
  const nowMs   = query.now || Date.now();
  const topic   = topicMatch(query.topic, memory.topic);
  const tags    = tagScore(query.tags || [], memory.tags || []);
  const keywordCorpus = [
    memory.content,
    memory.topic,
    ...(memory.tags || []),
    memory.metadata?.canonical_key || '',
  ].join(' ');
  const kw      = keywordScore(query.query, keywordCorpus);
  const recency = recencyScore(memory.updated_at || memory.created_at, nowMs);
  const provenance = provenanceScore(memory.source_type);
  const penalty = statusPenalty(memory.status);

  const raw =
    weights.category   * topic.score      +
    weights.keywords   * kw.score         +
    weights.tags       * tags.score       +
    weights.recency    * recency.score    +
    weights.provenance * provenance;

  const score = round(Math.max(0, Math.min(1, raw - penalty)));
  const matchedFields = [];
  if (topic.matchType !== 'none') matchedFields.push('topic');
  if (kw.matches.length > 0) matchedFields.push('content');
  if (tags.matches.length > 0) matchedFields.push('tags');

  const retrievalEvidence = {
    scorer_version: SCORER_VERSION,
    category: { type: topic.matchType, score: round(topic.score) },
    keywords: { matched: kw.matches, score: round(kw.score) },
    tags: { matched: tags.matches, score: round(tags.score) },
    recency: { age_days: recency.daysSinceCreated, score: round(recency.score) },
    provenance: { source_type: memory.source_type, score: provenance },
    status: { status: memory.status, penalty },
    raw_score: round(raw),
    final_score: round(score),
  };

  const explanation = {
    topic_match: topic.matchType !== 'none',
    topic_match_type: topic.matchType,
    topic_score: round(topic.score),
    tag_matches: tags.matches,
    tag_score: round(tags.score),
    keyword_matches: kw.matches,
    keyword_score: round(kw.score),
    recency_days: recency.daysSinceCreated,
    recency_score: round(recency.score),
    provenance_score: provenance,
    status_penalty: penalty,
    raw_score: round(raw),
    final_score: round(score),
  };

  return {
    score,
    matched_fields: matchedFields,
    evidence: evidenceLabels({ category: topic, tags, kw, memory, penalty }),
    retrieval_evidence: retrievalEvidence,
    explanation,
  };
}

function round(n) {
  return Math.round(n * 10000) / 10000;
}

// ─── Main retrieve function ───────────────────────────────────────────────────

/**
 * Retrieve and rank memories for a query.
 *
 * @param {object} query
 * @param {string} query.query               - free-text query
 * @param {string} [query.topic]             - topic filter
 * @param {string[]} [query.tags]            - tag filter
 * @param {string} [query.source_type]       - source_type filter
 * @param {boolean} [query.include_superseded=false]
 * @param {number} [query.limit=10]
 * @param {string} [query.context]           - caller context (logged)
 * @returns {object}  { results, retrieval_log_id, total_candidates, filters_applied }
 */
function retrieve(query) {
  const {
    query: queryText = '',
    topic,
    tags = [],
    source_type,
    include_superseded = false,
    limit = DEFAULT_LIMIT,
    context,
  } = query;

  // Build candidate SQL
  let sql = `
    SELECT DISTINCT m.*
    FROM memories m
    WHERE m.status != 'deleted'
  `;
  const params = [];

  sql += include_superseded
    ? ` AND m.status IN ('active', 'superseded')`
    : ` AND m.status = 'active'`;

  if (topic) {
    sql += ` AND (m.topic = ? OR m.topic LIKE ? OR ? LIKE m.topic || '.%')`;
    const t = topic.toLowerCase();
    params.push(t, t + '.%', t);
  }

  if (source_type) {
    sql += ` AND m.source_type = ?`;
    params.push(source_type);
  }

  if (tags && tags.length > 0) {
    // At least one matching tag required
    const placeholders = tags.map(() => '?').join(', ');
    sql += `
      AND EXISTS (
        SELECT 1 FROM memory_tags mt
        WHERE mt.memory_id = m.id AND mt.tag IN (${placeholders})
      )
    `;
    tags.forEach((t) => params.push(t.toLowerCase()));
  }

  const rawRows = db.prepare(sql).all(...params);

  // Hydrate tags for each candidate
  const fetchTags = db.prepare('SELECT tag FROM memory_tags WHERE memory_id = ? ORDER BY tag ASC');
  const candidates = rawRows.map((row) => ({
    ...row,
    metadata: JSON.parse(row.metadata || '{}'),
    tags: fetchTags.all(row.id).map((r) => r.tag),
  }));

  // Score all candidates
  const scored = candidates.map((mem) => {
    const scoredMemory = computeScore(query, mem);
    return { memory: mem, ...scoredMemory };
  });

  // Sort: score DESC, status rank, updated_at DESC, created_at DESC, id ASC.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (statusRank(a.memory.status) !== statusRank(b.memory.status)) {
      return statusRank(a.memory.status) - statusRank(b.memory.status);
    }
    if ((b.memory.updated_at || 0) !== (a.memory.updated_at || 0)) {
      return (b.memory.updated_at || 0) - (a.memory.updated_at || 0);
    }
    if (b.memory.created_at !== a.memory.created_at) return b.memory.created_at - a.memory.created_at;
    return a.memory.id.localeCompare(b.memory.id);
  });

  const totalCandidates = scored.length;
  const boundedLimit = Math.max(1, Math.min(parseInt(limit, 10) || DEFAULT_LIMIT, MAX_LIMIT));
  const topResults = scored.slice(0, boundedLimit);

  // Shape results for response
  const results = topResults.map(({ memory, score, explanation, evidence, matched_fields, retrieval_evidence }) => ({
    memory_id:    memory.id,
    memoryId:     memory.id,
    content:      memory.content,
    memory:       memory.content,
    topic:        memory.topic,
    source:       memory.source,
    source_type:  memory.source_type,
    status:       memory.status,
    confidence:   memory.confidence,
    tags:         memory.tags,
    created_at:   memory.created_at,
    score:        round(score),
    matched_fields,
    evidence,
    retrieval_evidence,
    explanation,
  }));

  // Log the retrieval
  const logId = uuidv4();
  db.prepare(
    `INSERT INTO retrieval_log (id, query, filters, results, retrieved_at, context, scorer)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    logId,
    queryText,
    JSON.stringify({ topic, tags, source_type, include_superseded }),
    JSON.stringify(results),
    Date.now(),
    context || null,
    JSON.stringify({ version: SCORER_VERSION, weights: WEIGHTS, half_life_days: HALF_LIFE_DAYS })
  );

  return {
    results,
    retrieval_log_id: logId,
    total_candidates: totalCandidates,
    filters_applied: { topic, tags, source_type, include_superseded, limit: boundedLimit },
    scorer: { version: SCORER_VERSION, weights: WEIGHTS },
  };
}

/**
 * Replay a past retrieval from the log.
 */
function getRetrievalLog(id) {
  const row = db.prepare('SELECT * FROM retrieval_log WHERE id = ?').get(id);
  if (!row) return null;
  return {
    ...row,
    filters: JSON.parse(row.filters || '{}'),
    results: JSON.parse(row.results || '[]'),
    scorer: JSON.parse(row.scorer || '{}'),
  };
}

function listRetrievalLogs({ limit = 20, offset = 0 } = {}) {
  return db
    .prepare('SELECT * FROM retrieval_log ORDER BY retrieved_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset)
    .map((row) => ({
      ...row,
      filters: JSON.parse(row.filters || '{}'),
      results: JSON.parse(row.results || '[]'),
      scorer: JSON.parse(row.scorer || '{}'),
    }));
}

module.exports = {
  retrieve,
  computeScore,
  topicMatch,
  tagScore,
  keywordScore,
  recencyScore,
  getRetrievalLog,
  listRetrievalLogs,
  provenanceScore,
  WEIGHTS,
  SCORER_VERSION,
};
