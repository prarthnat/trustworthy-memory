# Final Review Checklist — Acceptance Criteria Mapping

Use this sheet during code review or live demo scoring. Each **AC** maps to product behavior, where to verify it in the UI/API, automated tests, and benchmark coverage.

---

## Master traceability (AC → UI → tests → benchmarks)

| AC | Theme | UI screen(s) | Unit / integration tests | Benchmark IDs |
|----|--------|--------------|---------------------------|---------------|
| **AC1** | Provenance & memory CRUD | Memory Manager | `memoryService.test.js` | `bench-001`, `bench-007` |
| **AC2** | Lifecycle & audit trail | Memory Manager, Lifecycle History | `memoryService.test.js` | `bench-010` |
| **AC3** | Deterministic retrieval & explainability | Retrieval Explorer | `retrievalEngine.test.js`, `retrievalService.test.js` | `bench-001`–`004`, `008`, `009` |
| **AC4** | Correction, supersession, conflicts | Memory Manager (correct), Lifecycle History (chain) | `reconciliationService.test.js`, `correctionResolver.test.js` | `bench-002`, `003`, `005`, `010` |
| **AC5** | Soft delete | Memory Manager, Lifecycle History | `memoryService.test.js` | `bench-006` |
| **AC6** | Benchmark harness & regression | Benchmark Dashboard | `benchmarkRunner.test.js` (+ full suite) | `bench-001` … `bench-010` (10 cases) |

**Fixtures:** `fixtures/memories.json`, `fixtures/queries.json`, `fixtures/expected_results.json`  
**Suite definition:** `backend/tests/benchmarks/deterministicSuite.js`

---

## AC1 — Memory storage & provenance

| Item | Detail |
|------|--------|
| **Feature** | Create/list/get memories with `content`, `topic`, `source`, `source_type`, `confidence`, `tags`, timestamps, and optional `metadata.canonical_key`. |
| **UI** | **Memory Manager** — full metadata grid on every card; add/correct form exposes provenance fields. |
| **API** | `POST /api/memories`, `POST /api/memories/correct`, `GET /api/memories`, `GET /api/memories/:id` |
| **Unit tests** | `backend/tests/unit/memoryService.test.js` |
| **Benchmarks** | `bench-001` (basic retrieval), `bench-007` (provenance filter) |
| **Fixtures** | `fixtures/memories.json` |

**Reviewer checks**

- [ ] New memory shows Memory ID, Source, Source Type, Confidence, Tags, Created/Updated At.
- [ ] `source_type` is one of `user` \| `system` \| `inferred`.

---

## AC2 — Lifecycle states & audit trail

| Item | Detail |
|------|--------|
| **Feature** | States: `active`, `superseded`, `deleted` (plus legacy `contradicted` if present in DB). All transitions logged in `memory_audit_log`. |
| **UI** | **Memory Manager** — prominent lifecycle banner per card. **Lifecycle History** — event timeline with created/superseded/deleted labels. |
| **API** | `GET /api/lifecycle/:id`, `GET /api/lifecycle/recent` |
| **Unit tests** | `memoryService.test.js` (delete/restore/status), lifecycle via integration paths |
| **Benchmarks** | `bench-010` (lifecycle audit / supersession visibility) |
| **Docs** | `docs/DESIGN_REFINEMENT.md` §1, `docs/ARCHITECTURE.md` §7 |

**Reviewer checks**

- [ ] Status is visually obvious on memory cards.
- [ ] Lifecycle view shows chronological audit events with actor and timestamps.
- [ ] Deleted memories visible in history but excluded from default memory list filter.

---

## AC3 — Deterministic retrieval & explainability

| Item | Detail |
|------|--------|
| **Feature** | Weighted lexical scoring (topic, keywords, tags, recency, provenance) minus supersession penalty; tie-breakers documented; per-result `explanation`, `evidence`, `retrieval_evidence`; retrieval log ID. |
| **UI** | **Retrieval Explorer** — score, Memory ID, status, **Why this memory was selected**, structured evidence. |
| **API** | `POST /api/retrieve`, `GET /api/retrieve/log/:id` |
| **Unit tests** | `backend/tests/unit/retrievalEngine.test.js`, `retrievalService.test.js` |
| **Benchmarks** | `bench-001`–`bench-004`, `bench-008`, `bench-009` |
| **Fixtures** | `fixtures/queries.json`, `fixtures/expected_results.json` |

**Reviewer checks**

- [ ] Repeated identical query returns identical ordering/scores.
- [ ] Plain-English explanation matches structured breakdown.
- [ ] Superseded memories excluded unless `include_superseded=true`.

---

## AC4 — Correction, supersession & conflicts

| Item | Detail |
|------|--------|
| **Feature** | `reconciliationService` classifies duplicate / supersede / ambiguous conflict via canonical fact key and language signals; `memory_supersessions` edges; ambiguous conflicts annotated without illegal state jumps. |
| **UI** | **Memory Manager** — correct flow + **Supersedes** / **Superseded By** IDs. **Lifecycle History** — **Supersession Chain Summary**. |
| **API** | `POST /api/memories/correct`, `GET /api/memories/:id/supersessions`, `POST /api/memories/:id/supersede` |
| **Unit tests** | `correctionResolver.test.js`, `reconciliationService.test.js` |
| **Benchmarks** | `bench-002`, `bench-003`, `bench-005`, `bench-010` |
| **Docs** | `docs/DESIGN_REFINEMENT.md` §2–3, `docs/ARCHITECTURE.md` §9 |

**Reviewer checks**

- [ ] Pune → Mumbai → Pune preserves three rows; only latest active in default retrieval.
- [ ] Supersession chain summary shows ordered contents and marks CURRENT ACTIVE.
- [ ] Ambiguous same-topic preferences do not auto-supersede (see reconciliation tests).

---

## AC5 — Deletion policy (soft delete)

| Item | Detail |
|------|--------|
| **Feature** | `DELETE` sets `status=deleted`, logs event; excluded from retrieval; restore path with guardrails. |
| **UI** | **Memory Manager** — Delete action; filter **Deleted**. **Lifecycle History** — **Deleted (soft)** events. |
| **API** | `DELETE /api/memories/:id`, `POST /api/memories/:id/restore` |
| **Unit tests** | `memoryService.test.js` |
| **Benchmarks** | `bench-006` (soft delete exclusion) |
| **Docs** | `docs/DESIGN_REFINEMENT.md` §5, `docs/ARCHITECTURE.md` §10 |

**Reviewer checks**

- [ ] Deleted memory never appears in Retrieval Explorer results.
- [ ] Deletion event visible in lifecycle timeline.

---

## AC6 — Benchmarks & automated test coverage

| Item | Detail |
|------|--------|
| **Feature** | SQLite savepoint harness; seed → retrieve → assert → rollback; dashboard summary (pass rate, duration, expandable failures). |
| **UI** | **Benchmark Dashboard** — summary cards + per-case status/duration/failures. |
| **API** | `GET /api/benchmarks`, `POST /api/benchmarks/run`, `POST /api/benchmarks/run/:id` |
| **Unit tests** | `benchmarkRunner.test.js` + full vitest suite (`npm test` in `backend/`) |
| **Benchmark cases** | 10 cases: `bench-001` … `bench-010` in `backend/tests/benchmarks/deterministicSuite.js` |
| **CLI** | `backend/scripts/runBenchmarks.js` |

**Reviewer checks**

- [ ] **Run All** shows Total / Passed / Failed / Pass Rate / Runtime.
- [ ] Failed cases expand to show assertion messages.
- [ ] `npm test` passes in CI/local.

---

## Quick command reference

```bash
# Backend tests
cd backend && npm test

# Benchmarks (CLI)
cd backend && node scripts/runBenchmarks.js

# Frontend (after backend is up)
cd frontend && npm run dev
```

---

## Documentation index

| Doc | Purpose |
|-----|---------|
| `docs/SUBMISSION.md` | Rubric submission summary (start here) |
| `docs/DEMO_SCRIPT.md` | 5-minute live walkthrough |
| `docs/INTERVIEW_CHEATSHEET.md` | Architecture and design defense |
| `docs/ARCHITECTURE.md` | Full system design |
| `docs/DESIGN_REFINEMENT.md` | Rubric-aligned refinement |
| `docs/INTERVIEW_NOTES.md` | Extended Q&A |
