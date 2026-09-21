/**
 * correctionResolver.test.js — Unit tests for the conflict classification rules.
 *
 * classify() is a pure function (no DB side effects), so these tests
 * are blazing fast and completely deterministic.
 */

import { describe, it, expect } from 'vitest';
import { classify } from '../../src/services/correctionResolver.js';

const base = {
  id:          'existing-001',
  content:     'User prefers light mode',
  topic:       'user.preferences',
  source:      'settings-panel',
  source_type: 'system',
  confidence:  1.0,
  status:      'active',
  valid_until: null,
};

// ─── Rule 1: Duplicate ────────────────────────────────────────────────────────

describe('Rule 1 — EXACT_CONTENT_MATCH', () => {
  it('classifies identical content as duplicate', () => {
    const incoming = { ...base, id: 'new-001', content: 'User prefers light mode' };
    const decision = classify(base, incoming);
    expect(decision.action).toBe('duplicate');
    expect(decision.rule).toBe('EXACT_CONTENT_MATCH');
  });

  it('is case-insensitive and trims whitespace', () => {
    const incoming = { ...base, id: 'new-001', content: '  USER PREFERS LIGHT MODE  ' };
    expect(classify(base, incoming).action).toBe('duplicate');
  });
});

// ─── Rule 2: High-confidence correction ──────────────────────────────────────

describe('Rule 2 — HIGH_CONFIDENCE_CORRECTION', () => {
  it('supersedes when user source + confidence >= 0.9 + same topic', () => {
    const incoming = {
      ...base,
      id:          'new-002',
      content:     'User prefers dark mode',
      source_type: 'user',
      confidence:  1.0,
    };
    const decision = classify(base, incoming);
    expect(decision.action).toBe('supersede');
    expect(decision.rule).toBe('HIGH_CONFIDENCE_CORRECTION');
  });

  it('does NOT supersede when confidence < 0.9', () => {
    const incoming = {
      ...base,
      id:          'new-002b',
      content:     'User prefers dark mode',
      source_type: 'user',
      confidence:  0.7,
    };
    const decision = classify(base, incoming);
    expect(decision.action).not.toBe('supersede');
  });
});

// ─── Rule 3: Temporal expiry ──────────────────────────────────────────────────

describe('Rule 3 — TEMPORAL_SUPERSESSION', () => {
  it('supersedes when existing memory is expired', () => {
    const expired = { ...base, valid_until: Date.now() - 1000 }; // expired 1 sec ago
    const incoming = {
      ...base,
      id:          'new-003',
      content:     'User prefers dark mode',
      source_type: 'user',
      confidence:  0.5, // even low confidence
    };
    const decision = classify(expired, incoming);
    expect(decision.action).toBe('supersede');
    expect(decision.rule).toBe('TEMPORAL_SUPERSESSION');
  });

  it('does NOT supersede when valid_until is in the future', () => {
    const notExpired = { ...base, valid_until: Date.now() + 86400000 };
    const incoming = {
      ...base,
      id:          'new-003b',
      content:     'User prefers dark mode',
      source_type: 'user',
      confidence:  0.5,
    };
    const decision = classify(notExpired, incoming);
    expect(decision.action).not.toBe('supersede');
  });
});

// ─── Rule 4: User over system ─────────────────────────────────────────────────

describe('Rule 4 — SYSTEM_VS_USER', () => {
  it('supersedes system memory when new is user-sourced', () => {
    const systemMem = { ...base, source_type: 'system', confidence: 0.5 };
    const incoming = {
      ...base,
      id:          'new-004',
      content:     'User prefers dark mode',
      source_type: 'user',
      confidence:  0.5, // low confidence but still user > system
    };
    const decision = classify(systemMem, incoming);
    expect(decision.action).toBe('supersede');
    expect(decision.rule).toBe('SYSTEM_VS_USER');
  });

  it('does NOT apply when existing is also user-sourced', () => {
    const userMem = { ...base, source_type: 'user', confidence: 0.5 };
    const incoming = { ...base, id: 'new-004b', content: 'Conflicting content', source_type: 'user', confidence: 0.5 };
    const decision = classify(userMem, incoming);
    expect(decision.rule).not.toBe('SYSTEM_VS_USER');
  });
});

// ─── Rule 5: Conservative contradiction ──────────────────────────────────────

describe('Rule 5 — LOWER_CONFIDENCE_CONFLICT', () => {
  it('flags contradiction for inferred source type', () => {
    const incoming = {
      ...base,
      id:          'new-005',
      content:     'User prefers dark mode',
      source_type: 'inferred',
      confidence:  0.9,
      source:      'different-source',
    };
    const decision = classify({ ...base, source_type: 'user' }, incoming);
    expect(decision.action).toBe('contradict');
    expect(decision.rule).toBe('LOWER_CONFIDENCE_CONFLICT');
  });

  it('flags contradiction for low confidence (< 0.9)', () => {
    const incoming = {
      ...base,
      id:          'new-005b',
      content:     'User prefers dark mode',
      source_type: 'user',
      confidence:  0.5,
      source:      'different-source',
    };
    const decision = classify({ ...base, source_type: 'user' }, incoming);
    expect(decision.action).toBe('contradict');
  });
});

// ─── Rule 6: Same-source update ──────────────────────────────────────────────

describe('Rule 6 — SAME_SOURCE_UPDATE', () => {
  it('updates in place when same source, different content', () => {
    const incoming = {
      ...base,
      id:      'new-006',
      content: 'User prefers dark mode',
      // same source: 'settings-panel', same topic, different content
    };
    const decision = classify(base, incoming);
    expect(decision.action).toBe('update_in_place');
    expect(decision.rule).toBe('SAME_SOURCE_UPDATE');
  });
});

// ─── Determinism ──────────────────────────────────────────────────────────────

describe('Determinism', () => {
  it('classify always returns the same result for the same inputs', () => {
    const incoming = {
      ...base,
      id:          'new-det',
      content:     'User prefers dark mode',
      source_type: 'user',
      confidence:  1.0,
    };
    const d1 = classify(base, incoming);
    const d2 = classify(base, incoming);
    const d3 = classify(base, incoming);
    expect(d1.action).toBe(d2.action);
    expect(d2.action).toBe(d3.action);
    expect(d1.rule).toBe(d2.rule);
  });
});
