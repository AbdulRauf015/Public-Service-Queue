// src/routes/sim.js
// Simulation Lab and What-If endpoints (TRD sections 4.4, 6.3, 7)
const express = require('express');
const router = express.Router();
const { Branch } = require('../models');
const simulator = require('../services/simulator');

// Helper to resolve branchId
async function resolveBranchId(req) {
  let bId = (req.body && req.body.branchId) || (req.query && req.query.branchId);
  if (!bId || bId === 'demo') {
    const b = (await Branch.findOne({ isDemo: true })) || (await Branch.findOne());
    if (b) bId = b._id;
  }
  return bId;
}

/**
 * POST /api/sim/rush
 * Inject count simulated tokens
 */
router.post('/rush', async (req, res) => {
  try {
    const branchId = await resolveBranchId(req);
    const { count = 20, serviceId = null } = req.body;
    const io = req.app.get('io');

    const result = await simulator.addRush(branchId, count, serviceId, io);
    res.json(result);
  } catch (err) {
    console.error('Error in /api/sim/rush:', err);
    res.status(500).json({ error: { code: 'SIM_ERROR', message: err.message } });
  }
});

/**
 * POST /api/sim/start
 * Start steady arrival stream
 */
router.post('/start', async (req, res) => {
  try {
    const branchId = await resolveBranchId(req);
    const { arrivalsPerMin = 4, serviceId = null } = req.body;
    const io = req.app.get('io');

    const result = simulator.startSteadyArrivals(branchId, arrivalsPerMin, serviceId, io);
    res.json(result);
  } catch (err) {
    console.error('Error in /api/sim/start:', err);
    res.status(500).json({ error: { code: 'SIM_ERROR', message: err.message } });
  }
});

/**
 * POST /api/sim/stop
 * Stop steady arrivals
 */
router.post('/stop', async (req, res) => {
  try {
    const branchId = await resolveBranchId(req);
    const io = req.app.get('io');

    const result = simulator.stopSteadyArrivals(branchId, io);
    res.json(result);
  } catch (err) {
    console.error('Error in /api/sim/stop:', err);
    res.status(500).json({ error: { code: 'SIM_ERROR', message: err.message } });
  }
});

/**
 * POST /api/sim/autoserve
 * Toggle auto-serve at counters
 */
router.post('/autoserve', async (req, res) => {
  try {
    const branchId = await resolveBranchId(req);
    const { enabled = null } = req.body;
    const io = req.app.get('io');

    const result = simulator.toggleAutoServe(branchId, enabled, io);
    res.json(result);
  } catch (err) {
    console.error('Error in /api/sim/autoserve:', err);
    res.status(500).json({ error: { code: 'SIM_ERROR', message: err.message } });
  }
});

/**
 * POST /api/sim/reset
 * Reset demo data: remove simulated tokens and restore initial counter states
 */
router.post('/reset', async (req, res) => {
  try {
    const branchId = await resolveBranchId(req);
    const io = req.app.get('io');

    const result = await simulator.resetDemo(branchId, io);
    res.json(result);
  } catch (err) {
    console.error('Error in /api/sim/reset:', err);
    res.status(500).json({ error: { code: 'SIM_ERROR', message: err.message } });
  }
});

/**
 * GET /api/sim/whatif
 * What-If estimate: deltaCounters (+1) for longest-waiting or specified service
 */
router.get('/whatif', async (req, res) => {
  try {
    const branchId = await resolveBranchId(req);
    const { serviceId = null, counters = 1 } = req.query;

    const delta = parseInt(counters, 10) || 1;
    const result = await simulator.getWhatIf(branchId, serviceId, delta);
    res.json(result);
  } catch (err) {
    console.error('Error in /api/sim/whatif:', err);
    res.status(500).json({ error: { code: 'SIM_ERROR', message: err.message } });
  }
});

/**
 * GET /api/sim/status
 * Return current simulation state
 */
router.get('/status', (req, res) => {
  res.json(simulator.getSimState());
});

module.exports = router;
