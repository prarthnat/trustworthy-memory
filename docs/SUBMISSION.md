# Caygnus — Submission Summary

This document is the primary entry point for reviewers per the Caygnus rubric. Detailed design lives in linked docs below.

---

## Selected problem

**Trustworthy long-term memory for an AI agent** — store facts with provenance, track when truth changes (supersession), handle conflicts conservatively, retrieve deterministically, and explain every ranking decision.

The implementation answers five questions **without** embeddings or external model APIs:

| Question | Mechanism |
|----------|-----------|
| What do I know? | Deterministic retrieval (topic, keywords, tags, recency, provenance) |
| Is it still true? | Lifecycle states + supersession chain |
| Where did it come from? | `source`, `source_type`, confidence, audit log |
| What if sources conflict? | Reconciliation (supersede vs ambiguous conflict annotation) |
| Why this result? | Per-result `explanation`, `evidence`, `retrieval_evidence` + UI plain-English summary |

**Stack:** JavaScript (React + Express + SQLite). No TypeScript. No LangChain.

---

## Architecture

```
React UI (4 tabs) ──REST/JSON──► Express services ──► SQLite
  Memory Manager                  memoryService
  Retrieval Explorer              retrievalEngine
  Lifecycle History               lifecycleService
  Benchmark Dashboard             reconciliationService
                                  benchmarkRunner
```

**Persistence:** `memories`, `memory_tags`, `memory_supersessions`, `memory_conflicts`, `memory_audit_log`, `retrieval_log`, `benchmarks`.

**Lifecycle states:** `active`, `superseded`, `deleted` (soft). Ambiguous conflicts remain `active` with conflict records — not a fourth state.

**Correction model:** New memory row + supersession edge; no silent in-place overwrite of factual content.

Deeper reference: [ARCHITECTURE.md](./ARCHITECTURE.md), [DESIGN_REFINEMENT.md](./DESIGN_REFINEMENT.md).

---

## Run instructions

**Prerequisites:** Node.js 18+ (recommended), npm.

```bash
# From repository root
npm run install:all
npm run dev
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:4000 |

**Reviewer walkthrough:** [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) (~5 minutes).

**Acceptance mapping:** [FINAL_REVIEW_CHECKLIST.md](./FINAL_REVIEW_CHECKLIST.md) (AC1–AC6 → UI, tests, benchmarks).

---

## Tests

```bash
npm test
# equivalent: cd backend && npm test
```

**Runner:** Vitest (`backend/vitest.config.js`).

**Unit test files:**

| File | Focus |
|------|--------|
| `backend/tests/unit/memoryService.test.js` | CRUD, soft delete, status |
| `backend/tests/unit/retrievalEngine.test.js` | Scoring, tie-breaks |
| `backend/tests/unit/retrievalService.test.js` | End-to-end retrieve behavior |
| `backend/tests/unit/reconciliationService.test.js` | Supersession vs ambiguous conflict |
| `backend/tests/unit/correctionResolver.test.js` | Correction classification |
| `backend/tests/unit/benchmarkRunner.test.js` | Harness + fixture integration |

Tests use an isolated DB setup (`backend/tests/setup.js`).

---

## Benchmark

**CLI:**

```bash
npm run benchmark
# or: cd backend && node scripts/runBenchmarks.js
```

**UI:** Benchmark Dashboard tab → **Run All Benchmarks** (shows Total / Passed / Failed / Pass Rate / Runtime; failures expandable).

**Design:** Each case runs inside a SQLite **savepoint**: seed deterministic fixture memories → call real `retrieve()` → assert inclusions, exclusions, score bounds, ordering → **rollback** (DB left clean).

**Cases:** 10 scenarios (`bench-001` … `bench-010`) in `backend/tests/benchmarks/deterministicSuite.js`.

**Fixture JSON:** `fixtures/memories.json`, `fixtures/queries.json`, `fixtures/expected_results.json`.

---

## AI usage

### Runtime product (what ships)

- **No external AI APIs** (no OpenAI, Anthropic, etc.).
- **No embeddings** or vector DB in the retrieval path.
- Ranking and reconciliation are **explicit JavaScript rules** auditable in source.

### Development process

- Implementation and documentation may have been assisted by **AI coding tools** (e.g. Cursor/Copilot-style assistants) for boilerplate, tests, and doc drafts.
- All behavior is **verified by unit tests and deterministic benchmarks**; reviewers should treat tests and the benchmark dashboard as the source of truth, not prose alone.

### Interview / demo

- No live LLM is required to demo or score the submission.

---

## Credibility note

This submission optimizes for **reviewer trust**, not semantic cleverness:

1. **Determinism** — Same memories + same query ⇒ same order, scores, and explanations.
2. **Provenance** — Every memory records source, source type, and confidence; UI surfaces them on each card.
3. **Lifecycle integrity** — Audit log + supersession edges; Pune → Mumbai → Pune keeps three rows and a visible chain.
4. **Explainability** — Retrieval Explorer shows structured evidence and a plain-English “why selected” (topic, keywords, tags, recency).
5. **Regression safety** — 44 unit tests + 10 rollback benchmarks; fixtures checked into the repo.
6. **Honest scope** — SQLite single-writer is appropriate for the challenge; scaling path is documented in [INTERVIEW_CHEATSHEET.md](./INTERVIEW_CHEATSHEET.md) without claiming unbuilt production features.

If anything in docs and code disagree, **code + tests win**.

---

## Related documentation

| Document | Purpose |
|----------|---------|
| [DEMO_SCRIPT.md](./DEMO_SCRIPT.md) | Live demo script |
| [FINAL_REVIEW_CHECKLIST.md](./FINAL_REVIEW_CHECKLIST.md) | AC1–AC6 traceability |
| [INTERVIEW_CHEATSHEET.md](./INTERVIEW_CHEATSHEET.md) | Short architecture defense |
| [INTERVIEW_NOTES.md](./INTERVIEW_NOTES.md) | Extended Q&A |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Full system design |
