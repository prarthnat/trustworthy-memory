# Caygnus Design Refinement

This document tightens the architecture for the review rubric before implementation. It keeps the system small enough for a 6-8 hour challenge while making lifecycle, correction, retrieval, deletion, benchmark, and test behavior explicit.

## 1. Memory Lifecycle Design

### States

| State | Meaning | Retrieval behavior | History behavior |
|---|---|---|---|
| `active` | Current candidate truth. | Included by default. | Shown as current node in lifecycle timeline. |
| `superseded` | Replaced by a newer memory through an explicit correction. | Excluded by default; included only when `include_superseded=true`. | Shown in supersession chain with the replacing memory and reason. |
| `deleted` | Soft-deleted by a user/operator. | Never included in retrieval. | Shown in history views with deletion event and prior state. |

Ambiguous conflicts are not modeled as a fourth lifecycle state in the acceptance design. They are active memories with a conflict annotation in metadata/audit until a later explicit correction supersedes one side. This keeps the core state machine aligned to the rubric while still surfacing ambiguity.

### State transition diagram

```text
                       create
                         |
                         v
                    +----------+
                    |  active  |
                    +----------+
                    |    |     \
 explicit correction|    |      \ user/operator delete
 or temporal expiry |    |       \
                    v    |        v
              +------------+   +---------+
              | superseded |   | deleted |
              +------------+   +---------+
                    |              ^
                    |              |
                    +--------------+
                   soft-delete historical row

Optional operator restore:
deleted -> active, only when no active successor exists or operator explicitly accepts duplicate-risk.
```

### Allowed transitions

| Transition | Trigger | Notes |
|---|---|---|
| none -> `active` | Memory creation. | Creates provenance and audit event. |
| `active` -> `superseded` | New memory explicitly replaces old memory. | Creates `memory_supersessions(old_memory_id, new_memory_id, reason)`. |
| `active` -> `deleted` | User/operator delete. | Soft delete; audit log preserves the old content. |
| `superseded` -> `deleted` | User/operator deletes old historical memory from normal views. | Keeps supersession edge and audit row intact. |
| `deleted` -> `active` | Explicit restore. | Allowed only if no non-deleted active replacement exists for the same canonical fact, or if the operator confirms restoration as a new current truth. |

### Forbidden transitions

| Transition | Why forbidden |
|---|---|
| `superseded` -> `active` without a restore/correction event | It would erase why the memory became stale and can create two current truths. |
| `deleted` -> `superseded` directly | A deleted memory should first be restored or referenced as historical context; supersession requires a live old/current fact or explicit historical deletion. |
| `deleted` -> hard removed | Breaks auditability, lifecycle replay, and supersession chain integrity. |
| `superseded` -> hard removed | Breaks the explanation for why the active memory exists. |
| `active` -> `active` replacement in place | Updates are allowed for metadata or typo-level edits, but factual corrections should create a new memory and supersede the old one. |

### Edge cases

Pune -> Mumbai -> Pune:

```text
mem_location_1: "I live in Pune"   status=superseded
mem_location_2: "I moved to Mumbai" status=superseded
mem_location_3: "I moved back to Pune" status=active

Supersession edges:
mem_location_1 -> mem_location_2
mem_location_2 -> mem_location_3
```

The final Pune memory is not the same row as the original Pune memory. The system preserves the fact that Pune was true, then stale, then true again.

Delete after supersession:

```text
old Pune memory: active -> superseded -> deleted
current Pune memory: active
```

The deleted old memory remains visible in lifecycle/history views and remains connected to the chain, but it never appears in retrieval.

Deletion of active memory:

```text
active -> deleted
```

No replacement is created. Retrieval should act as if the memory does not exist, while lifecycle views show the deletion event and actor.

## 2. Explicit Correction Policy

The system supersedes only when the incoming memory is an explicit replacement for the same canonical fact.

### Canonical fact key

A canonical fact key is a deterministic tuple:

```text
subject + attribute + scope
```

Examples:

| Memory | Canonical key |
|---|---|
| "I live in Pune" | `user.location.home_city` |
| "I moved to Mumbai" | `user.location.home_city` |
| "My preferred IDE is VS Code" | `user.preference.ide.primary` |
| "I sometimes use Cursor" | `user.tool.ide.secondary_or_contextual` |

If the product does not yet extract structured `subject/attribute/scope`, the initial implementation should approximate the key with `topic` plus controlled tags such as `home_city`, `primary_language`, `primary_ide`, and `diet`.

### Replacement rules

A new memory replaces an old memory when all are true:

1. The old memory is `active`.
2. The old and new memories have the same canonical fact key.
3. The new memory is user-sourced or manually operator-approved.
4. The new memory uses replacement language or directly asserts a new value for a single-valued attribute.
5. The old and new values differ, or the new memory explicitly says the old value is no longer true.

Replacement language includes: `moved to`, `moved back to`, `now`, `no longer`, `instead`, `changed to`, `switched to`, `correcting`, `actually`, `my current`, `my new`.

Single-valued attributes include home city, current employer, primary IDE, primary programming language, legal/preferred name, timezone, dietary restriction, and notification preference.

### Examples

`"I live in Pune"` then `"I moved to Mumbai"` should supersede.

Why: both refer to `user.location.home_city`; home city is single-valued; `moved to` is explicit replacement language; the new source is the user.

`"My preferred IDE is Vim"` then `"I switched to VS Code"` should supersede.

Why: both refer to `user.preference.ide.primary`; `switched to` states the new primary preference.

`"I am vegetarian"` then `"I am vegan now"` should supersede.

Why: both refer to `user.diet.current`; `now` makes the new assertion current and incompatible with the old one.

### Non-examples

`"My favorite language is JavaScript"` then `"I have been enjoying Python recently"` should not supersede.

Why: enjoying something recently is not the same attribute as favorite/primary language.

`"My preferred IDE is VS Code"` then `"I sometimes use Cursor"` should not supersede.

Why: occasional use can coexist with a primary preference.

`"I live in Pune"` then `"I visited Mumbai last week"` should not supersede.

Why: travel history does not replace home city.

## 3. Ambiguous Contradiction Policy

The conflict strategy is conservative: preserve both memories, mark the relationship as ambiguous in metadata/audit, and avoid silently choosing a winner.

### Policy

Ambiguous memories remain `active` unless a clear replacement rule fires. The system records conflict evidence:

```json
{
  "conflict": {
    "type": "ambiguous",
    "related_memory_ids": ["mem_language_2"],
    "reason": "New memory expresses recent enjoyment, not replacement of favorite language."
  }
}
```

This can be implemented with metadata initially. A future version can normalize it into a `memory_conflicts` table.

### Why examples are not replacements

Current: `Favorite language = JavaScript`

New: `I have been enjoying Python recently`

These can both be true. The new memory is about recent enjoyment, not stable favorite language. Retrieval for "favorite language" should rank JavaScript higher; retrieval for "recent Python interest" should rank Python higher. Both results should expose evidence so the caller sees the distinction.

Current: `Preferred IDE = VS Code`

New: `I sometimes use Cursor`

These can both be true. `sometimes use` indicates secondary/contextual use, not primary preference. Retrieval for "preferred IDE" should return VS Code first; retrieval for "Cursor" should return the Cursor memory.

### Retrieval behavior

Default retrieval includes both active memories if they match the query. Scoring and explanations decide rank:

- Exact topic/canonical-key matches outrank broad topical matches.
- Keyword matches expose whether the query matched `favorite`, `preferred`, `recently`, `sometimes`, or the tool/language name.
- Conflict annotations appear in retrieval evidence, but they do not suppress active memories.

### Assumptions

- User-sourced statements are authoritative only when they assert the same canonical fact.
- Preferences can be multi-valued unless the attribute is explicitly modeled as single-valued.
- "Recently", "sometimes", "also", and "trying" are coexistence signals, not replacement signals.
- A reviewer/operator can manually supersede one side if product policy requires a single answer.

## 4. Retrieval Scoring Design

Retrieval is deterministic, lexical, and local. It uses no embeddings, no LLM calls, and no randomness.

### Candidate selection

1. Exclude `deleted`.
2. Exclude `superseded` unless `include_superseded=true`.
3. Apply exact/prefix topic filter when provided.
4. Apply source type and tag filters when provided.
5. Score all remaining candidates.

### Score

```text
score =
  0.40 * category_score +
  0.25 * keyword_score +
  0.15 * tag_score +
  0.10 * recency_score +
  0.10 * provenance_score -
  status_penalty
```

Recommended values:

| Component | Rule |
|---|---|
| `category_score` | Exact topic/canonical key = 1.0; child topic = 0.7; parent topic = 0.5; shared prefix = 0.25; none = 0.0. |
| `keyword_score` | Unique query tokens matched in `content`, `topic`, tags, and canonical key divided by unique query tokens. Stop words removed. |
| `tag_score` | Matching query tags divided by query tags; neutral 0.5 when no tags requested. |
| `recency_score` | `1 / (1 + age_days / 30)`, using a fixed `now` in tests. |
| `provenance_score` | user = 1.0, system = 0.7, inferred = 0.4. |
| `status_penalty` | active = 0.0, superseded = 0.5 when included. |

### Tie-breaking

Sort by:

1. score descending
2. status rank: active before superseded
3. `updated_at` descending
4. `created_at` descending
5. `id` ascending

This creates a total order for deterministic output.

### Maximum result count

Default limit is 10. Maximum accepted limit is 25. Benchmark queries should specify their limit explicitly.

### Retrieval evidence

Every retrieved memory returns:

```json
{
  "memory_id": "mem_003",
  "score": 0.91,
  "matched_fields": ["topic", "content", "tags"],
  "retrieval_evidence": {
    "category": { "type": "exact", "score": 1.0 },
    "keywords": { "matched": ["home", "city", "pune"], "score": 0.75 },
    "tags": { "matched": ["location"], "score": 1.0 },
    "recency": { "age_days": 1, "score": 0.9677 },
    "provenance": { "source_type": "user", "score": 1.0 },
    "status": { "status": "active", "penalty": 0.0 }
  }
}
```

Example: query "Where does the user live?" with topic `user.location.home_city` returns the active "I moved back to Pune" memory and excludes older Pune/Mumbai memories because they are superseded.

Example: query "What IDE does the user prefer?" returns "My preferred IDE is VS Code" before "I sometimes use Cursor" because the former has exact canonical key and stronger keyword match for `prefer`.

## 5. Deletion Design

Choose Option B: soft delete.

### Tradeoffs

| Option | Pros | Cons |
|---|---|---|
| Hard delete | Simple retrieval filtering; satisfies strict erasure if required. | Destroys audit history, breaks supersession chains, makes benchmark/history explanations weaker. |
| Soft delete | Preserves provenance, lifecycle, supersession edges, and reviewer-visible explanations. | Requires retrieval filters to exclude deleted rows and a future purge story for compliance. |

### Why soft delete wins

Soft delete best matches the challenge goals: trustworthy memory needs to explain what changed, when, and why. A hard delete can make the agent's prior behavior inexplicable.

Deleted memories appear in history views as tombstoned records:

```json
{
  "id": "mem_002",
  "status": "deleted",
  "content": "I moved to Mumbai",
  "deleted_at": 1725580800000,
  "deleted_by": "user",
  "previous_status": "superseded",
  "visible_in_retrieval": false
}
```

Benchmark implication: deleted memories must be explicitly listed under `expected_exclusions` for relevant queries.

## 6. Database Design Review

The current schema mostly supports the rubric:

| Requirement | Current support | Recommendation |
|---|---|---|
| Provenance | `source`, `source_type`, `confidence`, audit actor. | Add optional `source_event_id` or `conversation_id` in metadata for traceability. |
| History inspection | `memory_audit_log`. | Keep append-only; include status snapshots in each event. |
| Supersession chains | `memory_supersessions`. | Add uniqueness guard on `(old_memory_id, new_memory_id)` and prevent self-supersession. |
| Deletion | `status='deleted'`. | Keep soft delete; document restore constraints. |
| Retrieval explanations | `retrieval_log.results` JSON. | Store scorer version and weight config in `retrieval_log.filters` or a new column. |
| Ambiguous conflicts | Current schema has `contradicted` status. | Prefer metadata annotation or future `memory_conflicts` table to keep core lifecycle to active/superseded/deleted. |

Recommended future table:

```sql
memory_conflicts(
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  related_memory_id TEXT NOT NULL,
  conflict_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
)
```

This is not required for v1; metadata plus audit notes are enough for the challenge.

## 7. Benchmark Design

Fixture files:

- `fixtures/memories.json`: at least 30 deterministic memory rows.
- `fixtures/queries.json`: 20 deterministic retrieval queries.
- `fixtures/expected_results.json`: expected inclusions and exclusions per query.

The supplied fixture design includes:

- 30 memories.
- 5 correction chains: home city, primary IDE, primary language, employer, diet.
- 2 ambiguous conflicts: JavaScript vs recent Python enjoyment, VS Code vs sometimes Cursor.
- 20 retrieval queries.

For each query, expected inclusions prove what should be found. Expected exclusions prove stale, deleted, or ambiguous non-replacements do not leak into the wrong answer.

## 8. Test Strategy

| Area | Setup | Action | Expected result |
|---|---|---|---|
| Storage | Empty DB. | Create memory with content/topic/source/tags. | Row exists, tags normalized, audit `created` exists. |
| Provenance | Empty DB. | Create user/system/inferred memories. | `source_type`, `source`, `confidence`, actor are persisted and returned. |
| Retrieval exact topic | Seed active profile and location memories. | Query location topic. | Location memory included; profile excluded; evidence names topic match. |
| Retrieval keywords | Seed two active same-topic memories. | Query matching one memory's tokens. | Higher keyword match ranks first. |
| Retrieval tie-break | Seed same score memories with different timestamps/IDs. | Query both. | Newer wins; if equal timestamp, lower ID wins. |
| Correction supersession | Seed `I live in Pune`. | Add `I moved to Mumbai`. | Old status `superseded`; new `active`; edge exists. |
| Supersession chain | Seed Pune -> Mumbai -> Pune. | Fetch chain for each memory. | Chain preserves all three nodes in order. |
| Delete active | Seed active memory. | Delete it, retrieve matching query. | Status `deleted`; excluded from retrieval; audit event exists. |
| Delete superseded | Seed old/new chain. | Delete old memory. | Old status `deleted`; new stays active; chain still renders old node. |
| Ambiguous language | Seed favorite JavaScript. | Add enjoying Python recently. | Both active; no supersession edge; conflict annotation/audit note exists. |
| Ambiguous IDE | Seed preferred VS Code. | Add sometimes use Cursor. | Both active; preferred IDE query ranks VS Code first. |
| Include superseded | Seed correction chain. | Query with `include_superseded=true`. | Active first, superseded included with penalty/evidence. |

## 9. Reviewer Critique

### Weak points

- Current implementation's `contradicted` state may diverge from the acceptance rubric if not explained or refactored.
- Same-topic conflict detection is too broad; topic alone is not enough to supersede.
- Recency based on `Date.now()` needs test-time clock injection or fixed timestamps to keep benchmark scores stable.
- UUID generation is fine for production but benchmark fixtures need deterministic IDs.
- Metadata JSON is flexible but weakly typed; reviewers may ask how conflicts stay queryable at scale.

### Hidden risks

- "High confidence user memory replaces same topic" can incorrectly supersede coexistable preferences.
- Restoring a deleted memory can create two active memories for the same canonical key.
- Soft delete may not satisfy strict regulatory erasure without an admin purge path.
- Stop-word/token rules can miss synonyms; this is accepted but should be clearly defended.
- SQLite single-writer behavior is fine for challenge scale but needs a migration story for production.

### Missing acceptance criteria to close before implementation

- Define canonical fact keys or controlled tags for replacement-sensitive attributes.
- Add retrieval evidence fields exactly as API response contract.
- Add fixture-backed benchmark files, not just in-code benchmark cases.
- Ensure deleted memories are visible in lifecycle but impossible in retrieval.
- Document ambiguous conflict behavior separately from supersession.

### Likely reviewer questions

- How do you know "moved to Mumbai" replaces "live in Pune"?
- Why not use embeddings?
- What happens when the user moves back to Pune?
- Can deleted data be restored?
- How do you explain a retrieval result?
- How would this scale beyond SQLite?

### Likely rejection reasons

- Treating all same-topic memories as replacements.
- Returning deleted or superseded memories by default.
- No deterministic benchmark fixtures.
- No provenance or audit trail.
- No clear answer for ambiguous contradictions.

### Improvements before implementation

- Replace broad same-topic supersession with canonical fact key matching.
- Keep lifecycle states to `active`, `superseded`, and `deleted`; track ambiguity separately.
- Add scorer version and weights to retrieval logs.
- Add fixture JSON and deterministic tests before changing service logic.
- Use an injectable/fixed clock in tests and benchmarks.
