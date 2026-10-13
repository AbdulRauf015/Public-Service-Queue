// src/routes/public.js
// Public routes accessible without authentication
const express = require('express');
const router = express.Router();
const { Branch, Service, Counter, Token, QueueEvent, Sequence } = require('../models');
const { getDayKey, generatePublicId } = require('../utils/helpers');
const { getEstimate, getServiceEstimate } = require('../services/waitTime');
const { emitQueueUpdate } = require('../sockets');

/**
 * Helper to determine busy level from waiting token count
 */
function calculateBusyLevel(totalWaiting) {
  if (totalWaiting <= 5) return { label: 'Quiet', level: 1 };
  if (totalWaiting <= 12) return { label: 'Moderate', level: 2 };
  if (totalWaiting <= 25) return { label: 'Busy', level: 3 };
  return { label: 'Very busy', level: 4 };
}

const QRCode = require('qrcode');

/**
 * GET /api/branches/demo
 * Returns the demo branch ID
 */
router.get('/branches/demo', async (req, res) => {
  try {
    const branch = await Branch.findOne({ isDemo: true });
    if (!branch) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Demo branch not found' } });
    res.json({ branchId: branch._id });
  } catch (err) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

/**
 * GET /api/display/:branchId
 * Returns full live data for TV Display Board (Now Serving, Next 5, Average Wait, Join QR)
 * TRD 6.1 specification
 */
async function getDisplayDataHandler(req, res) {
  try {
    let { branchId } = req.params;
    let branch = null;
    if (branchId === 'demo') {
      branch = (await Branch.findOne({ isDemo: true })) || (await Branch.findOne());
    } else {
      branch = await Branch.findById(branchId);
    }
    if (!branch) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Branch not found' } });
    }

    branchId = branch._id;

    // 1. Now Serving counters
    const counters = await Counter.find({ branchId, status: { $in: ['open', 'break'] } })
      .populate({
        path: 'currentTokenId',
        select: 'code number status priorityType serviceId calledAt servingStartedAt'
      })
      .sort({ number: 1 });

    const nowServing = counters
      .filter(c => c.currentTokenId && ['called', 'serving'].includes(c.currentTokenId.status))
      .map(c => ({
        counterId: c._id,
        counterNumber: c.number,
        counterName: c.name,
        tokenCode: c.currentTokenId.code,
        status: c.currentTokenId.status
      }));

    // 2. Next five waiting tokens
    const nextWaiting = await Token.find({ branchId, status: 'waiting' })
      .select('code number serviceId priorityType effectiveTime')
      .populate('serviceId', 'name prefix')
      .sort({ effectiveTime: 1 })
      .limit(5);

    // 3. Average wait estimate
    const services = await Service.find({ branchId, isActive: true });
    let totalEstSec = 0;
    let activeSvcCount = 0;
    for (const s of services) {
      const est = await getServiceEstimate(branchId, s._id);
      if (est && est.estimateSec) {
        totalEstSec += est.estimateSec;
        activeSvcCount++;
      }
    }
    const avgWaitMin = activeSvcCount > 0 ? Math.round((totalEstSec / activeSvcCount) / 60) : 11;

    // 4. Generate Join QR code
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const joinUrl = `${baseUrl}/q/${branchId}`;
    const qrDataUrl = await QRCode.toDataURL(joinUrl, { width: 180, margin: 1 });

    res.json({
      branch: { _id: branch._id, name: branch.name, type: branch.type },
      nowServing,
      nextWaiting: nextWaiting.map(t => ({
        _id: t._id,
        code: t.code,
        serviceName: t.serviceId ? t.serviceId.name : '',
        prefix: t.serviceId ? t.serviceId.prefix : ''
      })),
      avgWaitMin,
      qrDataUrl,
      joinUrl
    });
  } catch (err) {
    console.error('Error fetching display data:', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
  }
}

router.get('/display/:branchId', getDisplayDataHandler);
router.get('/branches/:branchId/display', getDisplayDataHandler);

/**
 * GET /api/branches/:branchId/qr.png
 * Returns PNG QR image pointing to /q/:branchId (TRD 6.1)
 */
router.get('/branches/:branchId/qr.png', async (req, res) => {
  try {
    const { branchId } = req.params;
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const joinUrl = `${baseUrl}/q/${branchId}`;
    const buffer = await QRCode.toBuffer(joinUrl, { width: 300, margin: 1 });
    res.type('image/png').send(buffer);
  } catch (err) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

/**
 * GET /api/branches/:branchId/public
 * Returns branch info, services, live waiting stats, and busy level
 */
router.get('/branches/:branchId/public', async (req, res) => {
  try {
    const { branchId } = req.params;
    const branch = await Branch.findById(branchId);
    if (!branch) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Branch not found' } });
    }

    const services = await Service.find({ branchId, isActive: true });
    let totalWaiting = 0;

    const servicesWithStats = await Promise.all(
      services.map(async (svc) => {
        const est = await getServiceEstimate(branchId, svc._id);
        totalWaiting += est.waitingCount;

        return {
          _id: svc._id,
          name: svc.name,
          nameUr: svc.nameUr,
          nameSd: svc.nameSd,
          prefix: svc.prefix,
          defaultServiceSec: svc.defaultServiceSec,
          emaServiceSec: svc.emaServiceSec,
          sampleCount: svc.sampleCount,
          waitingCount: est.waitingCount,
          openCounters: est.openCounters,
          estimateSec: est.estimateSec,
          range: est.range,
          confidence: est.confidence
        };
      })
    );

    const busy = calculateBusyLevel(totalWaiting);

    res.json({
      branch: {
        _id: branch._id,
        name: branch.name,
        type: branch.type,
        workingHours: branch.workingHours,
        settings: branch.settings,
        isDemo: branch.isDemo
      },
      services: servicesWithStats,
      totalWaiting,
      busyLevel: busy.label,
      busyScore: busy.level
    });
  } catch (error) {
    console.error('Error fetching public branch info:', error);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

/**
 * POST /api/tokens
 * Create a new customer token with atomic sequence number
 */
router.post('/tokens', async (req, res) => {
  try {
    const {
      branchId,
      serviceId,
      priorityType = 'normal',
      language = 'en',
      travelMinutes = null,
      customerName = '',
      channel = 'web'
    } = req.body;

    if (!branchId || !serviceId) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'branchId and serviceId are required' }
      });
    }

    const branch = await Branch.findById(branchId);
    if (!branch) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Branch not found' } });
    }

    const service = await Service.findById(serviceId);
    if (!service) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Service not found' } });
    }

    const now = new Date();
    const dayKey = getDayKey(now);

    // Atomic increment of daily sequence number for branch + service
    const sequenceKey = `${branchId}:${serviceId}:${dayKey}`;
    const seqDoc = await Sequence.findOneAndUpdate(
      { key: sequenceKey },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' }
    );

    const number = seqDoc.seq;
    const code = `${service.prefix}-${String(number).padStart(3, '0')}`;
    const publicId = generatePublicId();

    // Priority bonus computation
    const bonusMinutes = (branch.settings && branch.settings.priorityBonusMinutes && branch.settings.priorityBonusMinutes[priorityType]) || 0;
    const effectiveTime = new Date(now.getTime() - bonusMinutes * 60 * 1000);

    // Compute estimated wait at time of joining
    const initialEst = await getServiceEstimate(branchId, serviceId);
    const estimateAtJoinSec = initialEst ? initialEst.estimateSec : null;

    const token = await Token.create({
      branchId,
      serviceId,
      publicId,
      number,
      code,
      dayKey,
      customerName: customerName.trim(),
      language,
      channel,
      isSimulated: false,
      priorityType,
      priorityVerified: priorityType === 'normal' ? null : false,
      bonusMinutes,
      effectiveTime,
      status: 'waiting',
      travelMinutes: travelMinutes ? Number(travelMinutes) : null,
      joinedAt: now,
      estimateAtJoinSec
    });

    // Log QueueEvent
    await QueueEvent.create({
      branchId,
      tokenId: token._id,
      serviceId,
      type: 'joined',
      at: now,
      meta: { code, priorityType, bonusMinutes },
      isSimulated: false
    });

    // Emit real-time events if Socket.IO is initialized
    const io = req.app.get('io');
    if (io) {
      emitQueueUpdate(io, branchId);
    }

    res.status(201).json({ token });
  } catch (error) {
    console.error('Error creating token:', error);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

/**
 * GET /api/tokens/:publicId
 * Get live token status, ahead count, estimate range, and counter info
 */
router.get('/tokens/:publicId', async (req, res) => {
  try {
    const { publicId } = req.params;
    const token = await Token.findOne({ publicId })
      .populate('serviceId', 'name nameUr nameSd prefix defaultServiceSec emaServiceSec sampleCount')
      .populate('counterId', 'name number status');

    if (!token) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Token not found' } });
    }

    // Calculate live estimate data
    const est = await getEstimate(token);

    res.json({
      token,
      queue: est
    });
  } catch (error) {
    console.error('Error fetching token:', error);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

/**
 * PATCH /api/tokens/:publicId
 * Update travelMinutes or language
 */
router.patch('/tokens/:publicId', async (req, res) => {
  try {
    const { publicId } = req.params;
    const { travelMinutes, language } = req.body;

    const token = await Token.findOne({ publicId });
    if (!token) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Token not found' } });
    }

    if (travelMinutes !== undefined) {
      token.travelMinutes = travelMinutes !== null ? Number(travelMinutes) : null;
    }
    if (language) {
      token.language = language;
    }

    await token.save();
    res.json({ token });
  } catch (error) {
    console.error('Error updating token:', error);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

/**
 * POST /api/tokens/:publicId/here
 * Customer confirms arrival after being called
 */
router.post('/tokens/:publicId/here', async (req, res) => {
  try {
    const { publicId } = req.params;
    const token = await Token.findOne({ publicId });
    if (!token) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Token not found' } });
    }

    if (token.status !== 'called') {
      return res.status(400).json({
        error: {
          code: 'INVALID_STATUS',
          message: `Cannot confirm arrival: token status is '${token.status}', but must be 'called'`
        }
      });
    }

    token.hereAt = new Date();
    await token.save();

    await QueueEvent.create({
      branchId: token.branchId,
      tokenId: token._id,
      serviceId: token.serviceId,
      type: 'here',
      at: token.hereAt
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`branch:${token.branchId}`).emit('counter:updated', {
        tokenId: token._id,
        status: token.status,
        here: true
      });
      io.to(`token:${publicId}`).emit('token:updated', { token });
    }

    res.json({ success: true, token });
  } catch (error) {
    console.error('Error recording here:', error);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

/**
 * POST /api/tokens/:publicId/cancel
 * Customer cancels their token
 */
router.post('/tokens/:publicId/cancel', async (req, res) => {
  try {
    const { publicId } = req.params;
    const token = await Token.findOne({ publicId });
    if (!token) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Token not found' } });
    }

    if (['completed', 'cancelled'].includes(token.status)) {
      return res.status(400).json({
        error: { code: 'INVALID_STATUS', message: `Cannot cancel a token that is ${token.status}` }
      });
    }

    token.status = 'cancelled';
    await token.save();

    await QueueEvent.create({
      branchId: token.branchId,
      tokenId: token._id,
      serviceId: token.serviceId,
      type: 'cancelled',
      at: new Date()
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`branch:${token.branchId}`).emit('queue:updated', {
        branchId: token.branchId,
        serviceId: token.serviceId,
        change: 'token_cancelled',
        tokenCode: token.code
      });
      io.to(`token:${publicId}`).emit('token:updated', { token });
    }

    res.json({ success: true, token });
  } catch (error) {
    console.error('Error cancelling token:', error);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

/**
 * POST /api/tokens/:publicId/feedback
 * Submit customer feedback (1-5 rating, comment)
 */
router.post('/tokens/:publicId/feedback', async (req, res) => {
  try {
    const { publicId } = req.params;
    const { rating, comment } = req.body;

    const token = await Token.findOne({ publicId });
    if (!token) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Token not found' } });
    }

    token.feedback = {
      rating: Number(rating),
      comment: comment ? String(comment).trim() : ''
    };
    await token.save();

    res.json({ success: true, feedback: token.feedback });
  } catch (error) {
    console.error('Error saving feedback:', error);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

module.exports = router;
