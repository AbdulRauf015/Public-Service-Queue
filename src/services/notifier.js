// src/services/notifier.js
// Automated notification evaluator for customer alerts: Leave now, Almost your turn, Your turn
const { Token, Counter, Branch } = require('../models');
const { getEstimate } = require('./waitTime');

let notifierInterval = null;
let ioInstance = null;

/**
 * Emit notify:alert event to both token and branch rooms
 */
function emitAlert(io, token, level, message, meta = {}) {
  if (!io) return;
  const payload = {
    publicId: token.publicId,
    code: token.code,
    level, // 'leaveNow' | 'almost' | 'called'
    message,
    branchId: token.branchId,
    timestamp: new Date().toISOString(),
    ...meta
  };

  io.to(`token:${token.publicId}`).emit('notify:alert', payload);
  io.to(`branch:${token.branchId}`).emit('notify:alert', payload);
}

/**
 * Evaluate notification conditions for a single token
 * Returns array of alert levels fired: ['leaveNow', 'almost', 'called']
 */
async function evaluateTokenAlerts(token, io = null) {
  const fired = [];

  // 1. "Leave now" alert
  // Condition: travelMinutes is set > 0, estimate <= travelMinutes + buffer (5 min), and not sent yet
  if (
    token.status === 'waiting' &&
    token.travelMinutes != null &&
    token.travelMinutes > 0 &&
    !token.notified?.leaveNow
  ) {
    const est = await getEstimate(token);
    if (est && est.estimateSec != null) {
      const estimateMin = Math.round(est.estimateSec / 60);
      const buffer = 5; // TRD 4.6 default buffer
      if (estimateMin <= token.travelMinutes + buffer) {
        const updated = await Token.findOneAndUpdate(
          { _id: token._id, 'notified.leaveNow': false },
          { $set: { 'notified.leaveNow': true } },
          { returnDocument: 'after' }
        );
        if (updated) {
          const message = `Time to head over! Estimated wait is ~${Math.max(1, estimateMin)} minutes.`;
          emitAlert(io, token, 'leaveNow', message, { estimateMin, travelMinutes: token.travelMinutes });
          fired.push('leaveNow');
        }
      }
    }
  }

  // 2. "Almost your turn" alert
  // Condition: ahead <= 3 (or approachingAhead) and not sent yet
  if (
    token.status === 'waiting' &&
    !token.notified?.almost
  ) {
    const est = await getEstimate(token);
    const ahead = est ? est.ahead : 0;
    if (ahead <= 3) {
      const updated = await Token.findOneAndUpdate(
        { _id: token._id, 'notified.almost': false },
        { $set: { 'notified.almost': true } },
        { returnDocument: 'after' }
      );
      if (updated) {
        const message = `Almost your turn! Only ${ahead} ${ahead === 1 ? 'person' : 'people'} ahead.`;
        emitAlert(io, token, 'almost', message, { ahead });
        fired.push('almost');
      }
    }
  }

  // 3. "Your turn" alert
  // Condition: status is 'called' and not sent yet
  if (
    token.status === 'called' &&
    !token.notified?.called
  ) {
    const updated = await Token.findOneAndUpdate(
      { _id: token._id, 'notified.called': false },
      { $set: { 'notified.called': true } },
      { returnDocument: 'after' }
    );
    if (updated) {
      let counterName = 'the counter';
      if (token.counterId) {
        if (token.counterId.name) {
          counterName = token.counterId.name;
        } else {
          const c = await Counter.findById(token.counterId);
          if (c) counterName = c.name;
        }
      }
      const message = `It's your turn! Please proceed to ${counterName}.`;
      emitAlert(io, token, 'called', message, { counterName });
      fired.push('called');
    }
  }

  return fired;
}

/**
 * Check alerts for all waiting and called tokens in a branch
 */
async function checkBranchAlerts(branchId, io = null) {
  const activeIo = io || ioInstance;
  const tokens = await Token.find({
    branchId,
    status: { $in: ['waiting', 'called'] }
  }).populate('counterId', 'name number');

  const results = [];
  for (const tok of tokens) {
    const fired = await evaluateTokenAlerts(tok, activeIo);
    if (fired.length > 0) {
      results.push({ tokenId: tok._id, code: tok.code, fired });
    }
  }
  return results;
}

/**
 * Check alerts across all active tokens across all branches
 */
async function checkAllAlerts(io = null) {
  const activeIo = io || ioInstance;
  try {
    const tokens = await Token.find({
      status: { $in: ['waiting', 'called'] },
      $or: [
        { 'notified.leaveNow': false, travelMinutes: { $gt: 0 } },
        { 'notified.almost': false, status: 'waiting' },
        { 'notified.called': false, status: 'called' }
      ]
    }).populate('counterId', 'name number');

    const results = [];
    for (const tok of tokens) {
      const fired = await evaluateTokenAlerts(tok, activeIo);
      if (fired.length > 0) {
        results.push({ tokenId: tok._id, code: tok.code, fired });
      }
    }
    return results;
  } catch (err) {
    console.error('[Notifier] Error evaluating alerts:', err.message);
    return [];
  }
}

/**
 * Start 10-second periodic notifier loop
 */
function startNotifier(io = null) {
  if (io) ioInstance = io;
  if (notifierInterval) clearInterval(notifierInterval);

  console.log('[Notifier] Started 10-second alert evaluation service');
  notifierInterval = setInterval(() => {
    checkAllAlerts(ioInstance);
  }, 10000);
}

/**
 * Stop notifier loop
 */
function stopNotifier() {
  if (notifierInterval) {
    clearInterval(notifierInterval);
    notifierInterval = null;
    console.log('[Notifier] Alert evaluation service stopped');
  }
}

module.exports = {
  startNotifier,
  stopNotifier,
  checkBranchAlerts,
  checkAllAlerts,
  evaluateTokenAlerts
};
