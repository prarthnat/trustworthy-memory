/**
 * validate.js — Request validation middleware.
 * Returns 400 with a descriptive error for missing required fields.
 */

'use strict';

function requireFields(fields) {
  return (req, res, next) => {
    const missing = fields.filter((f) => req.body[f] === undefined || req.body[f] === null || req.body[f] === '');
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${missing.join(', ')}`,
      });
    }
    next();
  };
}

function validateSourceType(req, res, next) {
  const valid = ['user', 'system', 'inferred'];
  if (req.body.source_type && !valid.includes(req.body.source_type)) {
    return res.status(400).json({
      success: false,
      error: `source_type must be one of: ${valid.join(', ')}`,
    });
  }
  next();
}

function validateConfidence(req, res, next) {
  const c = req.body.confidence;
  if (c !== undefined && (typeof c !== 'number' || c < 0 || c > 1)) {
    return res.status(400).json({
      success: false,
      error: 'confidence must be a number between 0.0 and 1.0',
    });
  }
  next();
}

module.exports = { requireFields, validateSourceType, validateConfidence };
