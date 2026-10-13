// src/services/waitTime.js
// Wait-time engine implementing formulas from TRD section 4
const { Token, Counter, Service } = require('../models');

/**
 * Returns confidence label based on sampleCount
 * < 5: Learning, 5-14: Fair, >= 15: Good
 */
function confidenceLabel(sampleCount = 0) {
  if (sampleCount < 5) return 'Learning';
  if (sampleCount < 15) return 'Fair';
  return 'Good';
}

/**
 * Count how many waiting tokens are ahead of this token
 */
async function getAheadCount(token) {
  return await Token.countDocuments({
    branchId: token.branchId,
    serviceId: token.serviceId,
    status: 'waiting',
    effectiveTime: { $lt: token.effectiveTime }
  });
}

/**
 * Calculate estimate in seconds for a specific token
 * Formula: estimateSec = (ahead * avgSvc + remaining) / openCounters
 */
async function getEstimate(token) {
  const service = await Service.findById(token.serviceId);
  if (!service) return null;

  const avgSvc = service.emaServiceSec || service.defaultServiceSec || 180;

  // Find counters currently open and supporting this service
  const openCounters = await Counter.find({
    branchId: token.branchId,
    status: 'open',
    serviceIds: token.serviceId
  });

  if (openCounters.length === 0) {
    return {
      estimateSec: null,
      range: null,
      confidence: confidenceLabel(service.sampleCount),
      openCounters: 0,
      ahead: await getAheadCount(token)
    };
  }

  const ahead = await getAheadCount(token);

  // Calculate remaining time for busy counters currently serving
  let remainingSec = 0;
  const now = Date.now();

  for (const counter of openCounters) {
    if (counter.currentTokenId) {
      const activeToken = await Token.findById(counter.currentTokenId);
      if (activeToken && activeToken.servingStartedAt) {
        const elapsedSec = (now - new Date(activeToken.servingStartedAt).getTime()) / 1000;
        const leftSec = Math.max(0, avgSvc - elapsedSec);
        remainingSec += leftSec;
      }
    }
  }

  const estimateSec = Math.round((ahead * avgSvc + remainingSec) / openCounters.length);

  // Range formula: low = estimate * 0.8, high = estimate * 1.25 + 60s
  const low = Math.round(estimateSec * 0.8);
  const high = Math.round(estimateSec * 1.25 + 60);

  return {
    estimateSec,
    range: { low, high },
    confidence: confidenceLabel(service.sampleCount),
    openCounters: openCounters.length,
    ahead
  };
}

/**
 * Calculate estimate for a new customer joining a service
 */
async function getServiceEstimate(branchId, serviceId) {
  const service = await Service.findById(serviceId);
  if (!service) return null;

  const avgSvc = service.emaServiceSec || service.defaultServiceSec || 180;
  const openCounters = await Counter.find({
    branchId,
    status: 'open',
    serviceIds: serviceId
  });

  const waitingCount = await Token.countDocuments({
    branchId,
    serviceId,
    status: 'waiting'
  });

  if (openCounters.length === 0) {
    return {
      estimateSec: null,
      range: null,
      confidence: confidenceLabel(service.sampleCount),
      openCounters: 0,
      waitingCount
    };
  }

  const estimateSec = Math.round((waitingCount * avgSvc) / openCounters.length);
  const low = Math.round(estimateSec * 0.8);
  const high = Math.round(estimateSec * 1.25 + 60);

  return {
    estimateSec,
    range: { low, high },
    confidence: confidenceLabel(service.sampleCount),
    openCounters: openCounters.length,
    waitingCount
  };
}

/**
 * Update service EMA after a token is completed
 * Formula:
 * duration = clamp((completedAt - servingStartedAt)/1000, 30, 3600)
 * ema_new = alpha * duration + (1 - alpha) * ema_old
 * sampleCount += 1
 */
async function updateEma(serviceId, durationSec, alpha = 0.2) {
  const service = await Service.findById(serviceId);
  if (!service) return null;

  const { clamp } = require('../utils/helpers');
  const clampedDuration = clamp(durationSec, 30, 3600);
  const oldEma = service.emaServiceSec || service.defaultServiceSec || 180;

  const newEma = Number((alpha * clampedDuration + (1 - alpha) * oldEma).toFixed(1));
  service.emaServiceSec = newEma;
  service.sampleCount = (service.sampleCount || 0) + 1;
  await service.save();

  return {
    service,
    durationSec: clampedDuration,
    oldEma,
    newEma,
    sampleCount: service.sampleCount
  };
}

/**
 * What-If Engine (powers the What-If Panel)
 * Computes before and after estimate for a service with deltaCounters
 */
async function whatIf(branchId, serviceId, deltaCounters = 1) {
  const service = await Service.findById(serviceId);
  if (!service) return null;

  const avgSvc = service.emaServiceSec || service.defaultServiceSec || 180;

  const openCounters = await Counter.find({
    branchId,
    status: 'open',
    serviceIds: serviceId
  });

  const waitingCount = await Token.countDocuments({
    branchId,
    serviceId,
    status: 'waiting'
  });

  // Calculate remaining time for currently busy counters
  let remainingSec = 0;
  const now = Date.now();
  for (const counter of openCounters) {
    if (counter.currentTokenId) {
      const activeToken = await Token.findById(counter.currentTokenId);
      if (activeToken && activeToken.servingStartedAt) {
        const elapsedSec = (now - new Date(activeToken.servingStartedAt).getTime()) / 1000;
        const leftSec = Math.max(0, avgSvc - elapsedSec);
        remainingSec += leftSec;
      }
    }
  }

  const currentCount = openCounters.length;
  const targetCount = currentCount + Number(deltaCounters);

  if (targetCount <= 0) {
    return {
      beforeSec: currentCount > 0 ? Math.round((waitingCount * avgSvc + remainingSec) / currentCount) : null,
      afterSec: null,
      savedSec: 0,
      beforeMin: currentCount > 0 ? Math.round(((waitingCount * avgSvc + remainingSec) / currentCount) / 60) : null,
      afterMin: null,
      savedMin: 0,
      currentCounters: currentCount,
      targetCounters: targetCount
    };
  }

  const beforeSec = currentCount > 0
    ? Math.round((waitingCount * avgSvc + remainingSec) / currentCount)
    : null;

  const afterSec = Math.round((waitingCount * avgSvc + remainingSec) / targetCount);
  const savedSec = beforeSec !== null ? Math.max(0, beforeSec - afterSec) : 0;

  return {
    beforeSec,
    afterSec,
    savedSec,
    beforeMin: beforeSec !== null ? Math.round(beforeSec / 60) : null,
    afterMin: Math.round(afterSec / 60),
    savedMin: Math.round(savedSec / 60),
    currentCounters: currentCount,
    targetCounters: targetCount
  };
}

module.exports = {
  confidenceLabel,
  getAheadCount,
  getEstimate,
  getServiceEstimate,
  updateEma,
  whatIf
};
