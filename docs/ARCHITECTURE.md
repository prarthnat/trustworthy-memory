# Caygnus — Trustworthy Long-Term Memory: Architecture

> **Audience**: Engineering interviews, code reviewers, and future maintainers.
> Every design decision below is accompanied by its rationale and the alternatives rejected.
>
> **Review note**: `docs/DESIGN_REFINEMENT.md` is the acceptance-facing refinement for lifecycle, correction, ambiguous conflicts, retrieval scoring, deletion, benchmark fixtures, tests, and reviewer critique. It supersedes any earlier lifecycle wording here that modeled ambiguous conflicts as a first-class memory state.

---

## Table of Contents

1. [Problem Statement & Goals](#1-problem-statement--goals)
2. [Constraints & Non-Goals](#2-constraints--non-goals)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Folder Structure](#4-folder-structure)
5. [Database Schema](#5-database-schema)
6. [API Design](#6-api-design)
7. [Memory Lifecycle Design](#7-memory-lifecycle-design)
8. [Retrieval Strategy](#8-retrieval-strategy)
9. [Correction & Supersession Strategy](#9-correction--supersession-strategy)
10. [Deletion Strategy](#10-deletion-strategy)
11. [Benchmark Strategy](#11-benchmark-strategy)
12. [Test Strategy](#12-test-strategy)
13. [Key Design Decisions — Interview Defence](#13-key-design-decisions--interview-defence)

---

## 1. Problem Statement & Goals

A **long-term memory** system for an AI agent must answer five hard questions reliably:

| Question | Challenge |
|---|---|
| What do I know? | Retrieval completeness |
| Is it still true? | Supersession / staleness |
| Where did it come from? | Provenance |
| What if sources conflict? | Conservative contradiction handling |
| Why did I return *this* answer? | Explainability |

This system must answer all five **deterministically** — the same inputs must always produce the same outputs. That property is what makes it *trustworthy*.

---

## 2. Constraints & Non-Goals

### Hard Constraints

- **JavaScript only** — no TypeScript compilation step.
- **No external AI API** — OpenAI, Anthropic, etc. are banned.
- **No embeddings / vector databases** — no semantic similarity via float vectors.
- **No LangChain** — no framework magic hiding retrieval logic.
- **SQLite** — single-file, zero-infrastructure persistence.
- **Deterministic** — given identical input, retrieval output is identical.

### Why These Constraints Are Actually Good

Embeddings are probabilistic by nature; two semantically identical queries may return different results depending on model version or floating-point rounding. Removing them *forces* us to build a retrieval system whose logic can be audited by a human reading SQL and JavaScript. That is the correct trade-off for a *trustworthy* system.

### Non-Goals

- Horizontal scale / multi-node — SQLite is single-writer by design.
- Real-time collaborative editing of memories.
- Semantic paraphrasing (left intentionally to human operators).

---

## 3. High-Level Architecture

```
┌────────────────────────────────────────────────────────┐
│                   React Frontend (port 3000)           │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Memory     │  │  Retrieval   │  │  Lifecycle   │  │
│  │  Manager    │  │  Explorer    │  │  History     │  │
│  └─────────────┘  └──────────────┘  └──────────────┘  │
└───────────────────────┬────────────────────────────────┘
                        │ HTTP REST (JSON)
┌───────────────────────▼────────────────────────────────┐
│              Node.js + Express (port 4000)              │
│                                                        │
│   ┌────────────┐   ┌────────────┐   ┌──────────────┐  │
│   │  Memory    │   │ Retrieval  │   │  Lifecycle   │  │
│   │  Service   │   │  Engine    │   │  Service     │  │
│   └────────────┘   └────────────┘   └──────────────┘  │
│                                                        │
│   ┌────────────┐   ┌────────────┐   ┌──────────────┐  │
│   │ Correction │   │  Scoring   │   │  Benchmark   │  │
│   │  Resolver  │   │  Engine    │   │  Runner      │  │
│   └────────────┘   └────────────┘   └──────────────┘  │
└───────────────────────┬────────────────────────────────┘
                        │ better-sqlite3 (sync)
┌───────────────────────▼────────────────────────────────┐
│                    SQLite Database                      │
│   memories │ memory_supersessions │ memory_audit_log   │
│   memory_tags │ retrieval_log │ benchmarks             │
└────────────────────────────────────────────────────────┘
```

### Why REST over WebSocket

Memories are not a real-time stream; they are discrete CRUD operations with transactional semantics. REST maps cleanly to HTTP verbs and is trivially testable with `curl` or any test runner. WebSocket would add complexity with zero benefit here.

### Why `better-sqlite3` over `node-sqlite3`

`better-sqlite3` is **synchronous**. Async SQLite wrappers (like `node-sqlite3`) require callback or Promise juggling even for simple reads. Synchronous DB access in a stateless Express handler is far easier to reason about and does not meaningfully bottleneck a single-writer SQLite setup. The determinism guarantee is trivially satisfied because there is no race condition between concurrent async reads.

---

## 4. Folder Structure

```
caygnus/
├── docs/
│   └── ARCHITECTURE.md               ← this file
│
├── backend/
│   ├── src/
│   │   ├── db/
│   │   │   ├── schema.sql             ← canonical DDL (single source of truth)
│   │   │   ├── migrate.js             ← applies schema.sql idempotently
│   │   │   └── db.js                  ← exports singleton better-sqlite3 instance
│   │   │
│   │   ├── services/
│   │   │   ├── memoryService.js       ← create, update, soft-delete
│   │   │   ├── retrievalEngine.js     ← scoring, filtering, explanation
│   │   │   ├── correctionResolver.js  ← supersession + contradiction logic
│   │   │   ├── lifecycleService.js    ← audit log queries
│   │   │   └── benchmarkRunner.js     ← deterministic test harness
│   │   │
│   │   ├── routes/
│   │   │   ├── memories.js            ← /api/memories CRUD
│   │   │   ├── retrieval.js           ← /api/retrieve
│   │   │   ├── lifecycle.js           ← /api/lifecycle/:id
│   │   │   └── benchmarks.js          ← /api/benchmarks
│   │   │
│   │   ├── middleware/
│   │   │   ├── validate.js            ← request validation
│   │   │   └── errorHandler.js        ← global error normaliser
│   │   │
│   │   └── app.js                     ← Express wiring
│   │
│   ├── tests/
│   │   ├── unit/
│   │   │   ├── retrievalEngine.test.js
│   │   │   ├── correctionResolver.test.js
│   │   │   └── memoryService.test.js
│   │   ├── integration/
│   │   │   └── api.test.js
│   │   └── benchmarks/
│   │       └── deterministicSuite.js  ← canonical benchmark cases
│   │
│   ├── data/
│   │   └── caygnus.db                 ← SQLite file (gitignored)
│   │
│   └── package.json
│
├── frontend/
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── components/
│   │   │   ├── MemoryManager/         ← CRUD panel
│   │   │   ├── RetrievalExplorer/     ← query + explanation panel
│   │   │   ├── LifecycleHistory/      ← timeline view per memory
│   │   │   └── BenchmarkDashboard/    ← run/view benchmark results
│   │   ├── api/
│   │   │   └── client.js              ← thin fetch wrapper
│   │   ├── App.jsx
│   │   └── index.jsx
│   └── package.json
│
└── package.json                       ← root: scripts to run both concurrently
```

### Why monorepo with separate `backend/` and `frontend/`

A single repo makes it easy to share benchmark fixture files and run `npm run dev` from the root. Keeping `backend/` and `frontend/` as separate Node packages avoids dependency conflicts and keeps each build self-contained.

---

## 5. Database Schema

### Design Philosophy

Every table is designed around three invariants:

1. **Nothing is ever physically deleted** (soft-delete only, for audit).
2. **Every state transition is recorded** (audit log is append-only).
3. **Every retrieval is logged** (reproducibility and debugging).

---

### Table: `memories`

The canonical store of all memory content.

```sql
CREATE TABLE memories (
  id            TEXT PRIMARY KEY,          -- UUIDv4; deterministic, client-generated
  content       TEXT NOT NULL,             -- the factual claim
  topic         TEXT NOT NULL,             -- coarse domain (e.g. "user.preference")
  source        TEXT NOT NULL,             -- provenance: who/what asserted this
  source_type   TEXT NOT NULL,             -- 'user' | 'system' | 'inferred'
  confidence    REAL NOT NULL DEFAULT 1.0, -- 0.0–1.0; used in scoring
  status        TEXT NOT NULL DEFAULT 'active',
                                           -- 'active' | 'superseded' | 'deleted' | 'contradicted'
  created_at    INTEGER NOT NULL,          -- Unix ms timestamp
  updated_at    INTEGER NOT NULL,          -- updated on any status change
  valid_from    INTEGER,                   -- optional temporal validity window
  valid_until   INTEGER,                   -- NULL = indefinitely valid
  metadata      TEXT                       -- JSON blob for extensibility
);
```

**Why UUIDv4 for `id`?**
Numeric auto-increment IDs leak insertion order and create ambiguity when records are soft-deleted. UUIDs are opaque identifiers that clients can generate before the round-trip, enabling optimistic UI updates.

**Why `confidence` as a float?**
Some memories are assertions ("user's name is Alice") with confidence=1.0. Others are inferred ("user probably prefers dark mode") with lower confidence. The scoring engine uses this to break ties without non-determinism.

**Why `source_type` enum?**
Provenance must distinguish between what a *user said*, what the *system observed*, and what was *inferred* from patterns. These have fundamentally different trust weights in the correction resolver.

**Why `valid_from` / `valid_until`?**
Temporal memories ("I am in New York until Friday") are first-class citizens. An expired memory is not deleted — it transitions to `superseded` with a lifecycle event.

---

### Table: `memory_supersessions`

Tracks the directed graph of "A was replaced by B" relationships.

```sql
CREATE TABLE memory_supersessions (
  id              TEXT PRIMARY KEY,
  old_memory_id   TEXT NOT NULL REFERENCES memories(id),
  new_memory_id   TEXT NOT NULL REFERENCES memories(id),
  reason          TEXT NOT NULL,  -- human-readable explanation
  superseded_at   INTEGER NOT NULL,
  superseded_by   TEXT NOT NULL   -- source of the correction
);
```

**Why a separate table instead of a `superseded_by` FK column on `memories`?**
A memory can be partially superseded by multiple successors (e.g., one correction updates the topic, another updates content). A separate junction table handles m:n supersession graphs correctly. It also keeps `memories` clean and queryable without joins for the common case.

---

### Table: `memory_tags`

Many-to-many tag system for faceted retrieval.

```sql
CREATE TABLE memory_tags (
  memory_id  TEXT NOT NULL REFERENCES memories(id),
  tag        TEXT NOT NULL,
  PRIMARY KEY (memory_id, tag)
);
```

**Why tags instead of a `tags` JSON column?**
A JSON column cannot be indexed efficiently in SQLite. A normalised `memory_tags` table can have a composite index on `(tag, memory_id)`, making tag-based lookups O(log n).

---

### Table: `memory_audit_log`

Append-only log of every state transition. Never updated, never deleted.

```sql
CREATE TABLE memory_audit_log (
  id           TEXT PRIMARY KEY,
  memory_id    TEXT NOT NULL REFERENCES memories(id),
  event_type   TEXT NOT NULL,
  -- 'created' | 'updated' | 'superseded' | 'deleted' | 'contradiction_flagged' | 'restored'
  old_value    TEXT,     -- JSON snapshot of fields that changed
  new_value    TEXT,     -- JSON snapshot of new values
  actor        TEXT NOT NULL,   -- who triggered the event
  event_at     INTEGER NOT NULL,
  notes        TEXT
);
```

**Why store `old_value` and `new_value` as JSON blobs?**
Rather than a rigid column-per-field schema, JSON blobs let us record any subset of fields that changed without schema migrations every time `memories` gains a new column. The cost is that old_value/new_value are not directly queryable with SQL — but lifecycle display only needs to show diffs, not filter on them.

---

### Table: `retrieval_log`

Records every retrieval query and its ranked results, enabling reproducibility.

```sql
CREATE TABLE retrieval_log (
  id            TEXT PRIMARY KEY,
  query         TEXT NOT NULL,         -- original query string
  filters       TEXT,                  -- JSON: topic, tags, source_type
  results       TEXT NOT NULL,         -- JSON array of {memory_id, score, explanation}
  retrieved_at  INTEGER NOT NULL,
  context       TEXT                   -- optional: caller context string
);
```

**Why log retrievals?**
Determinism claims must be verifiable. A retrieval log lets us replay any query and assert the same ranked list was returned. It is also invaluable for debugging "why did the agent believe X?"

---

### Table: `benchmarks`

Stores benchmark case definitions and their last run results.

```sql
CREATE TABLE benchmarks (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  input         TEXT NOT NULL,   -- JSON: query + expected memory state
  expected      TEXT NOT NULL,   -- JSON: expected retrieval result
  last_run_at   INTEGER,
  last_status   TEXT,            -- 'pass' | 'fail' | 'error'
  last_output   TEXT             -- JSON actual output from last run
);
```

---

### Indexes

```sql
-- Fast lookup by status (most queries filter active memories)
CREATE INDEX idx_memories_status ON memories(status);

-- Fast lookup by topic (primary retrieval dimension)
CREATE INDEX idx_memories_topic ON memories(topic, status);

-- Temporal queries
CREATE INDEX idx_memories_valid_until ON memories(valid_until)
  WHERE valid_until IS NOT NULL;

-- Audit log queries per memory
CREATE INDEX idx_audit_memory_id ON memory_audit_log(memory_id, event_at);

-- Retrieval log search
CREATE INDEX idx_retrieval_log_at ON retrieval_log(retrieved_at);

-- Tag lookups
CREATE INDEX idx_tags_tag ON memory_tags(tag, memory_id);
```

---

## 6. API Design

All endpoints return `{ success: boolean, data: any, error?: string }`.
HTTP status codes are used correctly (200, 201, 400, 404, 409, 500).

### Memory CRUD

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/memories` | Store a new memory with provenance |
| `GET` | `/api/memories` | List memories (filters: topic, status, tag, source_type) |
| `GET` | `/api/memories/:id` | Get a single memory |
| `PATCH` | `/api/memories/:id` | Update content/metadata (triggers audit log) |
| `DELETE` | `/api/memories/:id` | Soft-delete (sets status='deleted', logs event) |
| `POST` | `/api/memories/:id/restore` | Restore a soft-deleted memory |

### Retrieval

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/retrieve` | Query memories; returns ranked list + per-result explanation |
| `GET` | `/api/retrieve/log` | Browse past retrieval sessions |
| `GET` | `/api/retrieve/log/:id` | Replay a specific retrieval session |

### Supersession & Corrections

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/memories/:id/supersede` | Mark memory as superseded by a new one |
| `POST` | `/api/memories/correct` | Submit a correction; system resolves conflict |
| `GET` | `/api/memories/:id/supersessions` | Get supersession chain for a memory |

### Lifecycle

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/lifecycle/:id` | Full audit trail for a memory |
| `GET` | `/api/lifecycle/recent` | Recent events across all memories |

### Benchmarks

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/benchmarks` | List all benchmark cases |
| `POST` | `/api/benchmarks/run` | Run all benchmarks; return pass/fail report |
| `POST` | `/api/benchmarks/run/:id` | Run a single benchmark |

### Request Body: `POST /api/memories`

```json
{
  "content": "User prefers dark mode",
  "topic": "user.preferences",
  "source": "user-settings-panel",
  "source_type": "user",
  "confidence": 1.0,
  "tags": ["ui", "preferences"],
  "valid_until": null,
  "metadata": {}
}
```

### Request Body: `POST /api/retrieve`

```json
{
  "query": "What are the user's UI preferences?",
  "topic": "user.preferences",
  "tags": ["ui"],
  "limit": 10,
  "include_superseded": false,
  "context": "agent-session-xyz"
}
```

### Response: `POST /api/retrieve`

```json
{
  "success": true,
  "data": {
    "query": "What are the user's UI preferences?",
    "results": [
      {
        "memory_id": "uuid-...",
        "content": "User prefers dark mode",
        "score": 0.95,
        "explanation": {
          "topic_match": true,
          "topic_match_type": "exact",
          "tag_matches": ["ui", "preferences"],
          "keyword_matches": ["UI", "preferences"],
          "recency_bonus": 0.1,
          "confidence_weight": 1.0,
          "status": "active"
        }
      }
    ],
    "retrieval_log_id": "uuid-...",
    "total_candidates": 14,
    "filters_applied": { "topic": "user.preferences", "status": "active" }
  }
}
```

**Why `explanation` is a first-class field:**
The requirements say "Explain retrieval decisions." An explanation that lives only in server logs is useless to users. By embedding `explanation` in every result, the frontend can render *exactly why* each memory was returned, without a separate round-trip.

---

## 7. Memory Lifecycle Design

A memory passes through a finite state machine:

```
          ┌─────────┐
   create │         │
  ────────►  active  ◄──────── restore
          │         │
          └────┬────┘
               │
       ┌───────┼──────────┐
       │       │           │
       ▼       ▼           ▼
  ┌─────────┐ ┌──────────┐ ┌─────────────┐
  │ deleted │ │superseded│ │ contradicted│
  └─────────┘ └──────────┘ └─────────────┘
       │                         │
       └──────── (soft) ─────────┘
             (no hard delete)
```

### State Definitions

| State | Meaning |
|---|---|
| `active` | Current, trusted, returned in standard retrieval |
| `superseded` | Replaced by a newer memory; not returned unless explicitly requested |
| `contradicted` | Conflicts with another memory; neither is trusted fully; flagged for review |
| `deleted` | Soft-deleted by user/operator; excluded from all retrieval |

### Transitions

| Transition | Trigger | Logged As |
|---|---|---|
| `→ active` | `POST /api/memories` | `created` |
| `active → superseded` | New conflicting memory accepted | `superseded` |
| `active → contradicted` | Conflict detected, unresolved | `contradiction_flagged` |
| `active → deleted` | `DELETE /api/memories/:id` | `deleted` |
| `deleted → active` | `POST /api/memories/:id/restore` | `restored` |
| `contradicted → active` | Conflict manually resolved | `updated` |
| `contradicted → superseded` | Conflict resolved in favour of other | `superseded` |

**Why `contradicted` is a distinct state:**
When two memories conflict and neither can be definitively trusted, marking one as `superseded` would be wrong — it asserts the new one is correct. `contradicted` is the conservative middle ground: both memories exist, both are flagged, retrieval scores them lower, and a human or high-confidence correction can resolve them later.

---

## 8. Retrieval Strategy

### Core Principle: Deterministic Scoring

Every memory is given a **score ∈ [0, 1]** computed by a fully deterministic formula. Ties are broken by `created_at DESC` (most recent first), then by `id` alphabetically (for absolute determinism). No randomness, no embeddings, no model inference.

### Scoring Formula

```
score = W_topic    × topic_match(query, memory)
      + W_tags     × tag_score(query_tags, memory.tags)
      + W_keywords × keyword_score(query_terms, memory.content)
      + W_recency  × recency_score(memory.created_at)
      + W_confidence × memory.confidence
      − W_status   × status_penalty(memory.status)
```

Default weights (tunable via config):

| Component | Weight | Rationale |
|---|---|---|
| `W_topic` | 0.40 | Topic is the strongest structural signal |
| `W_tags` | 0.20 | Tags are explicit facets |
| `W_keywords` | 0.25 | Content-level lexical match |
| `W_recency` | 0.10 | Newer memories preferred on tie |
| `W_confidence` | 0.05 | Explicit confidence modulates trust |
| `W_status` | penalty | `contradicted` = −0.3 penalty |

### Topic Matching

- **Exact match**: `user.preferences` === `user.preferences` → 1.0
- **Prefix match**: query `user.preferences` matches memory `user.preferences.ui` → 0.7
- **Parent match**: query `user` matches `user.preferences` → 0.5
- **No match** → 0.0

Topics use dotted hierarchy notation. This allows coarse queries ("everything about the user") and precise queries ("what UI preferences?") without custom tree traversal — pure string operations.

### Keyword Matching

1. Tokenize query and memory content by whitespace + punctuation.
2. Normalize to lowercase.
3. Remove stop words (a fixed, hardcoded list — no ML).
4. Score = `|intersection(query_tokens, content_tokens)| / |query_tokens|`

**Why not TF-IDF?**
TF-IDF requires a corpus-wide IDF table that changes as memories are added/deleted, making the score of an existing memory change non-deterministically as new memories arrive. A simple Jaccard-like intersection against query terms is fully deterministic and auditable.

### Recency Score

```
recency_score = 1 / (1 + days_since_created / HALF_LIFE_DAYS)
```

`HALF_LIFE_DAYS` defaults to 30. Memory created today → 1.0; created 30 days ago → 0.5; created 90 days ago → 0.25. This is a smooth, monotonic decay with no discontinuities.

### Status Filtering

- **Default retrieval**: `status = 'active'` only.
- **`include_superseded=true`**: Include `superseded` memories with penalty.
- **`contradicted` memories**: Always included with penalty (surfaces conflict to caller).
- **`deleted` memories**: Never included in retrieval (only in lifecycle queries).

### Explanation Object

```js
{
  topic_match: true,
  topic_match_type: "exact",       // 'exact' | 'prefix' | 'parent' | 'none'
  tag_matches: ["ui", "preferences"],
  keyword_matches: ["preferences", "dark"],
  recency_days: 2,
  recency_score: 0.94,
  confidence_weight: 1.0,
  status_penalty: 0,
  final_score: 0.95
}
```

Stored in `retrieval_log.results` and returned inline with every result.

---

## 9. Correction & Supersession Strategy

### The Core Problem

When a new memory contradicts an existing one, the system must decide:
- Is it a **correction** (old is wrong → supersede)?
- Is it a **conflict** (both might be true in different contexts → flag)?
- Is it a **duplicate** (same fact → ignore)?

### Decision Rules (ordered by precedence)

```
Rule 1: EXACT_CONTENT_MATCH
  If content is identical (case-insensitive trim) → skip as duplicate.

Rule 2: HIGH_CONFIDENCE_CORRECTION
  If new source_type = 'user' AND confidence >= 0.9
  AND topics are identical
  → supersede old memory.

Rule 3: TEMPORAL_SUPERSESSION
  If old memory has valid_until < now
  → mark old as superseded (expired), accept new as active.

Rule 4: SYSTEM_VS_USER
  If old source_type = 'system' AND new source_type = 'user'
  → user assertion always wins; supersede old.

Rule 5: LOWER_CONFIDENCE_CONFLICT
  If confidence < 0.9 OR source_type = 'inferred'
  → flag BOTH as 'contradicted'; do not supersede.
  Create a contradiction record in audit log.
  Return 409 Conflict to caller with both memory IDs.

Rule 6: SAME_SOURCE_UPDATE
  If same source AND content differs
  → update-in-place (PATCH semantics), log as 'updated'.
```

**Why conservative on contradiction (Rule 5):**
If we're not *sure* which is correct, we must not silently overwrite the old truth. The `contradicted` state surfaces both facts with reduced confidence, letting a human operator or a future high-confidence correction resolve it. This prevents the system from propagating a wrong belief based on a low-confidence inferred memory.

### Supersession Chain

When A is superseded by B, and B is later superseded by C:

```
A → superseded by B → superseded by C (current active)
```

`GET /api/memories/:id/supersessions` traverses this chain bidirectionally, so users can see the full evolution of a fact.

---

## 10. Deletion Strategy

### Soft Delete Only

```
DELETE /api/memories/:id
  → memory.status = 'deleted'
  → memory_audit_log INSERT (event_type='deleted')
  → memory NOT returned in any retrieval
```

Physical rows are never deleted. Rationale:
1. **Audit requirements**: Lifecycle history requires the full chain including deleted entries.
2. **Supersession integrity**: A deleted memory might be the `old_memory_id` in a supersession row. Physically deleting it breaks referential integrity.
3. **Restore**: `POST /api/memories/:id/restore` brings it back to `active`, logged as `restored`.

### Cascade Semantics

Deleting a memory does **not** cascade to memories that superseded it. The successor remains `active`. The supersession relationship is preserved in `memory_supersessions` for historical tracing.

### Hard Purge (Future / Admin-only)

A future `POST /api/admin/purge/:id` could physically delete memories where `status='deleted'` AND all related supersession rows AND audit rows. Intentionally excluded from v1 to avoid GDPR complexity and to enforce the audit-first principle.

---

## 11. Benchmark Strategy

### What Makes a Benchmark Deterministic

A benchmark is deterministic when:
1. The database state is **seeded** from a fixed JSON fixture before the test.
2. The query is **fixed**.
3. The expected output is **exact**: same memory IDs, same order, same scores.

### Benchmark Case Schema

```json
{
  "id": "bench-001",
  "name": "Basic active retrieval",
  "description": "Should return the highest-scoring active memory for a topic query",
  "setup": {
    "memories": [
      { "id": "m1", "content": "User prefers dark mode", "topic": "user.preferences", "...": "..." },
      { "id": "m2", "content": "User is 30 years old", "topic": "user.profile", "...": "..." }
    ]
  },
  "query": {
    "query": "UI preferences",
    "topic": "user.preferences"
  },
  "expected": {
    "results": [
      { "memory_id": "m1", "score_gte": 0.5 }
    ],
    "excluded": ["m2"]
  }
}
```

### Benchmark Categories

| Category | What It Tests |
|---|---|
| `basic_retrieval` | Active memory returned for matching query |
| `supersession` | Superseded memory excluded; successor returned |
| `contradiction` | Contradicted memory returned with penalty |
| `topic_hierarchy` | Parent/child topic matching |
| `temporal_expiry` | Expired `valid_until` memory auto-superseded |
| `soft_delete` | Deleted memory excluded |
| `provenance_filter` | Filter by `source_type` |
| `correction_resolution` | High-confidence correction supersedes |
| `multi_tag_retrieval` | Tag intersection scoring |
| `lifecycle_audit` | Audit log contains expected events in order |

### Benchmark Execution

The `BenchmarkRunner` service:
1. Opens a **transaction**.
2. Seeds the DB with fixture data using deterministic UUIDs.
3. Executes the query through the real retrieval engine (not mocked).
4. Compares actual output to expected.
5. **Rolls back the transaction** — leaves DB pristine.
6. Returns pass/fail with diff.

Using a transaction rollback means benchmarks never dirty the real database and can be run at any time safely.

---

## 12. Test Strategy

### Testing Pyramid

```
          ┌──────────────────────────┐
          │   E2E / Benchmark Tests  │  ~10 cases
          │  (full stack, real DB)   │
          └────────────┬─────────────┘
                       │
          ┌────────────▼─────────────┐
          │   Integration Tests      │  ~30 cases
          │  (HTTP routes + real DB) │
          └────────────┬─────────────┘
                       │
          ┌────────────▼─────────────┐
          │      Unit Tests          │  ~80 cases
          │  (services, pure logic)  │
          └──────────────────────────┘
```

### Unit Tests

Focus on pure functions in the scoring and correction engines:

- `scoringEngine.computeScore(query, memory, weights)` → float
- `correctionResolver.classify(existing, incoming)` → `{action, reason}`
- `topicMatcher.score("user", "user.preferences")` → 0.5
- `keywordMatcher.score("dark mode ui", "User prefers dark mode")` → float

No DB dependencies; blazing fast. Establish the mathematical invariants of the system.

### Integration Tests

Use a real in-memory SQLite database (`:memory:` path in better-sqlite3):

- `POST /api/memories` → `GET /api/memories/:id` → assert persisted correctly
- `POST /api/memories` × 2 (conflict) → assert status='contradicted'
- `POST /api/retrieve` → assert ranking order
- `DELETE /api/memories/:id` → `POST /api/retrieve` → assert excluded

### Benchmark Tests (CI gate)

```bash
npm run benchmark --reporter=json
```

If any benchmark fails, CI fails. This is the primary correctness gate and the proof of determinism.

### Test Runner

**Vitest** — faster than Jest for Node.js-only projects, native ESM support, compatible watch mode.

---

## 13. Key Design Decisions — Interview Defence

### "Why not use embeddings for retrieval?"

Embeddings are semantically rich but **probabilistic**. Two runs of the same query against the same data may return different results if the embedding model version changes, or if floating-point precision varies across hardware. A trustworthy memory system must be **auditable** — a human must be able to read the retrieval logic and predict its output. Keyword + topic matching is fully auditable and produces identical results across runs, machines, and time. The penalty in semantic coverage is acceptable because memory content is structured (topics, tags) and short-form assertions, not free-form prose.

### "Why SQLite instead of PostgreSQL?"

This is a single-user or single-agent memory store. SQLite with WAL mode handles thousands of writes per second — far beyond what a memory system needs. Zero infrastructure cost, zero deployment friction, zero connection pooling to configure. The determinism argument also holds: SQLite's query planner is simpler and its sort order is more predictable than Postgres under concurrency.

### "Why soft-delete instead of hard-delete?"

A memory system without history is a memory system that can gaslight you. If a fact was once believed, then corrected, you need to know *what was believed before* to audit the agent's past decisions. Soft-delete preserves this. The storage cost of old memories is negligible.

### "Why `contradicted` as a state instead of just picking a winner?"

The system does not have enough information to pick a winner in the general case. An LLM might assert "the user's favourite colour is blue" and later assert "the user's favourite colour is red." Which is correct? We don't know — user preferences change. Marking both as `contradicted` surfaces the ambiguity to the caller, who can decide or prompt the user for clarification. Silently overwriting would lose information and violate the conservative trust principle.

### "How do you guarantee determinism?"

1. All timestamps are stored as Unix milliseconds (integers — no timezone, no DST ambiguity).
2. All scores are computed from a closed-form formula with no stochastic component.
3. Tie-breaking is by `created_at DESC, id ASC` (UUID lexicographic order) — total ordering.
4. No randomness is used anywhere in the retrieval pipeline.
5. Benchmarks run inside a transaction that is rolled back — the DB state is always identical at benchmark start.

### "What is your extension strategy?"

The `metadata` JSON column on `memories` and the `filters` JSON column on `retrieval_log` allow adding new fields without schema migrations. The weights in the scoring formula are configuration-driven. New topic matchers, new tag strategies, or new status states can be added by extending the existing services without breaking the API contract. The benchmark suite acts as a regression guard for any extension.

### "Why is `confidence` stored on the memory rather than computed?"

Confidence is a provenance attribute, not a derived property. The *asserter* knows how confident they are — the system cannot infer that from content alone without ML. Storing it explicitly makes the trust model transparent and overridable.

---

*Document version: 1.0 — 2026-09-21*
*Author: Caygnus Engineering*
