// src/routes/staff.js
// Staff dashboard routes protected by JWT authentication
const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { Branch, Service, Counter, Token, QueueEvent, Sequence } = require('../models');
const { authenticate } = require('../middleware/auth');
const {
  callNext,
  startServing,
  completeToken,
  markNoShow,
  recallToken,
  transferToken,
  setPriority
} = require('../services/queueEngine');
const { getEstimate, getServiceEstimate } = require('../services/waitTime');
const { emitQueueUpdate, emitCounterUpdate } = require('../sockets');
const { getDayKey, generatePublicId } = require('../utils/helpers');

// All staff routes require authentication
router.use(authenticate);

/**
 * GET /api/staff/queue?branchId=
 * Full queue dashboard data for operators
 */
router.get('/staff/queue', async (req, res) => {
  try {
    const branchId = req.query.branchId || req.user.branchId;
    if (!branchId) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'branchId is required' } });
    }

    const branch = await Branch.findById(branchId);
    if (!branch) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Branch not found' } });
    }

    const counters = await Counter.find({ branchId })
      .populate('serviceIds', 'name prefix')
      .populate({
        path: 'currentTokenId',
        populate: { path: 'serviceId', select: 'name prefix' }
      })
      .sort({ number: 1 });

    const waitingTokens = await Token.find({ branchId, status: 'waiting' })
      .populate('serviceId', 'name prefix emaServiceSec')
      .sort({ effectiveTime: 1 });

    const waitingWithEstimates = await Promise.all(
      waitingTokens.map(async (tok) => {
        const est = await getEstimate(tok);
        return {
          ...tok.toObject(),
          ahead: est ? est.ahead : 0,
          estimateSec: est ? est.estimateSec : null,
          range: est ? est.range : null,
          confidence: est ? est.confidence : 'Learning'
        };
      })
    );

    const noShows = await Token.find({ branchId, status: 'no_show', recallCount: { $lt: 1 } })
      .populate('serviceId', 'name prefix')
      .sort({ updatedAt: -1 })
      .limit(10);

    res.json({
      branch: { _id: branch._id, name: branch.name, type: branch.type },
      counters,
      waiting: waitingWithEstimates,
      noShows,
      totalWaiting: waitingTokens.length
    });
  } catch (error) {
    console.error('Error fetching staff queue:', error);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

/**
 * POST /api/counters/:id/status
 * Open, close, or pause (break) a counter
 */
router.post('/counters/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['open', 'closed', 'break'].includes(status)) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: "status must be 'open', 'closed', or 'break'" }
      });
    }

    const counter = await Counter.findById(id);
    if (!counter) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Counter not found' } });
    }

    counter.status = status;
    counter.statusSince = new Date();
    await counter.save();

    // Log QueueEvent
    const eventType = status === 'open' ? 'counter_opened' : status === 'break' ? 'counter_break' : 'counter_closed';
    await QueueEvent.create({
      branchId: counter.branchId,
      counterId: counter._id,
      type: eventType,
      meta: { counterName: counter.name, status }
    });

    const io = req.app.get('io');
    if (io) {
      emitCounterUpdate(io, counter.branchId, counter._id, counter.status, counter.currentTokenId);
      emitQueueUpdate(io, counter.branchId);
    }

    res.json({ success: true, counter });
  } catch (error) {
    console.error('Error updating counter status:', error);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

/**
 * POST /api/counters/:id/call-next
 * Call the next eligible token for this counter
 */
router.post('/counters/:id/call-next', async (req, res) => {
  try {
    const { id } = req.params;
    const io = req.app.get('io');

    const result = await callNext(id, req.user.id, io);
    res.json(result);
  } catch (error) {
    console.error('Error in call-next:', error);
    res.status(400).json({ error: { code: error.code || 'OPERATION_ERROR', message: error.message } });
  }
});

/**
 * POST /api/tokens/:id/start
 * Start serving a token
 */
router.post('/tokens/:id/start', async (req, res) => {
  try {
    const { id } = req.params;
    const io = req.app.get('io');

    const token = await startServing(id, io);
    res.json({ success: true, token });
  } catch (error) {
    console.error('Error in start serving:', error);
    res.status(400).json({ error: { code: 'OPERATION_ERROR', message: error.message } });
  }
});

/**
 * POST /api/tokens/:id/complete
 * Complete a token and update learned EMA
 */
router.post('/tokens/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const io = req.app.get('io');

    const result = await completeToken(id, io);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error completing token:', error);
    res.status(400).json({ error: { code: 'OPERATION_ERROR', message: error.message } });
  }
});

/**
 * POST /api/tokens/:id/no-show
 * Mark token as no-show
 */
router.post('/tokens/:id/no-show', async (req, res) => {
  try {
    const { id } = req.params;
    const io = req.app.get('io');

    const token = await markNoShow(id, io);
    res.json({ success: true, token });
  } catch (error) {
    console.error('Error marking no-show:', error);
    res.status(400).json({ error: { code: 'OPERATION_ERROR', message: error.message } });
  }
});

/**
 * POST /api/tokens/:id/recall
 * Recall a no-show token back to the queue (1-time only)
 */
router.post('/tokens/:id/recall', async (req, res) => {
  try {
    const { id } = req.params;
    const io = req.app.get('io');

    const token = await recallToken(id, io);
    res.json({ success: true, token });
  } catch (error) {
    console.error('Error recalling token:', error);
    res.status(400).json({ error: { code: 'OPERATION_ERROR', message: error.message } });
  }
});

/**
 * POST /api/tokens/:id/transfer
 * Transfer token to another service
 */
router.post('/tokens/:id/transfer', async (req, res) => {
  try {
    const { id } = req.params;
    const { serviceId } = req.body;
    const io = req.app.get('io');

    if (!serviceId) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'serviceId is required' } });
    }

    const token = await transferToken(id, serviceId, io);
    res.json({ success: true, token });
  } catch (error) {
    console.error('Error transferring token:', error);
    res.status(400).json({ error: { code: 'OPERATION_ERROR', message: error.message } });
  }
});

/**
 * POST /api/tokens/:id/priority
 * Verify or reject priority claim
 */
router.post('/tokens/:id/priority', async (req, res) => {
  try {
    const { id } = req.params;
    const { verified } = req.body;
    const io = req.app.get('io');

    if (typeof verified !== 'boolean') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'verified boolean is required' } });
    }

    const token = await setPriority(id, { verified }, io);
    res.json({ success: true, token });
  } catch (error) {
    console.error('Error setting priority:', error);
    res.status(400).json({ error: { code: 'OPERATION_ERROR', message: error.message } });
  }
});

/**
 * POST /api/tokens/walk-in
 * Create token for assisted visitor (returns printable ticket data)
 */
router.post('/tokens/walk-in', async (req, res) => {
  try {
    const {
      branchId = req.user.branchId,
      serviceId,
      priorityType = 'normal',
      customerName = 'Walk-in Visitor'
    } = req.body;

    if (!branchId || !serviceId) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'branchId and serviceId are required' }
      });
    }

    const branch = await Branch.findById(branchId);
    if (!branch) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Branch not found' } });

    const service = await Service.findById(serviceId);
    if (!service) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Service not found' } });

    const now = new Date();
    const dayKey = getDayKey(now);

    const sequenceKey = `${branchId}:${serviceId}:${dayKey}`;
    const seqDoc = await Sequence.findOneAndUpdate(
      { key: sequenceKey },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' }
    );

    const number = seqDoc.seq;
    const code = `${service.prefix}-${String(number).padStart(3, '0')}`;
    const publicId = generatePublicId();

    const bonusMinutes = (branch.settings && branch.settings.priorityBonusMinutes && branch.settings.priorityBonusMinutes[priorityType]) || 0;
    const effectiveTime = new Date(now.getTime() - bonusMinutes * 60 * 1000);

    const est = await getServiceEstimate(branchId, serviceId);

    const token = await Token.create({
      branchId,
      serviceId,
      publicId,
      number,
      code,
      dayKey,
      customerName: customerName.trim(),
      channel: 'walkin',
      isSimulated: false,
      priorityType,
      priorityVerified: priorityType === 'normal' ? null : true, // verified directly by staff
      bonusMinutes,
      effectiveTime,
      status: 'waiting',
      joinedAt: now,
      estimateAtJoinSec: est ? est.estimateSec : null
    });

    await QueueEvent.create({
      branchId,
      tokenId: token._id,
      serviceId,
      type: 'joined',
      at: now,
      meta: { code, channel: 'walkin', staffId: req.user.id }
    });

    const io = req.app.get('io');
    if (io) {
      emitQueueUpdate(io, branchId);
    }

    // Generate QR code data URL for the walk-in ticket
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const tokenUrl = `${baseUrl}/t/${publicId}`;
    const qrDataUrl = await QRCode.toDataURL(tokenUrl, { width: 180, margin: 1 });

    res.status(201).json({
      token,
      printable: {
        code: token.code,
        number: token.number,
        serviceName: service.name,
        branchName: branch.name,
        priorityType: token.priorityType,
        joinedAt: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        peopleAhead: est ? est.waitingCount : 0,
        estimatedWaitMin: est && est.estimateSec ? Math.round(est.estimateSec / 60) : 0,
        qrDataUrl,
        tokenUrl
      }
    });
  } catch (error) {
    console.error('Error creating walk-in token:', error);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

module.exports = router;
