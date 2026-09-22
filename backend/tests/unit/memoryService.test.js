import { beforeEach, describe, expect, it } from 'vitest';
import db from '../../src/db/db.js';
import {
  createMemory,
  deleteMemory,
  getConflicts,
  getMemoryById,
  recordAmbiguousConflict,
  restoreMemory,
} from '../../src/services/memoryService.js';
import { manualSupersede } from '../../src/services/reconciliationService.js';
import { migrate } from '../../src/db/migrate.js';

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

describe('memoryService lifecycle and provenance', () => {
  beforeEach(resetDb);

  it('stores memory content, provenance, tags, and created audit event', () => {
    const memory = createMemory({
      id: 'mem-test-001',
      content: 'I prefer dark mode',
      topic: 'user.preference.ui.theme',
      source: 'settings',
      source_type: 'user',
      confidence: 1,
      tags: ['UI', 'Theme'],
      actor: 'test',
      created_at: 1726272000000,
    });

    expect(memory.id).toBe('mem-test-001');
    expect(memory.topic).toBe('user.preference.ui.theme');
    expect(memory.source).toBe('settings');
    expect(memory.source_type).toBe('user');
    expect(memory.tags).toEqual(['theme', 'ui']);

    const audit = db.prepare('SELECT * FROM memory_audit_log WHERE memory_id = ?').all(memory.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].event_type).toBe('created');
  });

  it('soft deletes active memory and excludes restore only when no active successor exists', () => {
    const oldMemory = createMemory({
      id: 'mem-test-002',
      content: 'I live in Pune',
      topic: 'user.location.home_city',
      source: 'chat',
      source_type: 'user',
      tags: ['location'],
    });
    const newMemory = createMemory({
      id: 'mem-test-003',
      content: 'I moved to Mumbai',
      topic: 'user.location.home_city',
      source: 'chat',
      source_type: 'user',
      tags: ['location'],
    });

    manualSupersede(oldMemory.id, newMemory.id, 'User moved cities', 'test');
    const deleted = deleteMemory({ id: oldMemory.id, actor: 'test' });

    expect(deleted.status).toBe('deleted');
    expect(getMemoryById(newMemory.id).status).toBe('active');
    expect(() => restoreMemory({ id: oldMemory.id, actor: 'test' })).toThrow(/active successor/);
  });

  it('records ambiguous conflicts without changing lifecycle state', () => {
    const favorite = createMemory({
      id: 'mem-test-004',
      content: 'My favorite language is JavaScript',
      topic: 'user.preference.language.favorite',
      source: 'chat',
      source_type: 'user',
      tags: ['language', 'javascript'],
    });
    const recent = createMemory({
      id: 'mem-test-005',
      content: 'I have been enjoying Python recently',
      topic: 'user.preference.language.recent_interest',
      source: 'chat',
      source_type: 'user',
      tags: ['language', 'python'],
    });

    recordAmbiguousConflict({
      memoryId: favorite.id,
      relatedMemoryId: recent.id,
      reason: 'Recent enjoyment is not replacement of favorite language.',
      actor: 'test',
    });

    expect(getMemoryById(favorite.id).status).toBe('active');
    expect(getMemoryById(recent.id).status).toBe('active');
    expect(getConflicts(favorite.id)[0].related_memory_id).toBe(recent.id);
  });
});
