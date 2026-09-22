/**
 * retrievalEngine.test.js — Unit tests for the scoring sub-functions.
 *
 * These tests exercise pure functions with no DB dependency.
 * They establish the mathematical invariants of the retrieval system.
 */

import { describe, it, expect } from 'vitest';
import {
  topicMatch,
  tagScore,
  keywordScore,
  recencyScore,
  computeScore,
  WEIGHTS,
} from '../../src/services/retrievalEngine.js';

// ─── topicMatch ───────────────────────────────────────────────────────────────

describe('topicMatch', () => {
  it('returns 1.0 for exact match', () => {
    expect(topicMatch('user.preferences', 'user.preferences').score).toBe(1.0);
    expect(topicMatch('user.preferences', 'user.preferences').matchType).toBe('exact');
  });

  it('returns 0.7 for prefix match (query is parent)', () => {
    const result = topicMatch('user.preferences', 'user.preferences.ui');
    expect(result.matchType).toBe('prefix');
    expect(result.score).toBe(0.7);
  });

  it('returns 0.5 for parent match (memory is parent)', () => {
    const result = topicMatch('user.preferences.ui', 'user.preferences');
    expect(result.matchType).toBe('parent');
    expect(result.score).toBe(0.5);
  });

  it('returns 0.0 for completely different topics', () => {
    const result = topicMatch('user.preferences', 'system.metrics');
    expect(result.score).toBe(0.0);
    expect(result.matchType).toBe('none');
  });

  it('returns neutral 0.5 when no query topic provided', () => {
    const result = topicMatch(undefined, 'user.preferences');
    expect(result.score).toBe(0.5);
    expect(result.matchType).toBe('none');
  });

  it('is case-insensitive', () => {
    expect(topicMatch('User.Preferences', 'user.preferences').score).toBe(1.0);
  });
});

// ─── tagScore ─────────────────────────────────────────────────────────────────

describe('tagScore', () => {
  it('returns 1.0 when all query tags match', () => {
    const { score, matches } = tagScore(['ui', 'preferences'], ['ui', 'preferences', 'extra']);
    expect(score).toBe(1.0);
    expect(matches).toEqual(expect.arrayContaining(['ui', 'preferences']));
  });

  it('returns 0.5 when half of query tags match', () => {
    const { score } = tagScore(['ui', 'accessibility'], ['ui']);
    expect(score).toBe(0.5);
  });

  it('returns 0.0 when no query tags match', () => {
    const { score } = tagScore(['notifications'], ['ui', 'preferences']);
    expect(score).toBe(0.0);
  });

  it('returns neutral 0.5 when no query tags provided', () => {
    const { score } = tagScore([], ['ui', 'preferences']);
    expect(score).toBe(0.5);
  });

  it('is case-insensitive', () => {
    const { score } = tagScore(['UI'], ['ui']);
    expect(score).toBe(1.0);
  });
});

// ─── keywordScore ─────────────────────────────────────────────────────────────

describe('keywordScore', () => {
  it('returns 1.0 when all meaningful query words appear in content', () => {
    const { score } = keywordScore('dark mode', 'User prefers dark mode interface');
    expect(score).toBe(1.0);
  });

  it('removes stop words before scoring', () => {
    // "the", "is", "a" are stop words — query reduces to "dark mode"
    const { score } = keywordScore('the user is in a dark mode', 'dark mode enabled');
    expect(score).toBeGreaterThan(0);
  });

  it('returns 0 for empty query', () => {
    const { score } = keywordScore('', 'User prefers dark mode');
    expect(score).toBe(0);
  });

  it('returns 0 when no keywords overlap', () => {
    const { score } = keywordScore('weather forecast rain', 'User prefers dark mode');
    expect(score).toBe(0);
  });

  it('is case-insensitive', () => {
    const { score } = keywordScore('DARK MODE', 'user prefers dark mode');
    expect(score).toBe(1.0);
  });
});

// ─── recencyScore ─────────────────────────────────────────────────────────────

describe('recencyScore', () => {
  it('returns close to 1.0 for a memory created just now', () => {
    const { score } = recencyScore(Date.now());
    expect(score).toBeGreaterThan(0.99);
  });

  it('returns ~0.5 for a memory created 30 days ago (half-life)', () => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const { score } = recencyScore(thirtyDaysAgo);
    expect(score).toBeGreaterThan(0.45);
    expect(score).toBeLessThan(0.55);
  });

  it('returns a smaller score for older memories', () => {
    const old  = recencyScore(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const recent = recencyScore(Date.now() - 1 * 24 * 60 * 60 * 1000);
    expect(recent.score).toBeGreaterThan(old.score);
  });

  it('is always positive and monotonically decreasing', () => {
    const scores = [0, 10, 30, 60, 90, 180, 365].map((d) =>
      recencyScore(Date.now() - d * 24 * 60 * 60 * 1000).score
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
      expect(scores[i]).toBeGreaterThan(0);
    }
  });
});

// ─── computeScore ─────────────────────────────────────────────────────────────

describe('computeScore', () => {
  const baseMemory = {
    id:          'test-001',
    content:     'User prefers dark mode',
    topic:       'user.preferences',
    source:      'settings',
    source_type: 'user',
    confidence:  1.0,
    status:      'active',
    tags:        ['ui', 'preferences'],
    created_at:  Date.now() - 1000,
  };

  it('returns a score between 0 and 1', () => {
    const query = { query: 'dark mode', topic: 'user.preferences' };
    const { score } = computeScore(query, baseMemory);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('exact topic + keyword match scores higher than no match', () => {
    const goodQuery = { query: 'dark mode preferences', topic: 'user.preferences' };
    const badQuery  = { query: 'weather forecast',      topic: 'system.metrics'    };
    const good = computeScore(goodQuery, baseMemory).score;
    const bad  = computeScore(badQuery,  baseMemory).score;
    expect(good).toBeGreaterThan(bad);
  });

  it('superseded memory scores lower than active memory (penalty applied)', () => {
    const query = { query: 'dark mode', topic: 'user.preferences' };
    const active       = { ...baseMemory, status: 'active' };
    const superseded = { ...baseMemory, status: 'superseded' };
    const aScore = computeScore(query, active).score;
    const cScore = computeScore(query, superseded).score;
    expect(aScore).toBeGreaterThan(cScore);
  });

  it('higher provenance trust produces higher score (all else equal)', () => {
    const query       = { query: 'dark mode', topic: 'user.preferences' };
    const userMemory  = { ...baseMemory, source_type: 'user' };
    const inferred    = { ...baseMemory, source_type: 'inferred' };
    expect(computeScore(query, userMemory).score).toBeGreaterThan(computeScore(query, inferred).score);
  });

  it('explanation object contains all expected fields', () => {
    const query = { query: 'dark mode', topic: 'user.preferences' };
    const { explanation, matched_fields, evidence, retrieval_evidence } = computeScore(query, baseMemory);
    expect(explanation).toHaveProperty('topic_match_type');
    expect(explanation).toHaveProperty('keyword_matches');
    expect(explanation).toHaveProperty('tag_matches');
    expect(explanation).toHaveProperty('recency_score');
    expect(explanation).toHaveProperty('final_score');
    expect(explanation).toHaveProperty('status_penalty');
    expect(matched_fields).toEqual(expect.arrayContaining(['topic', 'content']));
    expect(evidence).toEqual(expect.arrayContaining(['topic_match', 'keyword_match', 'status_active']));
    expect(retrieval_evidence).toHaveProperty('scorer_version');
    expect(retrieval_evidence).toHaveProperty('provenance');
  });

  it('score is deterministic — same inputs always produce same output', () => {
    const query = { query: 'dark mode', topic: 'user.preferences' };
    const s1 = computeScore(query, baseMemory).score;
    const s2 = computeScore(query, baseMemory).score;
    const s3 = computeScore(query, baseMemory).score;
    expect(s1).toBe(s2);
    expect(s2).toBe(s3);
  });
});
