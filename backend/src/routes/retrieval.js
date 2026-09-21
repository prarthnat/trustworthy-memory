/**
 * retrieval.js — Routes for deterministic memory retrieval.
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const engine   = require('../services/retrievalEngine');

// ─── POST /api/retrieve ───────────────────────────────────────────────────────

router.post('/', (req, res, next) => {
  try {
    const result = engine.retrieve({
      query:              req.body.query || '',
      topic:              req.body.topic,
      tags:               req.body.tags || [],
      source_type:        req.body.source_type,
      include_superseded: req.body.include_superseded === true,
      limit:              parseInt(req.body.limit) || 10,
      context:            req.body.context,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/retrieve/log ────────────────────────────────────────────────────

router.get('/log', (req, res, next) => {
  try {
    const logs = engine.listRetrievalLogs({
      limit:  parseInt(req.query.limit) || 20,
      offset: parseInt(req.query.offset) || 0,
    });
    res.json({ success: true, data: logs });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/retrieve/log/:id ────────────────────────────────────────────────

router.get('/log/:id', (req, res, next) => {
  try {
    const log = engine.getRetrievalLog(req.params.id);
    if (!log) return res.status(404).json({ success: false, error: 'Retrieval log not found' });
    res.json({ success: true, data: log });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
