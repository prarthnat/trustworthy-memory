/**
 * memories.js — Routes for memory CRUD, correction, and supersession.
 */

'use strict';

const express = require('express');
const router  = express.Router();

const memSvc  = require('../services/memoryService');
const resolver = require('../services/correctionResolver');
const { requireFields, validateSourceType, validateConfidence } = require('../middleware/validate');

// ─── POST /api/memories ───────────────────────────────────────────────────────
// Create a new memory and automatically resolve conflicts.

router.post(
  '/',
  requireFields(['content', 'topic', 'source', 'source_type']),
  validateSourceType,
  validateConfidence,
  (req, res, next) => {
    try {
      const memory = memSvc.createMemory({
        content:     req.body.content,
        topic:       req.body.topic,
        source:      req.body.source,
        source_type: req.body.source_type,
        confidence:  req.body.confidence,
        tags:        req.body.tags || [],
        valid_from:  req.body.valid_from || null,
        valid_until: req.body.valid_until || null,
        metadata:    req.body.metadata || {},
        actor:       req.body.actor || 'api',
      });

      // Resolve conflicts after insert
      const resolution = resolver.resolveConflicts(memory, req.body.actor || 'api');

      // Re-fetch the memory in case its status changed to 'contradicted'
      const finalMemory = memSvc.getMemoryById(memory.id);

      res.status(201).json({
        success:    true,
        data:       { memory: finalMemory, resolution },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/memories ────────────────────────────────────────────────────────

router.get('/', (req, res, next) => {
  try {
    const memories = memSvc.listMemories({
      status:      req.query.status,
      topic:       req.query.topic,
      source_type: req.query.source_type,
      tag:         req.query.tag,
      limit:       parseInt(req.query.limit) || 100,
      offset:      parseInt(req.query.offset) || 0,
    });
    res.json({ success: true, data: memories });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/memories/:id ────────────────────────────────────────────────────

router.get('/:id', (req, res, next) => {
  try {
    const memory = memSvc.getMemoryById(req.params.id);
    if (!memory) return res.status(404).json({ success: false, error: 'Memory not found' });
    res.json({ success: true, data: memory });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/memories/:id ──────────────────────────────────────────────────

router.patch('/:id', validateConfidence, (req, res, next) => {
  try {
    const updated = memSvc.updateMemory({
      id:      req.params.id,
      updates: req.body,
      actor:   req.body.actor || 'api',
    });
    if (!updated) return res.status(404).json({ success: false, error: 'Memory not found' });
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err.message.includes('deleted')) return res.status(409).json({ success: false, error: err.message });
    next(err);
  }
});

// ─── DELETE /api/memories/:id ─────────────────────────────────────────────────

router.delete('/:id', (req, res, next) => {
  try {
    const deleted = memSvc.deleteMemory({
      id:    req.params.id,
      actor: req.body?.actor || req.query.actor || 'api',
    });
    if (!deleted) return res.status(404).json({ success: false, error: 'Memory not found' });
    res.json({ success: true, data: deleted });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/memories/:id/restore ──────────────────────────────────────────

router.post('/:id/restore', (req, res, next) => {
  try {
    const restored = memSvc.restoreMemory({
      id:    req.params.id,
      actor: req.body?.actor || 'api',
    });
    if (!restored) return res.status(404).json({ success: false, error: 'Memory not found' });
    res.json({ success: true, data: restored });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/memories/:id/supersede ────────────────────────────────────────
// Manually supersede a memory with an existing one.

router.post('/:id/supersede', requireFields(['new_memory_id', 'reason']), (req, res, next) => {
  try {
    const result = resolver.manualSupersede(
      req.params.id,
      req.body.new_memory_id,
      req.body.reason,
      req.body.actor || 'api'
    );
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.message.includes('not found')) return res.status(404).json({ success: false, error: err.message });
    next(err);
  }
});

// ─── GET /api/memories/:id/supersessions ─────────────────────────────────────

router.get('/:id/supersessions', (req, res, next) => {
  try {
    const chain = resolver.getSupersessionChain(req.params.id);
    res.json({ success: true, data: chain });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
