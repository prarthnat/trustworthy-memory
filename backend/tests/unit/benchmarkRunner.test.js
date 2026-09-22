import { beforeEach, describe, expect, it } from 'vitest';
import db from '../../src/db/db.js';
import { migrate } from '../../src/db/migrate.js';
import { seedBuiltinBenchmarks, getAllBenchmarks, runOne } from '../../src/services/benchmarkRunner.js';

function resetDb() {
  migrate();
  db.prepare('DELETE FROM retrieval_log').run();
  db.prepare('DELETE FROM benchmarks').run();
  db.prepare('DELETE FROM memory_conflicts').run();
  db.prepare('DELETE FROM memory_supersessions').run();
  db.prepare('DELETE FROM memory_audit_log').run();
  db.prepare('DELETE FROM memory_tags').run();
  db.prepare('DELETE FROM memories').run();
}

describe('benchmarkRunner fixture integration', () => {
  beforeEach(resetDb);

  it('seeds 20 fixture-backed benchmark definitions', () => {
    seedBuiltinBenchmarks();
    const benchmarks = getAllBenchmarks();
    expect(benchmarks).toHaveLength(20);
    expect(benchmarks[0].input.memories).toHaveLength(30);
  });

  it('runs a fixture benchmark inside rollback and preserves expected checks', () => {
    seedBuiltinBenchmarks();
    const benchmark = getAllBenchmarks().find((item) => item.id === 'fixture-q_001');
    const result = runOne(benchmark);

    expect(result.status).toBe('pass');
    expect(db.prepare('SELECT COUNT(*) AS count FROM memories').get().count).toBe(0);
    expect(db.prepare('SELECT last_status FROM benchmarks WHERE id = ?').get(benchmark.id).last_status).toBe('pass');
  });
});
