# Caygnus — 5-Minute Demo Script

Use this script live with the React UI (Memory Manager → Retrieval Explorer → Lifecycle History → Benchmark Dashboard). Target runtime: **~5 minutes**.

---

## 0. Setup (30 seconds)

1. Start backend (`port 4000`) and frontend (`port 3000`).
2. Open the app — confirm tabs: **Memory Manager**, **Retrieval Explorer**, **Lifecycle History**, **Benchmark Dashboard**.

**Say:** “Caygnus is a deterministic long-term memory layer: every fact has provenance, lifecycle state, supersession edges, and retrieval evidence.”

---

## 1. Add memory (45 seconds)

**Tab:** Memory Manager

1. Add a memory:
   - Content: `I live in Pune`
   - Topic: `user.location.home_city`
   - Canonical key: `user.location.home_city`
   - Source: `onboarding-form`
   - Source type: `user`
   - Confidence: `1.0`
   - Tags: `location, home`
2. Click **Add Memory**.

**Point out on the card:** Memory ID, **ACTIVE** lifecycle banner, topic, source/source type, timestamps, confidence, tags.

**Say:** “Provenance and topic are first-class — not just blob text.”

---

## 2. Retrieve memory (45 seconds)

**Tab:** Retrieval Explorer

1. Query: `home city Pune`
2. Topic filter: `user.location.home_city`
3. Click **Retrieve**.

**Point out:** Memory ID, status, retrieval score, structured **Retrieval Evidence**, and the plain-English block **“Why this memory was selected”**.

**Say:** “Same inputs always produce the same ranked output and the same explanation — no embeddings, no LLM.”

---

## 3. Correct memory (supersession) (60 seconds)

**Tab:** Memory Manager

1. Check **Submit as explicit correction**.
2. Add:
   - Content: `I moved to Mumbai`
   - Same topic and canonical key as step 1
   - Source: `user-chat`, type `user`
3. Click **Submit Correction**.

4. Filter list to **Superseded** — open the Pune memory card.

**Point out:** Pune shows **SUPERSEDED** banner and **Superseded By Memory** ID. Mumbai is **ACTIVE**.

**Say:** “Corrections create a *new* memory and supersede the old one — we don’t silently overwrite rows.”

---

## 4. Show history + supersession chain (60 seconds)

**Tab:** Lifecycle History (or **History** on the Mumbai card)

1. Enter the **active Mumbai memory ID** → **View History**.

**Point out:**

- **Supersession Chain Summary** (e.g. `Pune ↓ Mumbai`, chain length, **CURRENT ACTIVE**).
- Timeline events: **Created**, **Superseded**, with timestamps and actor.

**Say:** “Audit trail and supersession graph stay intact for reviewers and downstream agents.”

---

## 5. Retrieval explanation under supersession (30 seconds)

**Tab:** Retrieval Explorer

1. Retrieve again with the same query (superseded excluded by default).

**Say:** “Only the active Mumbai fact ranks for default retrieval; turn on *Include superseded* to see penalized historical rows and why.”

---

## 6. Delete memory (30 seconds)

**Tab:** Memory Manager

1. Soft-delete the **superseded Pune** memory (optional demo cleanup).
2. Confirm filter **Deleted** — card still shows ID and lifecycle metadata.

**Say:** “Soft delete removes facts from retrieval but keeps lifecycle and supersession history.”

---

## 7. Run benchmark (30 seconds)

**Tab:** Benchmark Dashboard

1. Click **Run All Benchmarks**.
2. Point to summary cards: **Total Queries**, **Passed**, **Failed**, **Pass Rate**, **Suite Duration**.
3. Expand a failure section if any (should be all green on a clean run).

**Say:** “Ten deterministic scenarios seed fixtures, run the real engine, assert inclusions/exclusions/scores, then roll back — CI-friendly regression gate.”

---

## Closing (15 seconds)

**Say:** “Caygnus optimizes for trust: provenance, lifecycle, explicit supersession, explainable retrieval, and fixture-backed benchmarks — see `docs/FINAL_REVIEW_CHECKLIST.md` and `docs/INTERVIEW_CHEATSHEET.md` for AC mapping and architecture depth.”
