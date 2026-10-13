// src/services/simulator.js
// Simulation Lab Engine: Rush injection, steady arrivals, auto-serve, demo reset, and What-If
const { Branch, Service, Counter, Token, QueueEvent, Sequence } = require('../models');
const { getDayKey, generatePublicId } = require('../utils/helpers');
const { getServiceEstimate, whatIf } = require('./waitTime');
const { callNext, startServing, completeToken } = require('./queueEngine');
const { emitQueueUpdate, emitCounterUpdate } = require('../sockets');

// In-memory simulation state
const simState = {
  running: false,
  arrivalsPerMin: 0,
  autoServe: false,
  arrivalTimer: null,
  autoServeTimer: null
};

/**
 * Emit sim:status socket event to branch
 */
function emitSimStatus(io, branchId) {
  if (!io || !branchId) return;
  io.to(`branch:${branchId}`).emit('sim:status', {
    running: simState.running,
    arrivalsPerMin: simState.arrivalsPerMin,
    autoServe: simState.autoServe,
    timestamp: new Date().toISOString()
  });
}

/**
 * 1. Add Rush: Insert N simulated tokens with timestamps spread across the last minute
 */
async function addRush(branchId, count = 20, serviceId = null, io = null) {
  const branch = await Branch.findById(branchId);
  if (!branch) throw new Error('Branch not found');

  let service = null;
  if (serviceId) {
    service = await Service.findById(serviceId);
  } else {
    // Default to Lab tests ('L') or first active service
    service = (await Service.findOne({ branchId, prefix: 'L', isActive: true })) ||
              (await Service.findOne({ branchId, isActive: true }));
  }
  if (!service) throw new Error('Service not found');

  const now = new Date();
  const dayKey = getDayKey(now);
  const sequenceKey = `${branchId}:${service._id}:${dayKey}`;

  const createdTokens = [];
  const est = await getServiceEstimate(branchId, service._id);

  for (let i = 0; i < count; i++) {
    // Increment daily sequence atomically
    const seqDoc = await Sequence.findOneAndUpdate(
      { key: sequenceKey },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' }
    );

    const number = seqDoc.seq;
    const code = `${service.prefix}-${String(number).padStart(3, '0')}`;
    const publicId = generatePublicId();

    // Spread joinedAt across the last minute
    const joinedAt = new Date(now.getTime() - (count - i) * 3000);

    const tok = await Token.create({
      branchId,
      serviceId: service._id,
      publicId,
      number,
      code,
      dayKey,
      customerName: `Sim Customer ${number}`,
      channel: 'web',
      isSimulated: true,
      priorityType: 'normal',
      effectiveTime: joinedAt,
      status: 'waiting',
      joinedAt,
      estimateAtJoinSec: est ? est.estimateSec : 180
    });

    await QueueEvent.create({
      branchId,
      tokenId: tok._id,
      serviceId: service._id,
      type: 'joined',
      at: joinedAt,
      meta: { code, simulated: true },
      isSimulated: true
    });

    createdTokens.push(tok);
  }

  if (io) {
    emitQueueUpdate(io, branchId);
  }

  return {
    success: true,
    count: createdTokens.length,
    serviceId: service._id,
    serviceName: service.name,
    firstCode: createdTokens[0]?.code,
    lastCode: createdTokens[createdTokens.length - 1]?.code
  };
}

/**
 * 2. Start Steady Arrivals: Continuous arrivals at rate of arrivalsPerMin
 */
function startSteadyArrivals(branchId, arrivalsPerMin = 4, serviceId = null, io = null) {
  if (simState.arrivalTimer) {
    clearInterval(simState.arrivalTimer);
  }

  simState.running = true;
  simState.arrivalsPerMin = Number(arrivalsPerMin) || 4;

  const intervalMs = Math.max(1000, Math.round((60 / simState.arrivalsPerMin) * 1000));

  simState.arrivalTimer = setInterval(async () => {
    try {
      await addRush(branchId, 1, serviceId, io);
    } catch (err) {
      console.error('[Simulator] Steady arrival error:', err.message);
    }
  }, intervalMs);

  emitSimStatus(io, branchId);
  return { running: true, arrivalsPerMin: simState.arrivalsPerMin };
}

/**
 * 3. Stop Steady Arrivals
 */
function stopSteadyArrivals(branchId, io = null) {
  if (simState.arrivalTimer) {
    clearInterval(simState.arrivalTimer);
    simState.arrivalTimer = null;
  }
  simState.running = false;
  simState.arrivalsPerMin = 0;

  emitSimStatus(io, branchId);
  return { running: false, arrivalsPerMin: 0 };
}

/**
 * 4. Toggle Auto-Serve at Counters
 * Automatically calls and completes tokens around the service EMA duration
 */
function toggleAutoServe(branchId, enabled = null, io = null) {
  if (enabled !== null) {
    simState.autoServe = Boolean(enabled);
  } else {
    simState.autoServe = !simState.autoServe;
  }

  if (simState.autoServeTimer) {
    clearInterval(simState.autoServeTimer);
    simState.autoServeTimer = null;
  }

  if (simState.autoServe) {
    simState.autoServeTimer = setInterval(async () => {
      try {
        const counters = await Counter.find({ branchId, status: 'open' })
          .populate('currentTokenId')
          .populate('serviceIds');

        for (const counter of counters) {
          if (!counter.currentTokenId) {
            // Idle open counter -> Call next
            await callNext(counter._id, io);
          } else {
            const currentTok = counter.currentTokenId;
            if (currentTok.status === 'called') {
              // Start serving
              await startServing(currentTok._id, io);
            } else if (currentTok.status === 'serving') {
              // Complete token with random duration around service EMA
              const service = await Service.findById(currentTok.serviceId);
              const avgSec = service ? (service.emaServiceSec || service.defaultServiceSec || 180) : 180;
              // Duration variation: 80% to 120% of EMA
              const randomizedSec = Math.round(avgSec * (0.8 + 0.4 * Math.random()));

              await completeToken(currentTok._id, io, randomizedSec);
            }
          }
        }
      } catch (err) {
        console.error('[Simulator] Auto-serve loop error:', err.message);
      }
    }, 3000); // Check counters every 3 seconds
  }

  emitSimStatus(io, branchId);
  return { autoServe: simState.autoServe };
}

/**
 * 5. Reset Demo: Clear simulated tokens and restore initial clean queue state
 */
async function resetDemo(branchId, io = null) {
  // Stop ongoing simulation loops
  stopSteadyArrivals(branchId, io);
  if (simState.autoServeTimer) {
    clearInterval(simState.autoServeTimer);
    simState.autoServeTimer = null;
    simState.autoServe = false;
  }

  // Delete all simulated tokens and events
  await Token.deleteMany({ branchId, isSimulated: true });
  await QueueEvent.deleteMany({ branchId, isSimulated: true });

  // Clean counters: clear active tokens that were simulated
  const counters = await Counter.find({ branchId }).populate('currentTokenId');
  for (const c of counters) {
    if (!c.currentTokenId || c.currentTokenId.isSimulated) {
      c.currentTokenId = null;
      // Default initial states: Counter 1 & 2 open, Counter 3 closed, Counter 4 open/break
      if (c.number === 3) {
        c.status = 'closed';
      } else if (c.number === 4) {
        c.status = 'break';
      } else {
        c.status = 'open';
      }
      c.statusSince = new Date();
      await c.save();
    }
  }

  if (io) {
    emitQueueUpdate(io, branchId);
    counters.forEach(c => emitCounterUpdate(io, branchId, c._id, c.status, c.currentTokenId));
    emitSimStatus(io, branchId);
  }

  return { success: true, message: 'Demo data reset successfully' };
}

/**
 * 6. What-If Engine: Before and After estimate for longest-waiting or specified service
 */
async function getWhatIf(branchId, serviceId = null, deltaCounters = 1) {
  let targetService = null;

  if (serviceId) {
    targetService = await Service.findById(serviceId);
  } else {
    // Automatically find longest-waiting service in branch
    const services = await Service.find({ branchId, isActive: true });
    let maxWaitSec = -1;

    for (const s of services) {
      const est = await getServiceEstimate(branchId, s._id);
      const estSec = est && est.estimateSec ? est.estimateSec : 0;
      if (estSec > maxWaitSec) {
        maxWaitSec = estSec;
        targetService = s;
      }
    }

    if (!targetService && services.length > 0) {
      targetService = services[0];
    }
  }

  if (!targetService) {
    return { error: 'No active services available' };
  }

  const result = await whatIf(branchId, targetService._id, deltaCounters);
  if (!result) return { error: 'Could not compute What-If' };

  return {
    serviceId: targetService._id,
    serviceName: targetService.name,
    prefix: targetService.prefix,
    before: `${result.beforeMin !== null ? result.beforeMin : 0} min`,
    after: `${result.afterMin !== null ? result.afterMin : 0} min`,
    savedMin: result.savedMin,
    beforeMin: result.beforeMin !== null ? result.beforeMin : 0,
    afterMin: result.afterMin !== null ? result.afterMin : 0,
    currentCounters: result.currentCounters,
    targetCounters: result.targetCounters
  };
}

module.exports = {
  addRush,
  startSteadyArrivals,
  stopSteadyArrivals,
  toggleAutoServe,
  resetDemo,
  getWhatIf,
  getSimState: () => ({ ...simState })
};
