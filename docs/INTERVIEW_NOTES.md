# Interview Notes

## Architecture decisions

The system is a small REST app with React, Express, and SQLite. The backend owns memory storage, correction resolution, deterministic retrieval, lifecycle history, and benchmark execution. The frontend exposes memory CRUD, retrieval explanations, lifecycle timelines, and benchmark results.

The core design choice is auditability over semantic cleverness. Every stored memory has provenance, every state transition is logged, every supersession is represented as an edge, and every retrieval returns scoring evidence.

## Tradeoffs

- Deterministic lexical retrieval is less semantically flexible than embeddings, but it is inspectable and benchmarkable.
- SQLite is not the final answer for multi-tenant scale, but it is ideal for a challenge because it removes infrastructure and keeps transactions simple.
- Soft delete adds filtering work, but it preserves history and explanations.
- Metadata JSON is flexible for v1, but conflict relationships should become normalized if the product grows.
- Conservative correction avoids false overwrites but can leave more memories for users/operators to resolve.

## Why SQLite

SQLite gives durable persistence, transactions, foreign keys, indexes, and simple local setup with no external service. For a 6-8 hour challenge, that means more time spent on correctness and less on infrastructure. It also makes tests and benchmarks easy because fixtures can run in a local or in-memory database.

For production, I would move to Postgres when the system needs multi-tenant concurrency, row-level authorization, richer analytics, or horizontal scaling.

## Why deterministic retrieval

Trustworthy memory needs reproducibility. Given the same memories and query, the system should return the same ordered result set with the same explanation. The scoring formula, tie-breaks, and filters are all explicit, so a reviewer can inspect why a result appeared.

## Why soft delete

Hard delete makes previous agent behavior impossible to explain. Soft delete preserves the lifecycle: what was believed, when it changed, who changed it, and why. Deleted memories are excluded from retrieval but remain visible in history views as tombstoned records.

## Why no embeddings

Embeddings are powerful, but they introduce model dependency, vector drift, and opaque scoring. This challenge prioritizes deterministic correctness and explainability. Topics, tags, canonical fact keys, and keyword scoring are enough for short structured memories.

## Why provenance matters

The system should distinguish "the user said this" from "the system inferred this." Provenance drives correction rules, retrieval evidence, and audit review. Without provenance, the system cannot responsibly choose between competing memories.

## Production scaling discussion

I would keep the same domain model and move infrastructure gradually:

- SQLite -> Postgres for concurrent writes and multi-tenant access control.
- Metadata conflict annotations -> normalized `memory_conflicts` table.
- REST retrieval logs -> append-only event stream or analytics warehouse.
- Local benchmark fixtures -> CI benchmark suite with regression gates.
- Single-process scoring -> versioned retrieval service with explicit scorer versions.

I would still keep deterministic retrieval for high-trust facts. Embeddings could be added later as a candidate generator, but final ranking and correction would remain rule-based and explainable.

## Reviewer questions and model answers

1. What are the memory states?
Active, superseded, and deleted. Active memories are current, superseded memories were replaced by newer facts, and deleted memories are soft-deleted and excluded from retrieval.

2. Why not use a `contradicted` state?
The rubric asks for active/superseded/deleted. Ambiguity is better modeled as a conflict annotation because ambiguous memories may both remain true and retrievable.

3. How do you decide a memory replaces another?
Only when both memories share the same canonical fact key and the new memory explicitly asserts a replacement for a single-valued attribute.

4. Why does "I moved to Mumbai" replace "I live in Pune"?
Both describe `user.location.home_city`, home city is single-valued, and "moved to" signals the previous value is stale.

5. What happens with Pune -> Mumbai -> Pune?
Three separate memories are preserved. The first Pune and Mumbai memories are superseded, and the final Pune memory is active.

6. Why not reactivate the original Pune memory?
Because the lifecycle matters. The original Pune fact became stale; the later Pune fact is a new assertion with its own timestamp and provenance.

7. What happens if a superseded memory is deleted?
It becomes deleted but remains in lifecycle history and supersession chains. Its successor remains active.

8. Can deleted memories be retrieved?
No. Deleted memories are never returned by retrieval, even with `include_superseded`.

9. Why soft delete?
It preserves auditability, explainability, and chain integrity. Hard delete would hide why an agent previously acted on a fact.

10. What about GDPR-style erasure?
For production, I would add an admin purge workflow with careful cascade/audit policy. It is intentionally out of v1 challenge scope.

11. How does retrieval work without embeddings?
It uses deterministic category/topic matching, keyword overlap, tag matching, recency, provenance, and fixed tie-breaks.

12. How do you handle synonyms?
The v1 system does not attempt semantic synonym expansion. That is a deliberate tradeoff for determinism.

13. How do you break ties?
By score descending, active before superseded, updated_at descending, created_at descending, then ID ascending.

14. Why include recency?
Recent memories are often more relevant for preferences and current facts. Recency is only one bounded component, not a replacement for explicit supersession.

15. How do you keep recency deterministic in tests?
Use fixed fixture timestamps and an injectable/fixed clock in benchmark execution.

16. What retrieval evidence is returned?
Score, matched fields, topic/category match type, matched keywords, matched tags, recency score, provenance score, status penalty, and scorer version.

17. Why store retrieval logs?
To debug and replay why the system returned a memory at a given time.

18. What is provenance?
The source, source type, confidence, actor, timestamp, and ideally conversation/event ID for each memory.

19. Why is user source stronger than inferred source?
A direct user assertion is more authoritative than system inference, especially for personal preferences and profile facts.

20. Why is same topic not enough for correction?
Same topic can contain coexistable facts. "Favorite language is JavaScript" and "enjoying Python recently" are both programming preferences but not replacements.

21. How do you handle "I sometimes use Cursor" after "Preferred IDE is VS Code"?
Store both as active. VS Code remains the primary IDE preference; Cursor is contextual/secondary use.

22. How are supersession chains stored?
In a directed table from old memory ID to new memory ID with reason, timestamp, and actor.

23. Why a separate supersession table?
It preserves history and supports chains without overloading the memory row with only one possible predecessor/successor.

24. What schema change would you make next?
Add a normalized `memory_conflicts` table and store scorer version/weights in retrieval logs.

25. Why SQLite over Postgres here?
SQLite is durable, transactional, local, and zero-infrastructure. That is perfect for a coding challenge and single-agent use.

26. How would you scale to production?
Move to Postgres, add tenant boundaries, normalize conflicts, add migrations, add observability, and version retrieval scoring.

27. What is the biggest correctness risk?
False supersession: replacing an old memory when both facts could coexist.

28. How does the benchmark prove correctness?
It seeds fixed memories, runs fixed queries, and checks exact inclusions/exclusions and ordering for corrections, ambiguity, deletion, and retrieval.

29. What would cause benchmark failure?
Returning stale/deleted facts, missing active facts, unstable ordering, missing evidence, or incorrectly superseding ambiguous memories.

30. What did you intentionally keep simple?
No embeddings, no LLM extraction, no distributed system, and no complex NLP. The goal is clear, auditable memory behavior in a short challenge.
