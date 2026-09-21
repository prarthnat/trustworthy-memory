/**
 * benchmarkRunner.js — Deterministic benchmark harness.
 *
 * Each benchmark:
 *   1. Opens a savepoint (nested transaction).
 *   2. Seeds the DB with fixture memories (deterministic UUIDs).
 *   3. Runs the retrieval query through the real engine.
 *   4. Compares output to expected spec.
 *   5. Rolls back — DB is left pristine.
 *
 * Using SQLite savepoints (not just BEGIN/ROLLBACK) allows benchmarks
 * to be run even while inside an outer transaction (e.g., in tests).
 */

'use strict';

const db = require('../db/db');
const { retrieve } = require('./retrievalEngine');
const { createMemory } = require('./memoryService');
const { migrate } = require('../db/migrate');

// ─── Load benchmark definitions ───────────────────────────────────────────────

function getAllBenchmarks() {
  return db.prepare('SELECT * FROM benchmarks ORDER BY id ASC').all().map(parseBenchmark);
}

function getBenchmarkById(id) {
  const row = db.prepare('SELECT * FROM benchmarks WHERE id = ?').get(id);
  return row ? parseBenchmark(row) : null;
}

function parseBenchmark(row) {
  return {
    ...row,
    input:       JSON.parse(row.input),
    expected:    JSON.parse(row.expected),
    last_output: row.last_output ? JSON.parse(row.last_output) : null,
  };
}

// ─── Comparison helpers ───────────────────────────────────────────────────────

/**
 * Compare actual retrieval results against expected spec.
 *
 * Expected spec shape:
 * {
 *   results: [{ memory_id, score_gte?, score_lte?, position? }],
 *   excluded: ['id1', 'id2']  // must NOT appear in results
 * }
 */
function compare(actual, expected) {
  const failures = [];
  const actualIds = actual.results.map((r) => r.memory_id);

  // Check required results
  for (const req of (expected.results || [])) {
    const found = actual.results.find((r) => r.memory_id === req.memory_id);
    if (!found) {
      failures.push(`Expected memory "${req.memory_id}" in results but not found.`);
      continue;
    }
    if (req.score_gte !== undefined && found.score < req.score_gte) {
      failures.push(
        `Memory "${req.memory_id}" score ${found.score} < expected minimum ${req.score_gte}.`
      );
    }
    if (req.score_lte !== undefined && found.score > req.score_lte) {
      failures.push(
        `Memory "${req.memory_id}" score ${found.score} > expected maximum ${req.score_lte}.`
      );
    }
    if (req.position !== undefined) {
      const pos = actualIds.indexOf(req.memory_id);
      if (pos !== req.position) {
        failures.push(
          `Memory "${req.memory_id}" at position ${pos}, expected position ${req.position}.`
        );
      }
    }
    if (req.status !== undefined && found.status !== req.status) {
      failures.push(
        `Memory "${req.memory_id}" status "${found.status}", expected "${req.status}".`
      );
    }
  }

  // Check excluded results
  for (const exId of (expected.excluded || [])) {
    if (actualIds.includes(exId)) {
      failures.push(`Memory "${exId}" should NOT appear in results but was returned.`);
    }
  }

  // Check ordering (if expected has multiple results with explicit positions, ordering is verified above)

  return failures;
}

// ─── Seed helper ─────────────────────────────────────────────────────────────

function seedMemories(memories) {
  for (const mem of memories) {
    // Insert directly (bypass conflict resolution for benchmark seeding)
    const ts = mem.created_at || (Date.now() - (mem._age_days || 0) * 86400000);

    db.prepare(
      `INSERT OR REPLACE INTO memories
       (id, content, topic, source, source_type, confidence, status,
        created_at, updated_at, valid_from, valid_until, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      mem.id,
      mem.content,
      mem.topic || 'general',
      mem.source || 'benchmark',
      mem.source_type || 'system',
      mem.confidence !== undefined ? mem.confidence : 1.0,
      mem.status || 'active',
      ts,
      ts,
      mem.valid_from || null,
      mem.valid_until || null,
      JSON.stringify(mem.metadata || {})
    );

    // Tags
    if (mem.tags && mem.tags.length) {
      const insertTag = db.prepare(
        'INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)'
      );
      for (const tag of mem.tags) {
        insertTag.run(mem.id, tag.toLowerCase());
      }
    }

    // Audit log entry for created
    const { v4: uuidv4 } = require('uuid');
    db.prepare(
      `INSERT INTO memory_audit_log
       (id, memory_id, event_type, new_value, actor, event_at)
       VALUES (?, ?, 'created', ?, 'benchmark', ?)`
    ).run(uuidv4(), mem.id, JSON.stringify({ content: mem.content }), ts);

    // Supersessions
    if (mem._superseded_by) {
      // Will be linked after all memories seeded
    }
  }

  // Handle supersession links
  for (const mem of memories) {
    if (mem._superseded_by) {
      const { v4: uuidv4 } = require('uuid');
      db.prepare(
        `INSERT OR IGNORE INTO memory_supersessions
         (id, old_memory_id, new_memory_id, reason, superseded_at, superseded_by)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        uuidv4(),
        mem.id,
        mem._superseded_by,
        mem._supersession_reason || 'benchmark fixture',
        Date.now(),
        'benchmark'
      );
    }
  }
}

// ─── Run a single benchmark ───────────────────────────────────────────────────

function runOne(benchmark) {
  const { id, input, expected } = benchmark;
  const startTs = Date.now();
  let status = 'pass';
  let failures = [];
  let actual = null;

  // Use a savepoint so we can rollback after the benchmark
  db.prepare('SAVEPOINT bm_run').run();

  try {
    // Seed fixture memories
    seedMemories(input.memories || []);

    // Run retrieval
    actual = retrieve(input.query);

    // Compare
    failures = compare(actual, expected);
    status = failures.length === 0 ? 'pass' : 'fail';
  } catch (err) {
    status = 'error';
    failures = [err.message];
  } finally {
    // Always rollback — benchmarks must never dirty the real DB
    db.prepare('ROLLBACK TO SAVEPOINT bm_run').run();
    db.prepare('RELEASE SAVEPOINT bm_run').run();
  }

  const output = {
    status,
    failures,
    actual_results: actual ? actual.results.map((r) => ({
      memory_id: r.memory_id,
      score:     r.score,
      status:    r.status,
    })) : [],
    duration_ms: Date.now() - startTs,
  };

  // Persist last run result (outside the savepoint — so it survives)
  db.prepare(
    `UPDATE benchmarks
     SET last_run_at = ?, last_status = ?, last_output = ?
     WHERE id = ?`
  ).run(Date.now(), status, JSON.stringify(output), id);

  return { id, name: benchmark.name, ...output };
}

// ─── Run all benchmarks ───────────────────────────────────────────────────────

function runAll() {
  const all = getAllBenchmarks();
  if (all.length === 0) {
    return { total: 0, passed: 0, failed: 0, results: [] };
  }

  const results = all.map(runOne);
  const passed  = results.filter((r) => r.status === 'pass').length;
  const failed  = results.length - passed;

  return { total: results.length, passed, failed, results };
}

// ─── Seed built-in benchmark definitions on first run ────────────────────────

function seedBuiltinBenchmarks() {
  const builtins = require('../../tests/benchmarks/deterministicSuite');
  const insert = db.prepare(
    `INSERT OR IGNORE INTO benchmarks (id, name, description, input, expected)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const b of builtins) {
    insert.run(b.id, b.name, b.description || '', JSON.stringify(b.input), JSON.stringify(b.expected));
  }
}

module.exports = {
  getAllBenchmarks,
  getBenchmarkById,
  runOne,
  runAll,
  seedBuiltinBenchmarks,
};
