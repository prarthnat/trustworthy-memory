import { beforeEach, describe, expect, it } from 'vitest';
import db from '../../src/db/db.js';
import { migrate } from '../../src/db/migrate.js';
import { createMemory } from '../../src/services/memoryService.js';
import { manualSupersede } from '../../src/services/reconciliationService.js';
import { retrieve } from '../../src/services/retrievalEngine.js';

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

describe('retrievalService deterministic behavior', () => {
  beforeEach(resetDb);

  it('returns retrieval evidence for active memories', () => {
    createMemory({
      id: 'mem-ret-001',
      content: 'I moved back to Pune',
      topic: 'user.location.home_city',
      source: 'chat',
      source_type: 'user',
      tags: ['location', 'home_city', 'pune'],
      created_at: 1725321600000,
      updated_at: 1725321600000,
    });

    const result = retrieve({
      query: 'Where does the user live in Pune?',
      topic: 'user.location.home_city',
      tags: ['location'],
      now: 1727740800000,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].memoryId).toBe('mem-ret-001');
    expect(result.results[0].score).toBeGreaterThan(0);
    expect(result.results[0].matched_fields).toEqual(expect.arrayContaining(['topic', 'content', 'tags']));
    expect(result.results[0].evidence).toEqual(expect.arrayContaining(['topic_match', 'keyword_match', 'status_active']));
    expect(result.results[0].retrieval_evidence).toHaveProperty('scorer_version', 'deterministic-v2');
  });

  it('excludes superseded by default and includes it with penalty when requested', () => {
    const oldMemory = createMemory({
      id: 'mem-ret-002',
      content: 'I live in Pune',
      topic: 'user.location.home_city',
      source: 'chat',
      source_type: 'user',
      tags: ['location', 'pune'],
      created_at: 1,
    });
    const newMemory = createMemory({
      id: 'mem-ret-003',
      content: 'I moved to Mumbai',
      topic: 'user.location.home_city',
      source: 'chat',
      source_type: 'user',
      tags: ['location', 'mumbai'],
      created_at: 2,
    });
    manualSupersede(oldMemory.id, newMemory.id, 'User moved cities', 'test');

    const defaultResult = retrieve({ query: 'user home city', topic: 'user.location.home_city' });
    expect(defaultResult.results.map((r) => r.memory_id)).toEqual(['mem-ret-003']);

    const historyResult = retrieve({
      query: 'user home city',
      topic: 'user.location.home_city',
      include_superseded: true,
    });
    expect(historyResult.results.map((r) => r.memory_id)).toEqual(['mem-ret-003', 'mem-ret-002']);
    expect(historyResult.results[1].retrieval_evidence.status.penalty).toBe(0.5);
  });
});
