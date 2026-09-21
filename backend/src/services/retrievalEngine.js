/**
 * retrievalEngine.js — Deterministic memory retrieval with scoring and explanation.
 *
 * SCORING FORMULA (all components normalised to [0, 1]):
 *
 *   score = W_topic    × topicScore
 *         + W_tags     × tagScore
 *         + W_keywords × keywordScore
 *         + W_recency  × recencyScore
 *         + W_confidence × confidence
 *         − statusPenalty
 *
 * Tie-breaking: created_at DESC, then id ASC (total ordering → pure determinism).
 *
 * No randomness, no embeddings, no external calls.
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../db/db');

// ─── Default weights (configurable via process.env) ──────────────────────────

const WEIGHTS = {
  topic:      parseFloat(process.env.W_TOPIC      || '0.40'),
  tags:       parseFloat(process.env.W_TAGS       || '0.20'),
  keywords:   parseFloat(process.env.W_KEYWORDS   || '0.25'),
  recency:    parseFloat(process.env.W_RECENCY    || '0.10'),
  confidence: parseFloat(process.env.W_CONFIDENCE || '0.05'),
};
const STATUS_PENALTY_CONTRADICTED = 0.30;
const HALF_LIFE_DAYS = parseFloat(process.env.HALF_LIFE_DAYS || '30');

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
  if (shared > 0) return { score: 0.3 * (shared / Math.max(qParts.length, mParts.length)), matchType: 'partial' };

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

  const qTokens = tokenise(queryText);
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
function recencyScore(createdAt) {
  const daysSinceCreated = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
  const score = 1 / (1 + daysSinceCreated / HALF_LIFE_DAYS);
  return { score, daysSinceCreated: Math.round(daysSinceCreated) };
}

// ─── Status penalty ───────────────────────────────────────────────────────────

function statusPenalty(status) {
  if (status === 'contradicted') return STATUS_PENALTY_CONTRADICTED;
  if (status === 'superseded')   return 0.50; // heavily penalised
  return 0;
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
  const topic   = topicMatch(query.topic, memory.topic);
  const tags    = tagScore(query.tags || [], memory.tags || []);
  const kw      = keywordScore(query.query, memory.content);
  const recency = recencyScore(memory.created_at);
  const penalty = statusPenalty(memory.status);

  const raw =
    weights.topic      * topic.score   +
    weights.tags       * tags.score    +
    weights.keywords   * kw.score      +
    weights.recency    * recency.score +
    weights.confidence * memory.confidence;

  const score = Math.max(0, Math.min(1, raw - penalty));

  const explanation = {
    topic_match:      topic.matchType !== 'none',
    topic_match_type: topic.matchType,
    topic_score:      round(topic.score),
    tag_matches:      tags.matches,
    tag_score:        round(tags.score),
    keyword_matches:  kw.matches,
    keyword_score:    round(kw.score),
    recency_days:     recency.daysSinceCreated,
    recency_score:    round(recency.score),
    confidence_weight: memory.confidence,
    status_penalty:   penalty,
    raw_score:        round(raw),
    final_score:      round(score),
  };

  return { score, explanation };
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
    limit = 10,
    context,
  } = query;

  // Build candidate SQL
  let sql = `
    SELECT DISTINCT m.*
    FROM memories m
    WHERE m.status != 'deleted'
  `;
  const params = [];

  if (!include_superseded) {
    sql += ` AND m.status IN ('active', 'contradicted')`;
  } else {
    sql += ` AND m.status IN ('active', 'contradicted', 'superseded')`;
  }

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
    const { score, explanation } = computeScore(query, mem);
    return { memory: mem, score, explanation };
  });

  // Sort: score DESC, then created_at DESC, then id ASC (total ordering)
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.memory.created_at !== a.memory.created_at) return b.memory.created_at - a.memory.created_at;
    return a.memory.id.localeCompare(b.memory.id);
  });

  const totalCandidates = scored.length;
  const topResults = scored.slice(0, limit);

  // Shape results for response
  const results = topResults.map(({ memory, score, explanation }) => ({
    memory_id:    memory.id,
    content:      memory.content,
    topic:        memory.topic,
    source:       memory.source,
    source_type:  memory.source_type,
    status:       memory.status,
    confidence:   memory.confidence,
    tags:         memory.tags,
    created_at:   memory.created_at,
    score:        round(score),
    explanation,
  }));

  // Log the retrieval
  const logId = uuidv4();
  db.prepare(
    `INSERT INTO retrieval_log (id, query, filters, results, retrieved_at, context)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    logId,
    queryText,
    JSON.stringify({ topic, tags, source_type, include_superseded }),
    JSON.stringify(results),
    Date.now(),
    context || null
  );

  return {
    results,
    retrieval_log_id: logId,
    total_candidates: totalCandidates,
    filters_applied: { topic, tags, source_type, include_superseded },
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
  WEIGHTS,
};
