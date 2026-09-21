/**
 * errorHandler.js — Global Express error handler.
 * Normalises all unhandled errors to { success: false, error: string }.
 */

'use strict';

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[ERROR]', err.message || err);

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    error:   err.message || 'Internal server error',
  });
}

module.exports = errorHandler;
