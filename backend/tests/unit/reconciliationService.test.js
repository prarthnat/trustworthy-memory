import { beforeEach, describe, expect, it } from 'vitest';
import db from '../../src/db/db.js';
import { migrate } from '../../src/db/migrate.js';
import { createMemory, getMemoryById } from '../../src/services/memoryService.js';
import { reconcileMemory, getSupersessionChain } from '../../src/services/reconciliationService.js';

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

describe('reconciliationService', () => {
  beforeEach(resetDb);

  it('creates a supersession edge for Pune -> Mumbai -> Pune', () => {
    const pune1 = createMemory({
      id: 'mem-chain-001',
      content: 'I live in Pune',
      topic: 'user.location.home_city',
      source: 'chat',
      source_type: 'user',
      tags: ['location', 'home_city', 'pune'],
      created_at: 1,
    });
    const mumbai = createMemory({
      id: 'mem-chain-002',
      content: 'I moved to Mumbai',
      topic: 'user.location.home_city',
      source: 'chat',
      source_type: 'user',
      tags: ['location', 'home_city', 'mumbai'],
      created_at: 2,
    });
    reconcileMemory(mumbai, 'test');

    const pune2 = createMemory({
      id: 'mem-chain-003',
      content: 'I moved back to Pune',
      topic: 'user.location.home_city',
      source: 'chat',
      source_type: 'user',
      tags: ['location', 'home_city', 'pune'],
      created_at: 3,
    });
    reconcileMemory(pune2, 'test');

    expect(getMemoryById(pune1.id).status).toBe('superseded');
    expect(getMemoryById(mumbai.id).status).toBe('superseded');
    expect(getMemoryById(pune2.id).status).toBe('active');

    expect(getSupersessionChain(mumbai.id).supersedes[0].old_memory_id).toBe(pune1.id);
    expect(getSupersessionChain(mumbai.id).superseded_by[0].new_memory_id).toBe(pune2.id);
  });

  it('does not supersede ambiguous language conflict', () => {
    const favorite = createMemory({
      id: 'mem-amb-001',
      content: 'My favorite programming language is JavaScript',
      topic: 'user.preference.language.favorite',
      source: 'chat',
      source_type: 'user',
      tags: ['language', 'javascript'],
    });
    const python = createMemory({
      id: 'mem-amb-002',
      content: 'I have been enjoying Python recently',
      topic: 'user.preference.language.recent_interest',
      source: 'chat',
      source_type: 'user',
      tags: ['language', 'python'],
    });

    const result = reconcileMemory(python, 'test');
    expect(result.decisions[0].action).toBe('annotate_conflict');
    expect(getMemoryById(favorite.id).status).toBe('active');
    expect(getMemoryById(python.id).status).toBe('active');
    expect(db.prepare('SELECT COUNT(*) AS count FROM memory_supersessions').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM memory_conflicts').get().count).toBe(2);
  });
});
