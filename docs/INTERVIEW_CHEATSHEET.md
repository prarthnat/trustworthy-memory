# Interview Cheatsheet — Caygnus

One-page study guide for architecture reviews and system-design interviews.

---

## Architecture summary

```
React UI (Memory / Retrieval / Lifecycle / Benchmarks)
        │ REST JSON
Express services: memoryService, reconciliationService, retrievalEngine,
                  lifecycleService, benchmarkRunner
        │ better-sqlite3 (sync, single-writer)
SQLite: memories, memory_tags, memory_supersessions, memory_conflicts,
        memory_audit_log, retrieval_log, benchmarks
```

**Core principle:** Trust over semantic magic — deterministic scoring, explicit lifecycle, full audit trail, fixture-backed regression tests.

**Stack constraints:** JavaScript only, no TypeScript, no external AI/embeddings, no LangChain, SQLite.

---

## Lifecycle states

| State | Meaning | Retrieval default |
|-------|---------|-------------------|
| `active` | Current candidate truth | Included |
| `superseded` | Replaced by newer memory via explicit correction | Excluded (`include_superseded=true` to include with penalty) |
| `deleted` | Soft-deleted by user/operator | Never returned |

**Not a fourth state:** Ambiguous conflicts stay **active** with conflict annotations until explicit correction.

**Pune → Mumbai → Pune:** Three memory rows; two superseded, one active; chain edges preserved; final Pune is a **new** assertion, not reactivation of the first row.

**Forbidden (design intent):** `superseded → active` without restore; hard delete of superseded rows; in-place factual overwrite without new memory + edge.

---

## Retrieval algorithm

**Formula (components ∈ [0,1], weighted sum − penalty):**

```
score = W_category×topic + W_keywords×keywords + W_tags×tags
      + W_recency×recency + W_provenance×provenance − statusPenalty
```

Default weights (~): category 0.40, keywords 0.25, tags 0.15, recency 0.10, provenance 0.10.

**Topic match:** exact > prefix > parent > partial segment overlap > none (neutral 0.5 if no topic filter).

**Tags:** Jaccard-like overlap with query tag set.

**Keywords:** Token overlap after stop-word removal.

**Recency:** `1 / (1 + days / half_life)` with half-life ≈ 30 days.

**Provenance:** user (1.0) > system (0.7) > inferred (0.4).

**Status penalty:** superseded → 0.50 subtracted (when included).

**Tie-break:** score DESC → active before superseded → `updated_at` DESC → `created_at` DESC → `id` ASC.

**Explainability:** Each result returns `explanation`, `evidence[]`, and `retrieval_evidence` (scorer version, component scores). UI renders plain-English “why selected.”

---

## Supersession logic

1. **Canonical fact key** — `metadata.canonical_key` or normalized `topic`; replacement only when keys align.
2. **Explicit replacement signals** — e.g. “moved to”, “correcting”, “instead”, “no longer” (see `REPLACEMENT_SIGNALS` in `reconciliationService.js`).
3. **Single-valued facts** — suffixes like `home_city`, `favorite`, `primary` allow one active truth per key.
4. **Effect** — new row stays `active`; prior row → `superseded`; edge in `memory_supersessions(old, new, reason)`.
5. **Chain integrity** — Pune → Mumbai → Pune = three rows, two edges; final Pune is a **new** memory, not reactivation of the first.

**API:** `POST /api/memories/correct`, `GET /api/memories/:id/supersessions`

## Ambiguous conflict policy

- **Not a lifecycle state** — both memories remain `active`.
- **Triggers** — same topic or related tags but **coexistence** language (“sometimes”, “also”, “occasionally”) or non-single-valued keys.
- **Persistence** — `memory_conflicts` rows + audit events; metadata may annotate ambiguity.
- **Retrieval** — both may appear; reviewer sees conflict in lifecycle/tests, not automatic supersede.
- **Resolution** — later **explicit** correction with replacement signals supersedes one side.

## Duplicate handling

Identical normalized content → classified as duplicate in reconciliation (no spurious supersession chain).

---

## Deletion policy

- **Soft delete:** `status = deleted`, audit event, content retained.
- **Retrieval:** deleted memories never returned.
- **History:** deletion visible in lifecycle; supersession edges remain.
- **Restore:** allowed with guards when no conflicting active successor for same canonical fact.
- **GDPR-style erasure:** out of scope for demo; would need admin purge pipeline while breaking pure audit completeness.

---

## Benchmark design

- **10 deterministic cases** (`bench-001` … `bench-010`): basic retrieval, supersession exclusion/inclusion, topic hierarchy, temporal/recency, soft delete, provenance, multi-tag, tie-break, lifecycle audit.
- **Harness:** SQLite savepoint → seed fixtures with fixed IDs → real `retrieve()` → compare inclusions/exclusions/score bounds/ordering → rollback (DB pristine).
- **Artifacts:** `fixtures/memories.json`, `fixtures/queries.json`, `fixtures/expected_results.json`; suite definition in `deterministicSuite.js`.
- **UI:** Dashboard shows pass rate, duration, expandable failure messages.

---

## Scaling discussion (interview closing)

| Today (challenge) | Production evolution |
|-------------------|----------------------|
| SQLite single writer | PostgreSQL + connection pooling |
| In-process scoring | Versioned retrieval service (`scorer` in logs) |
| Metadata conflicts | Normalized `memory_conflicts` (already started) |
| REST logs | Append-only event stream / warehouse for analytics |
| Lexical retrieval only | Optional embeddings as **candidate generator**; final rank still rule-based and explainable |

**What not to sacrifice:** provenance, lifecycle integrity, deterministic regression tests, supersession explainability.

---

## Likely rapid-fire answers

- **Why no embeddings?** Reproducibility and human-auditable scoring.
- **Why SQLite?** Zero infra, transactional tests, fast challenge delivery.
- **Why new row on correction?** Preserves *when* truth changed and *why* (supersession edge).
- **How explain retrieval?** Show `retrieval_evidence` + weighted breakdown in UI/API response.
- **How prove correctness?** Vitest unit tests + 10 benchmark scenarios with rollback.

---

## Key file map

| Area | File |
|------|------|
| Retrieval scoring | `backend/src/services/retrievalEngine.js` |
| Reconciliation | `backend/src/services/reconciliationService.js` |
| Memory CRUD | `backend/src/services/memoryService.js` |
| Lifecycle queries | `backend/src/services/lifecycleService.js` |
| Benchmark runner | `backend/src/services/benchmarkRunner.js` |
| Schema | `backend/src/db/schema.sql` |
| Deep dive | `docs/ARCHITECTURE.md` |
