/**
 * deterministicSuite.js — Canonical benchmark cases.
 *
 * Each case:
 *  - Uses deterministic IDs (bench-m-XXX) so expectations are exact.
 *  - Is self-contained: setup seeds only what it needs.
 *  - Is rolled back after execution, leaving the DB pristine.
 *
 * Categories:
 *   basic_retrieval, supersession, contradiction, topic_hierarchy,
 *   temporal_expiry, soft_delete, provenance_filter, multi_tag_retrieval,
 *   lifecycle_audit
 */

'use strict';

const NOW        = Date.now();
const DAY        = 86400000;
const YESTERDAY  = NOW - DAY;
const TWO_DAYS   = NOW - 2 * DAY;
const THIRTY     = NOW - 30 * DAY;
const LAST_YEAR  = NOW - 365 * DAY;

const suite = [
  // ── 1. Basic active retrieval ──────────────────────────────────────────────
  {
    id:          'bench-001',
    name:        'Basic active retrieval',
    description: 'Returns the highest-scoring active memory for an exact topic match.',
    input: {
      memories: [
        {
          id:          'bench-m-001a',
          content:     'User prefers dark mode',
          topic:       'user.preferences',
          source:      'settings-panel',
          source_type: 'user',
          confidence:  1.0,
          tags:        ['ui', 'preferences'],
          created_at:  YESTERDAY,
        },
        {
          id:          'bench-m-001b',
          content:     'User is 30 years old',
          topic:       'user.profile',
          source:      'onboarding',
          source_type: 'user',
          confidence:  1.0,
          tags:        ['profile'],
          created_at:  YESTERDAY,
        },
      ],
      query: {
        query: 'dark mode preferences',
        topic: 'user.preferences',
      },
    },
    expected: {
      results:  [{ memory_id: 'bench-m-001a', score_gte: 0.5 }],
      excluded: ['bench-m-001b'],
    },
  },

  // ── 2. Superseded memory excluded ─────────────────────────────────────────
  {
    id:          'bench-002',
    name:        'Superseded memory excluded from default retrieval',
    description: 'A superseded memory must not appear when include_superseded=false.',
    input: {
      memories: [
        {
          id:          'bench-m-002a',
          content:     'User prefers light mode',
          topic:       'user.preferences',
          source:      'settings-panel',
          source_type: 'user',
          confidence:  1.0,
          tags:        ['ui'],
          status:      'superseded',
          created_at:  THIRTY,
          _superseded_by: 'bench-m-002b',
        },
        {
          id:          'bench-m-002b',
          content:     'User prefers dark mode',
          topic:       'user.preferences',
          source:      'settings-panel',
          source_type: 'user',
          confidence:  1.0,
          tags:        ['ui'],
          created_at:  YESTERDAY,
        },
      ],
      query: {
        query: 'display mode preferences',
        topic: 'user.preferences',
        include_superseded: false,
      },
    },
    expected: {
      results:  [{ memory_id: 'bench-m-002b', score_gte: 0.3 }],
      excluded: ['bench-m-002a'],
    },
  },

  // ── 3. Contradicted memory returned with reduced score ────────────────────
  {
    id:          'bench-003',
    name:        'Contradicted memory included with score penalty',
    description: 'Contradicted memories appear in results but with lower score due to penalty.',
    input: {
      memories: [
        {
          id:          'bench-m-003a',
          content:     'User favourite colour is blue',
          topic:       'user.preferences',
          source:      'chat',
          source_type: 'user',
          confidence:  1.0,
          tags:        ['preferences'],
          status:      'contradicted',
          created_at:  YESTERDAY,
        },
        {
          id:          'bench-m-003b',
          content:     'User favourite colour is red',
          topic:       'user.preferences',
          source:      'chat',
          source_type: 'user',
          confidence:  0.7,
          tags:        ['preferences'],
          status:      'contradicted',
          created_at:  NOW,
        },
      ],
      query: {
        query: 'favourite colour',
        topic: 'user.preferences',
      },
    },
    expected: {
      results: [
        { memory_id: 'bench-m-003b', score_gte: 0.01 },
        { memory_id: 'bench-m-003a', score_gte: 0.01 },
      ],
    },
  },

  // ── 4. Topic hierarchy — parent query matches child topic ─────────────────
  {
    id:          'bench-004',
    name:        'Topic hierarchy — parent query finds child-topic memory',
    description: 'A query on "user" should surface memories with topic "user.preferences".',
    input: {
      memories: [
        {
          id:          'bench-m-004a',
          content:     'User prefers compact layout',
          topic:       'user.preferences.ui',
          source:      'settings',
          source_type: 'user',
          confidence:  1.0,
          tags:        ['ui'],
          created_at:  YESTERDAY,
        },
        {
          id:          'bench-m-004b',
          content:     'System uptime is 99.9%',
          topic:       'system.metrics',
          source:      'monitor',
          source_type: 'system',
          confidence:  1.0,
          tags:        ['metrics'],
          created_at:  YESTERDAY,
        },
      ],
      query: {
        query: 'user layout preferences',
        topic: 'user',
      },
    },
    expected: {
      results:  [{ memory_id: 'bench-m-004a', score_gte: 0.2 }],
      excluded: ['bench-m-004b'],
    },
  },

  // ── 5. Temporal expiry — expired memory treated as superseded ─────────────
  {
    id:          'bench-005',
    name:        'Temporally expired memory excluded from default retrieval',
    description: 'A memory with valid_until < now and status=superseded must be excluded.',
    input: {
      memories: [
        {
          id:          'bench-m-005a',
          content:     'User is in New York',
          topic:       'user.location',
          source:      'user',
          source_type: 'user',
          confidence:  1.0,
          tags:        ['location'],
          status:      'superseded',
          valid_until: NOW - DAY, // expired yesterday
          created_at:  NOW - 7 * DAY,
        },
        {
          id:          'bench-m-005b',
          content:     'User is in San Francisco',
          topic:       'user.location',
          source:      'user',
          source_type: 'user',
          confidence:  1.0,
          tags:        ['location'],
          created_at:  NOW,
        },
      ],
      query: {
        query: 'user location city',
        topic: 'user.location',
      },
    },
    expected: {
      results:  [{ memory_id: 'bench-m-005b', score_gte: 0.3 }],
      excluded: ['bench-m-005a'],
    },
  },

  // ── 6. Deleted memory excluded ─────────────────────────────────────────────
  {
    id:          'bench-006',
    name:        'Deleted memory never returned',
    description: 'A soft-deleted memory must never appear in retrieval results.',
    input: {
      memories: [
        {
          id:          'bench-m-006a',
          content:     'User occupation is engineer',
          topic:       'user.profile',
          source:      'onboarding',
          source_type: 'user',
          confidence:  1.0,
          tags:        ['profile'],
          status:      'deleted',
          created_at:  YESTERDAY,
        },
        {
          id:          'bench-m-006b',
          content:     'User occupation is designer',
          topic:       'user.profile',
          source:      'onboarding',
          source_type: 'user',
          confidence:  1.0,
          tags:        ['profile'],
          created_at:  NOW,
        },
      ],
      query: {
        query: 'user job occupation',
        topic: 'user.profile',
      },
    },
    expected: {
      results:  [{ memory_id: 'bench-m-006b', score_gte: 0.1 }],
      excluded: ['bench-m-006a'],
    },
  },

  // ── 7. Provenance filter — source_type filter ──────────────────────────────
  {
    id:          'bench-007',
    name:        'Source type filter returns only user memories',
    description: 'When source_type=user is requested, system memories are excluded.',
    input: {
      memories: [
        {
          id:          'bench-m-007a',
          content:     'User prefers metric units',
          topic:       'user.preferences',
          source:      'user',
          source_type: 'user',
          confidence:  1.0,
          tags:        ['preferences'],
          created_at:  YESTERDAY,
        },
        {
          id:          'bench-m-007b',
          content:     'System detected metric locale',
          topic:       'user.preferences',
          source:      'locale-detector',
          source_type: 'system',
          confidence:  0.8,
          tags:        ['preferences'],
          created_at:  YESTERDAY,
        },
      ],
      query: {
        query:       'metric units preferences',
        topic:       'user.preferences',
        source_type: 'user',
      },
    },
    expected: {
      results:  [{ memory_id: 'bench-m-007a', score_gte: 0.3 }],
      excluded: ['bench-m-007b'],
    },
  },

  // ── 8. Multi-tag retrieval ──────────────────────────────────────────────────
  {
    id:          'bench-008',
    name:        'Multi-tag retrieval scores tag-matching memories higher',
    description: 'Memories matching all requested tags score higher than partial matches.',
    input: {
      memories: [
        {
          id:          'bench-m-008a',
          content:     'User prefers dark mode with large font',
          topic:       'user.preferences',
          source:      'settings',
          source_type: 'user',
          confidence:  1.0,
          tags:        ['ui', 'accessibility', 'preferences'],
          created_at:  YESTERDAY,
        },
        {
          id:          'bench-m-008b',
          content:     'User prefers light theme',
          topic:       'user.preferences',
          source:      'settings',
          source_type: 'user',
          confidence:  1.0,
          tags:        ['ui'],
          created_at:  YESTERDAY,
        },
      ],
      query: {
        query: 'ui accessibility preferences',
        topic: 'user.preferences',
        tags:  ['ui', 'accessibility'],
      },
    },
    expected: {
      results: [
        { memory_id: 'bench-m-008a', position: 0 }, // full tag match → higher score
        { memory_id: 'bench-m-008b', position: 1 },
      ],
    },
  },

  // ── 9. Recency — newer memory ranked higher when content is similar ────────
  {
    id:          'bench-009',
    name:        'Recency bonus ranks newer memory higher on equal content match',
    description: 'When two memories match a query equally on keywords/topic, the newer one ranks first.',
    input: {
      memories: [
        {
          id:          'bench-m-009a',
          content:     'User notification preference is email',
          topic:       'user.preferences',
          source:      'settings',
          source_type: 'user',
          confidence:  1.0,
          tags:        ['notifications'],
          created_at:  LAST_YEAR,
        },
        {
          id:          'bench-m-009b',
          content:     'User notification preference is email',
          topic:       'user.preferences',
          source:      'settings',
          source_type: 'user',
          confidence:  1.0,
          tags:        ['notifications'],
          created_at:  NOW,
        },
      ],
      query: {
        query: 'notification preference email',
        topic: 'user.preferences',
      },
    },
    expected: {
      results: [
        { memory_id: 'bench-m-009b', position: 0 }, // newer must be first
      ],
    },
  },

  // ── 10. High-confidence correction rule ────────────────────────────────────
  {
    id:          'bench-010',
    name:        'High-confidence user correction supersedes system memory',
    description: 'Rule SYSTEM_VS_USER: a user-sourced memory replaces a system memory on same topic.',
    input: {
      memories: [
        {
          id:          'bench-m-010a',
          content:     'User name is Bob',
          topic:       'user.profile',
          source:      'login-system',
          source_type: 'system',
          confidence:  1.0,
          tags:        ['profile'],
          status:      'superseded',
          created_at:  THIRTY,
          _superseded_by:      'bench-m-010b',
          _supersession_reason: 'User asserted correct name',
        },
        {
          id:          'bench-m-010b',
          content:     'User name is Robert',
          topic:       'user.profile',
          source:      'user-profile-form',
          source_type: 'user',
          confidence:  1.0,
          tags:        ['profile'],
          created_at:  YESTERDAY,
        },
      ],
      query: {
        query: 'user name',
        topic: 'user.profile',
      },
    },
    expected: {
      results:  [{ memory_id: 'bench-m-010b', score_gte: 0.4 }],
      excluded: ['bench-m-010a'],
    },
  },
];

module.exports = suite;
