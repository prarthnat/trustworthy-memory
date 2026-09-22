-- =============================================================
-- Caygnus — Trustworthy Long-Term Memory
-- Canonical DDL — applied idempotently via migrate.js
-- =============================================================

-- Core memory store
CREATE TABLE IF NOT EXISTS memories (
  id            TEXT PRIMARY KEY,
  content       TEXT NOT NULL,
  topic         TEXT NOT NULL,
  source        TEXT NOT NULL,
  source_type   TEXT NOT NULL CHECK(source_type IN ('user','system','inferred')),
  confidence    REAL NOT NULL DEFAULT 1.0 CHECK(confidence >= 0.0 AND confidence <= 1.0),
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK(status IN ('active','superseded','deleted')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  valid_from    INTEGER,
  valid_until   INTEGER,
  metadata      TEXT DEFAULT '{}'
);

-- Directed supersession graph (old → new)
CREATE TABLE IF NOT EXISTS memory_supersessions (
  id              TEXT PRIMARY KEY,
  old_memory_id   TEXT NOT NULL REFERENCES memories(id),
  new_memory_id   TEXT NOT NULL REFERENCES memories(id),
  reason          TEXT NOT NULL,
  superseded_at   INTEGER NOT NULL,
  superseded_by   TEXT NOT NULL,
  CHECK(old_memory_id != new_memory_id),
  UNIQUE(old_memory_id, new_memory_id)
);

-- Ambiguous conflicts are annotations, not lifecycle states.
CREATE TABLE IF NOT EXISTS memory_conflicts (
  id                 TEXT PRIMARY KEY,
  memory_id          TEXT NOT NULL REFERENCES memories(id),
  related_memory_id  TEXT NOT NULL REFERENCES memories(id),
  conflict_type      TEXT NOT NULL CHECK(conflict_type IN ('ambiguous')),
  reason             TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  resolved_at        INTEGER,
  CHECK(memory_id != related_memory_id),
  UNIQUE(memory_id, related_memory_id, conflict_type)
);

-- Normalised many-to-many tags
CREATE TABLE IF NOT EXISTS memory_tags (
  memory_id  TEXT NOT NULL REFERENCES memories(id),
  tag        TEXT NOT NULL,
  PRIMARY KEY (memory_id, tag)
);

-- Append-only audit log — never updated or deleted
CREATE TABLE IF NOT EXISTS memory_audit_log (
  id          TEXT PRIMARY KEY,
  memory_id   TEXT NOT NULL REFERENCES memories(id),
  event_type  TEXT NOT NULL
                CHECK(event_type IN (
                  'created','updated','superseded','deleted',
                  'contradiction_flagged','restored'
                )),
  old_value   TEXT,
  new_value   TEXT,
  actor       TEXT NOT NULL,
  event_at    INTEGER NOT NULL,
  notes       TEXT
);

-- Retrieval log — every query + ranked result set stored
CREATE TABLE IF NOT EXISTS retrieval_log (
  id           TEXT PRIMARY KEY,
  query        TEXT NOT NULL,
  filters      TEXT DEFAULT '{}',
  results      TEXT NOT NULL DEFAULT '[]',
  retrieved_at INTEGER NOT NULL,
  context      TEXT,
  scorer       TEXT DEFAULT '{}'
);

-- Benchmark definitions and last-run results
CREATE TABLE IF NOT EXISTS benchmarks (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  input        TEXT NOT NULL,
  expected     TEXT NOT NULL,
  last_run_at  INTEGER,
  last_status  TEXT CHECK(last_status IN ('pass','fail','error') OR last_status IS NULL),
  last_output  TEXT
);

-- =============================================================
-- Indexes
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_memories_status   ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_topic    ON memories(topic, status);
CREATE INDEX IF NOT EXISTS idx_memories_validity ON memories(valid_until) WHERE valid_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_memory      ON memory_audit_log(memory_id, event_at);
CREATE INDEX IF NOT EXISTS idx_retrieval_at      ON retrieval_log(retrieved_at);
CREATE INDEX IF NOT EXISTS idx_tags_tag          ON memory_tags(tag, memory_id);
CREATE INDEX IF NOT EXISTS idx_supersessions_old ON memory_supersessions(old_memory_id);
CREATE INDEX IF NOT EXISTS idx_supersessions_new ON memory_supersessions(new_memory_id);
CREATE INDEX IF NOT EXISTS idx_conflicts_memory  ON memory_conflicts(memory_id, created_at);
