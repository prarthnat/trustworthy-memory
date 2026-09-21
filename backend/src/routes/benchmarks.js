/**
 * benchmarks.js — Routes for running deterministic benchmark tests.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const runner  = require('../services/benchmarkRunner');

// ─── GET /api/benchmarks ──────────────────────────────────────────────────────

router.get('/', (req, res, next) => {
  try {
    const all = runner.getAllBenchmarks();
    res.json({ success: true, data: all });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/benchmarks/run ─────────────────────────────────────────────────

router.post('/run', (req, res, next) => {
  try {
    const report = runner.runAll();
    const status = report.failed > 0 ? 207 : 200; // 207 Multi-Status on partial failure
    res.status(status).json({ success: report.failed === 0, data: report });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/benchmarks/run/:id ────────────────────────────────────────────

router.post('/run/:id', (req, res, next) => {
  try {
    const benchmark = runner.getBenchmarkById(req.params.id);
    if (!benchmark) return res.status(404).json({ success: false, error: 'Benchmark not found' });

    const result = runner.runOne(benchmark);
    const status = result.status === 'pass' ? 200 : 207;
    res.status(status).json({ success: result.status === 'pass', data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
