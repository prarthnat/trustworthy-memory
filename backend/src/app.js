/**
 * app.js — Express application entry point.
 *
 * Startup sequence:
 *   1. Apply DB schema (idempotent migration).
 *   2. Seed built-in benchmarks (INSERT OR IGNORE).
 *   3. Register routes.
 *   4. Start listening.
 */

'use strict';

const express      = require('express');
const cors         = require('cors');
const { migrate }  = require('./db/migrate');
const errorHandler = require('./middleware/errorHandler');

const memoriesRouter   = require('./routes/memories');
const retrievalRouter  = require('./routes/retrieval');
const lifecycleRouter  = require('./routes/lifecycle');
const benchmarksRouter = require('./routes/benchmarks');

// ─── DB bootstrap ─────────────────────────────────────────────────────────────

migrate();

const { seedBuiltinBenchmarks } = require('./services/benchmarkRunner');
seedBuiltinBenchmarks();

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();

app.use(cors());
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/memories',   memoriesRouter);
app.use('/api/retrieve',   retrievalRouter);
app.use('/api/lifecycle',  lifecycleRouter);
app.use('/api/benchmarks', benchmarksRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', ts: Date.now() } });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.path} not found` });
});

// Global error handler (must be last)
app.use(errorHandler);

// ─── Server ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[caygnus] Backend running on http://localhost:${PORT}`);
  });
}

module.exports = app; // export for tests
