/**
 * lifecycle.js — Routes for memory audit trail queries.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const svc     = require('../services/lifecycleService');

// ─── GET /api/lifecycle/recent ────────────────────────────────────────────────

router.get('/recent', (req, res, next) => {
  try {
    const events = svc.getRecentEvents({
      limit:     parseInt(req.query.limit) || 50,
      eventType: req.query.event_type,
    });
    res.json({ success: true, data: events });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/lifecycle/:id ───────────────────────────────────────────────────

router.get('/:id', (req, res, next) => {
  try {
    const trail = svc.getLifecycle(req.params.id);
    if (!trail) return res.status(404).json({ success: false, error: 'Memory not found' });
    res.json({ success: true, data: trail });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
