/**
 * Unit tests for deterministic reconciliation policy.
 */

import { describe, it, expect } from 'vitest';
import { classify, canonicalKey } from '../../src/services/correctionResolver.js';

const base = {
  id: 'existing-001',
  content: 'I live in Pune',
  topic: 'user.location.home_city',
  source: 'chat',
  source_type: 'user',
  confidence: 1.0,
  status: 'active',
  valid_until: null,
  tags: ['location', 'home_city', 'pune'],
  metadata: {},
};

describe('canonical keys', () => {
  it('uses metadata canonical_key when present', () => {
    const memory = { ...base, metadata: { canonical_key: 'user.location.home_city' } };
    expect(canonicalKey(memory)).toBe('user.location.home_city');
  });

  it('falls back to topic', () => {
    expect(canonicalKey(base)).toBe('user.location.home_city');
  });
});

describe('explicit correction policy', () => {
  it('classifies identical content as duplicate', () => {
    const incoming = { ...base, id: 'new-001', content: '  I LIVE IN PUNE  ' };
    const decision = classify(base, incoming);
    expect(decision.action).toBe('duplicate');
    expect(decision.rule).toBe('EXACT_CONTENT_MATCH');
  });

  it('supersedes when user replaces the same canonical single-valued fact', () => {
    const incoming = {
      ...base,
      id: 'new-002',
      content: 'I moved to Mumbai',
      tags: ['location', 'home_city', 'mumbai'],
    };
    const decision = classify(base, incoming);
    expect(decision.action).toBe('supersede');
    expect(decision.rule).toBe('EXPLICIT_CANONICAL_REPLACEMENT');
  });

  it('does not supersede a different canonical fact on the same broad domain', () => {
    const incoming = {
      ...base,
      id: 'new-003',
      content: 'I visited Mumbai last week',
      topic: 'user.travel.history',
      tags: ['travel', 'mumbai'],
    };
    expect(classify(base, incoming).action).toBe('accept');
  });

  it('treats historical memories as non-authoritative candidates', () => {
    const existing = { ...base, status: 'superseded' };
    const incoming = { ...base, id: 'new-004', content: 'I moved to Mumbai' };
    const decision = classify(existing, incoming);
    expect(decision.action).toBe('accept');
    expect(decision.rule).toBe('ONLY_ACTIVE_MEMORIES_RECONCILED');
  });
});

describe('ambiguous conflicts', () => {
  it('annotates recent language interest instead of replacing favorite language', () => {
    const existing = {
      ...base,
      id: 'lang-001',
      content: 'My favorite programming language is JavaScript',
      topic: 'user.preference.language.favorite',
      tags: ['language', 'favorite', 'javascript'],
    };
    const incoming = {
      ...base,
      id: 'lang-002',
      content: 'I have been enjoying Python recently',
      topic: 'user.preference.language.recent_interest',
      tags: ['language', 'python', 'recent_interest'],
    };
    const decision = classify(existing, incoming);
    expect(decision.action).toBe('annotate_conflict');
    expect(decision.rule).toBe('AMBIGUOUS_NON_REPLACEMENT');
  });

  it('annotates occasional Cursor use instead of replacing primary IDE', () => {
    const existing = {
      ...base,
      id: 'ide-001',
      content: 'My preferred IDE is VS Code',
      topic: 'user.preference.ide.primary',
      tags: ['ide', 'primary', 'vscode'],
    };
    const incoming = {
      ...base,
      id: 'ide-002',
      content: 'I sometimes use Cursor',
      topic: 'user.tool.ide.secondary',
      tags: ['ide', 'secondary', 'cursor'],
    };
    expect(classify(existing, incoming).action).toBe('annotate_conflict');
  });
});

describe('determinism', () => {
  it('returns the same decision for the same inputs', () => {
    const incoming = { ...base, id: 'new-det', content: 'I moved to Mumbai' };
    const decisions = [classify(base, incoming), classify(base, incoming), classify(base, incoming)];
    expect(decisions[0]).toEqual(decisions[1]);
    expect(decisions[1]).toEqual(decisions[2]);
  });
});
