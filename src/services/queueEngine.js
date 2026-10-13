// src/services/queueEngine.js
// Core Queue Engine for Baari: atomic call-next, lifecycle transitions, EMA updates, and priority demotion
const { Token, Counter, Service, Branch, QueueEvent } = require('../models');
const { updateEma } = require('./waitTime');
const {
  emitQueueUpdate,
  emitTokenUpdate,
  emitTokenCalled,
  emitCounterUpdate
} = require('../sockets');

/**
 * Call the next eligible waiting token for a given counter
 * Atomic selection by ascending effectiveTime
 */
async function callNext(counterId, staffId = null, io = null) {
  const counter = await Counter.findById(counterId);
  if (!counter) {
    throw new Error('Counter not found');
  }
  if (counter.status !== 'open') {
    const err = new Error(`Counter is ${counter.status}. Open counter before calling next.`);
    err.code = 'COUNTER_NOT_OPEN';
    throw err;
  }

  // Atomically select and claim the next waiting token
  const token = await Token.findOneAndUpdate(
    {
      branchId: counter.branchId,
      serviceId: { $in: counter.serviceIds },
      status: 'waiting'
    },
    {
      $set: {
        status: 'called',
        counterId: counter._id,
        calledAt: new Date()
      }
    },
    {
      sort: { effectiveTime: 1 },
      returnDocument: 'after'
    }
  );

  if (token) {
    counter.currentTokenId = token._id;
    if (staffId) counter.staffId = staffId;
    await counter.save();

    await QueueEvent.create({
      branchId: counter.branchId,
      tokenId: token._id,
      serviceId: token.serviceId,
      counterId: counter._id,
      type: 'called',
      meta: {
        counterName: counter.name,
        code: token.code
      }
    });

    if (io) {
      emitTokenCalled(io, counter.branchId, token.publicId, token.code, counter.name);
      emitCounterUpdate(io, counter.branchId, counter._id, counter.status, token);
      emitQueueUpdate(io, counter.branchId);
      emitTokenUpdate(io, token.publicId);
    }
  }

  return { counter, token };
}

/**
 * Start serving a token
 */
async function startServing(tokenId, io = null) {
  const token = await Token.findById(tokenId);
  if (!token) throw new Error('Token not found');

  if (!['called', 'waiting'].includes(token.status)) {
    throw new Error(`Cannot start serving a token that is '${token.status}'`);
  }

  token.status = 'serving';
  token.servingStartedAt = new Date();
  await token.save();

  await QueueEvent.create({
    branchId: token.branchId,
    tokenId: token._id,
    serviceId: token.serviceId,
    counterId: token.counterId,
    type: 'started',
    meta: { code: token.code }
  });

  if (io) {
    io.to(`branch:${token.branchId}`).emit('token:updated', { token });
    io.to(`token:${token.publicId}`).emit('token:updated', { token });
    if (token.counterId) {
      io.to(`branch:${token.branchId}`).emit('counter:updated', {
        counterId: token.counterId,
        currentToken: token
      });
    }
  }

  return token;
}

/**
 * Complete a token and update the service's EMA
 */
async function completeToken(tokenId, io = null) {
  const token = await Token.findById(tokenId);
  if (!token) throw new Error('Token not found');

  if (!['serving', 'called'].includes(token.status)) {
    throw new Error(`Cannot complete a token that is '${token.status}'`);
  }

  const now = new Date();
  token.status = 'completed';
  token.completedAt = now;

  const started = token.servingStartedAt || token.calledAt || token.joinedAt;
  token.serviceDurationSec = Math.max(30, Math.round((now.getTime() - new Date(started).getTime()) / 1000));

  const called = token.calledAt || now;
  token.actualWaitSec = Math.max(0, Math.round((new Date(called).getTime() - new Date(token.joinedAt).getTime()) / 1000));

  await token.save();

  // Update EMA for the service
  const branch = await Branch.findById(token.branchId);
  const alpha = (branch && branch.settings && branch.settings.emaAlpha) || 0.2;
  const emaResult = await updateEma(token.serviceId, token.serviceDurationSec, alpha);

  // Clear counter's current token
  await Counter.updateOne(
    { currentTokenId: token._id },
    { $set: { currentTokenId: null } }
  );

  await QueueEvent.create({
    branchId: token.branchId,
    tokenId: token._id,
    serviceId: token.serviceId,
    counterId: token.counterId,
    type: 'completed',
    meta: {
      waitSec: token.actualWaitSec,
      durationSec: token.serviceDurationSec,
      newEma: emaResult ? emaResult.newEma : null
    }
  });

  if (io) {
    emitQueueUpdate(io, token.branchId);
    emitTokenUpdate(io, token.publicId);
    if (token.counterId) {
      emitCounterUpdate(io, token.branchId, token.counterId, 'open', null);
    }
  }

  return { token, emaResult };
}

/**
 * Mark a called token as no-show
 */
async function markNoShow(tokenId, io = null) {
  const token = await Token.findById(tokenId);
  if (!token) throw new Error('Token not found');

  if (token.status !== 'called') {
    throw new Error(`Cannot mark no-show for a token that is '${token.status}'`);
  }

  token.status = 'no_show';
  await token.save();

  // Clear counter
  await Counter.updateOne(
    { currentTokenId: token._id },
    { $set: { currentTokenId: null } }
  );

  await QueueEvent.create({
    branchId: token.branchId,
    tokenId: token._id,
    serviceId: token.serviceId,
    counterId: token.counterId,
    type: 'no_show',
    meta: { code: token.code }
  });

  if (io) {
    emitQueueUpdate(io, token.branchId);
    emitTokenUpdate(io, token.publicId);
    if (token.counterId) {
      emitCounterUpdate(io, token.branchId, token.counterId, 'open', null);
    }
  }

  return token;
}

/**
 * Recall a no-show token (allowed once only)
 * Reinserts three positions from the front
 */
async function recallToken(tokenId, io = null) {
  const token = await Token.findById(tokenId);
  if (!token) throw new Error('Token not found');

  if (token.status !== 'no_show') {
    throw new Error(`Only a 'no_show' token can be recalled. Current status is '${token.status}'`);
  }

  if (token.recallCount > 0) {
    throw new Error('This token has already been recalled once. Maximum 1 recall allowed.');
  }

  // Find waiting tokens for this service to calculate 3rd position
  const waitingTokens = await Token.find({
    branchId: token.branchId,
    serviceId: token.serviceId,
    status: 'waiting'
  }).sort({ effectiveTime: 1 });

  if (waitingTokens.length >= 3) {
    // Position between 2nd and 3rd token
    const t2 = waitingTokens[1].effectiveTime.getTime();
    const t3 = waitingTokens[2].effectiveTime.getTime();
    token.effectiveTime = new Date(t2 + Math.floor((t3 - t2) / 2));
  } else if (waitingTokens.length > 0) {
    // Place right behind the last waiting token
    const last = waitingTokens[waitingTokens.length - 1].effectiveTime.getTime();
    token.effectiveTime = new Date(last + 5000);
  } else {
    token.effectiveTime = new Date();
  }

  token.status = 'waiting';
  token.recallCount = 1;
  token.counterId = null;
  await token.save();

  await QueueEvent.create({
    branchId: token.branchId,
    tokenId: token._id,
    serviceId: token.serviceId,
    type: 'recalled',
    meta: { code: token.code }
  });

  if (io) {
    io.to(`branch:${token.branchId}`).emit('queue:updated', {
      branchId: token.branchId,
      serviceId: token.serviceId,
      change: 'token_recalled',
      tokenCode: token.code
    });
    io.to(`token:${token.publicId}`).emit('token:updated', { token });
  }

  return token;
}

/**
 * Transfer a waiting token to another service
 */
async function transferToken(tokenId, targetServiceId, io = null) {
  const token = await Token.findById(tokenId);
  if (!token) throw new Error('Token not found');

  const targetService = await Service.findById(targetServiceId);
  if (!targetService) throw new Error('Target service not found');

  const oldServiceId = token.serviceId;
  token.serviceId = targetServiceId;
  token.status = 'waiting';
  token.counterId = null;
  await token.save();

  await QueueEvent.create({
    branchId: token.branchId,
    tokenId: token._id,
    serviceId: targetServiceId,
    type: 'transferred',
    meta: { fromServiceId: oldServiceId, toServiceId: targetServiceId, code: token.code }
  });

  if (io) {
    io.to(`branch:${token.branchId}`).emit('queue:updated', {
      branchId: token.branchId,
      change: 'token_transferred',
      tokenCode: token.code
    });
    io.to(`token:${token.publicId}`).emit('token:updated', { token });
  }

  return token;
}

/**
 * Cancel a token
 */
async function cancelToken(tokenId, io = null) {
  const token = await Token.findById(tokenId);
  if (!token) throw new Error('Token not found');

  if (['completed', 'cancelled'].includes(token.status)) {
    throw new Error(`Cannot cancel a token that is '${token.status}'`);
  }

  token.status = 'cancelled';
  await token.save();

  await Counter.updateOne(
    { currentTokenId: token._id },
    { $set: { currentTokenId: null } }
  );

  await QueueEvent.create({
    branchId: token.branchId,
    tokenId: token._id,
    serviceId: token.serviceId,
    type: 'cancelled',
    meta: { code: token.code }
  });

  if (io) {
    io.to(`branch:${token.branchId}`).emit('queue:updated', {
      branchId: token.branchId,
      serviceId: token.serviceId,
      change: 'token_cancelled',
      tokenCode: token.code
    });
    io.to(`token:${token.publicId}`).emit('token:updated', { token });
  }

  return token;
}

/**
 * Verify or demote priority
 * If rejected/demoted, bonus is wiped to 0 and effectiveTime reverts to joinedAt
 */
async function setPriority(tokenId, { verified, demote }, io = null) {
  const token = await Token.findById(tokenId);
  if (!token) throw new Error('Token not found');

  if (verified === false || demote === true) {
    token.priorityVerified = false;
    token.bonusMinutes = 0;
    token.effectiveTime = token.joinedAt; // Revert to actual arrival time
    await token.save();

    await QueueEvent.create({
      branchId: token.branchId,
      tokenId: token._id,
      serviceId: token.serviceId,
      type: 'priority_rejected',
      meta: { code: token.code }
    });
  } else if (verified === true) {
    token.priorityVerified = true;
    await token.save();

    await QueueEvent.create({
      branchId: token.branchId,
      tokenId: token._id,
      serviceId: token.serviceId,
      type: 'priority_verified',
      meta: { code: token.code }
    });
  }

  if (io) {
    io.to(`branch:${token.branchId}`).emit('queue:updated', {
      branchId: token.branchId,
      serviceId: token.serviceId,
      change: 'priority_changed',
      tokenCode: token.code
    });
    io.to(`token:${token.publicId}`).emit('token:updated', { token });
  }

  return token;
}

module.exports = {
  callNext,
  startServing,
  completeToken,
  markNoShow,
  recallToken,
  transferToken,
  cancelToken,
  setPriority
};
