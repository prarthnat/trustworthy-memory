# Caygnus — Trustworthy Long-Term Memory

Deterministic memory storage for agents: **provenance**, **lifecycle**, **supersession**, **explainable retrieval**, and **fixture-backed benchmarks**. JavaScript only (React + Express + SQLite). No embeddings or external AI APIs.

## Quick start

```bash
npm run install:all
npm run dev
```

- Frontend: http://localhost:3000  
- Backend API: http://localhost:4000  

```bash
npm test          # unit tests (backend)
npm run benchmark # deterministic benchmark CLI
```

## Reviewer entry points

| Goal | Where |
|------|--------|
| **Rubric submission summary** | [docs/SUBMISSION.md](docs/SUBMISSION.md) |
| AC1–AC6 traceability | [docs/FINAL_REVIEW_CHECKLIST.md](docs/FINAL_REVIEW_CHECKLIST.md) |
| Full architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |

## UI tabs

1. **Memory Manager** — CRUD, provenance fields, lifecycle status, supersession links  
2. **Retrieval Explorer** — scored results + plain-English “why selected”  
3. **Lifecycle History** — audit trail + supersession chain summary  
4. **Benchmark Dashboard** — pass rate, runtime, expandable failures  
