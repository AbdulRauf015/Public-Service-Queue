// src/routes/analytics.js
// Analytics API endpoints for Admin and Staff
const express = require('express');
const router = express.Router();
const { Branch } = require('../models');
const {
  getSummary,
  getHourly,
  getCounterPerformance
} = require('../services/analytics');

/**
 * Helper to resolve branchId from query or fallback to demo branch
 */
async function resolveBranchId(req) {
  let branchId = req.query.branchId;
  if (!branchId || branchId === 'demo') {
    const demo = (await Branch.findOne({ isDemo: true })) || (await Branch.findOne());
    if (demo) branchId = demo._id.toString();
  }
  return branchId;
}

/**
 * Helper to parse includeSimulated param (defaults to true for demo)
 */
function parseIncludeSim(req) {
  if (req.query.includeSimulated === 'false' || req.query.includeSimulated === '0') {
    return false;
  }
  return true;
}

/**
 * GET /api/analytics/summary
 * Query: branchId, range (today | 7days), includeSimulated (true | false)
 */
router.get('/summary', async (req, res) => {
  try {
    const branchId = await resolveBranchId(req);
    if (!branchId) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'branchId is required' } });
    }

    const range = req.query.range || 'today';
    const includeSimulated = parseIncludeSim(req);
    const dayKey = req.query.dayKey;

    const summary = await getSummary(branchId, { range, includeSimulated, dayKey });
    res.json(summary);
  } catch (err) {
    console.error('Error in /api/analytics/summary:', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

/**
 * GET /api/analytics/hourly
 * Query: branchId, range (today | 7days), includeSimulated (true | false)
 */
router.get('/hourly', async (req, res) => {
  try {
    const branchId = await resolveBranchId(req);
    if (!branchId) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'branchId is required' } });
    }

    const range = req.query.range || 'today';
    const includeSimulated = parseIncludeSim(req);
    const dayKey = req.query.dayKey;

    const hourly = await getHourly(branchId, { range, includeSimulated, dayKey });
    res.json(hourly);
  } catch (err) {
    console.error('Error in /api/analytics/hourly:', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

/**
 * GET /api/analytics/counters
 * Query: branchId, range (today | 7days), includeSimulated (true | false)
 */
router.get('/counters', async (req, res) => {
  try {
    const branchId = await resolveBranchId(req);
    if (!branchId) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'branchId is required' } });
    }

    const range = req.query.range || 'today';
    const includeSimulated = parseIncludeSim(req);
    const dayKey = req.query.dayKey;

    const performance = await getCounterPerformance(branchId, { range, includeSimulated, dayKey });
    res.json(performance);
  } catch (err) {
    console.error('Error in /api/analytics/counters:', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

module.exports = router;
