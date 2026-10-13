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
 * Helper to reseed today's clean starter queue
 * 11 Lab tokens (waits ~21 min with 2 counters, ~42 min with 1 counter),
 * 3 Registration tokens, 2 Pharmacy tokens.
 */
async function reseedTodayStarterQueue(branchId) {
  const todayKey = getDayKey();

  // 1. Delete all tokens and queue events for today
  await Token.deleteMany({ branchId, dayKey: todayKey });
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  await QueueEvent.deleteMany({ branchId, at: { $gte: startOfDay } });

  // 2. Clear sequence counters for today
  await Sequence.deleteMany({ key: { $regex: `:${todayKey}$` } });

  // 3. Find services and restore initial learned EMAs
  const regService = await Service.findOne({ branchId, prefix: 'R' });
  const labService = await Service.findOne({ branchId, prefix: 'L' });
  const pharmService = await Service.findOne({ branchId, prefix: 'P' });
  if (!regService || !labService || !pharmService) return;

  regService.emaServiceSec = 145;
  regService.sampleCount = 22;
  await regService.save();

  labService.emaServiceSec = 230;
  labService.sampleCount = 24;
  await labService.save();

  pharmService.emaServiceSec = 85;
  pharmService.sampleCount = 26;
  await pharmService.save();

  const starterTokens = [
    // Registration (3 tokens)
    { svc: regService, priority: 'normal', name: 'Zubair Khan', bonus: 0 },
    { svc: regService, priority: 'senior', name: 'Baba Raza', bonus: 20 },
    { svc: regService, priority: 'normal', name: 'Noman Ali', bonus: 0 },
    // Lab tests (11 tokens) -> wait with 2 counters is ~21 min (20-25 min range)
    { svc: labService, priority: 'normal', name: 'Ayesha Tariq', bonus: 0, travelMinutes: 20 },
    { svc: labService, priority: 'pregnant', name: 'Fatima Noor', bonus: 20 },
    { svc: labService, priority: 'normal', name: 'Bilal Ahmed', bonus: 0 },
    { svc: labService, priority: 'normal', name: 'Kamran Akmal', bonus: 0 },
    { svc: labService, priority: 'senior', name: 'Haji Aslam', bonus: 20 },
    { svc: labService, priority: 'normal', name: 'Mariam Bibi', bonus: 0 },
    { svc: labService, priority: 'normal', name: 'Daniyal Qureshi', bonus: 0 },
    { svc: labService, priority: 'disabled', name: 'Rashid Minhas', bonus: 30 },
    { svc: labService, priority: 'normal', name: 'Sadia Khan', bonus: 0 },
    { svc: labService, priority: 'normal', name: 'Tariq Mehmood', bonus: 0 },
    { svc: labService, priority: 'normal', name: 'Zainab Abbas', bonus: 0 },
    // Pharmacy (2 tokens)
    { svc: pharmService, priority: 'normal', name: 'Hamza Ali', bonus: 0 },
    { svc: pharmService, priority: 'disabled', name: 'Usman Ghani', bonus: 30 }
  ];

  const seqCount = { R: 0, L: 0, P: 0 };
  const now = Date.now();

  for (let idx = 0; idx < starterTokens.length; idx++) {
    const item = starterTokens[idx];
    seqCount[item.svc.prefix]++;
    const num = seqCount[item.svc.prefix];
    const code = `${item.svc.prefix}-${String(num).padStart(3, '0')}`;
    const joinedAt = new Date(now - (20 - idx) * 60 * 1000);
    const effectiveTime = new Date(joinedAt.getTime() - item.bonus * 60 * 1000);

    const token = await Token.create({
      branchId,
      serviceId: item.svc._id,
      publicId: generatePublicId(),
      number: num,
      code,
      dayKey: todayKey,
      customerName: item.name,
      channel: 'web',
      isSimulated: false,
      priorityType: item.priority,
      priorityVerified: item.priority === 'normal' ? null : false,
      bonusMinutes: item.bonus,
      effectiveTime,
      status: 'waiting',
      joinedAt,
      estimateAtJoinSec: item.svc.emaServiceSec * 3,
      travelMinutes: item.travelMinutes || null
    });

    await QueueEvent.create({
      branchId,
      tokenId: token._id,
      serviceId: item.svc._id,
      type: 'joined',
      at: joinedAt,
      isSimulated: false
    });
  }

  for (const [prefix, maxNum] of Object.entries(seqCount)) {
    const svc = [regService, labService, pharmService].find(s => s.prefix === prefix);
    const key = `${branchId}:${svc._id}:${todayKey}`;
    await Sequence.create({ key, seq: maxNum });
  }
}

/**
 * 5. Reset Demo: Clear simulated tokens, restore clean starter queue, and ensure Counter 3 is closed
 */
async function resetDemo(branchId, io = null) {
  // Stop ongoing simulation loops
  stopSteadyArrivals(branchId, io);
  if (simState.autoServeTimer) {
    clearInterval(simState.autoServeTimer);
    simState.autoServeTimer = null;
    simState.autoServe = false;
  }

  // Restore clean starter queue for today
  await reseedTodayStarterQueue(branchId);

  // Set counters: Counter 3 is CLOSED, Counters 1, 2, 4 are OPEN, all currentTokenId = null
  const counters = await Counter.find({ branchId });
  for (const c of counters) {
    c.currentTokenId = null;
    if (c.number === 3) {
      c.status = 'closed';
    } else {
      c.status = 'open';
    }
    c.statusSince = new Date();
    await c.save();
  }

  if (io) {
    emitQueueUpdate(io, branchId);
    counters.forEach(c => emitCounterUpdate(io, branchId, c._id, c.status, null));
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
