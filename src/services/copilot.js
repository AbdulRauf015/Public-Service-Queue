// src/services/copilot.js
// Staff Copilot advice engine following TRD section 4.5 rules
const { Branch, Service, Counter, Token } = require('../models');
const { getServiceEstimate, whatIf } = require('./waitTime');

/**
 * Evaluate the 3 Staff Copilot rules for a branch:
 * 1. High wait (> 15 min): suggest opening an available closed/idle counter.
 * 2. Service rebalance: if one service is < 5 min and another is high, suggest moving counter.
 * 3. Paused counter: if a counter is on break for > 10 min, suggest checking counter.
 */
async function getCopilotSuggestions(branchId) {
  const branch = await Branch.findById(branchId);
  if (!branch) return { suggestions: [] };

  const alertThresholdMin = (branch.settings && branch.settings.alertThresholdMin) || 15;
  const services = await Service.find({ branchId, isActive: true });
  const counters = await Counter.find({ branchId });

  const serviceStats = [];
  for (const svc of services) {
    const est = await getServiceEstimate(branchId, svc._id);
    const estMin = est && est.estimateSec ? Math.round(est.estimateSec / 60) : 0;
    serviceStats.push({
      service: svc,
      estimateMin: estMin,
      waitingCount: est ? est.waitingCount : 0,
      openCounters: est ? est.openCounters : 0
    });
  }

  // Sort services by wait time descending (longest waiting first)
  serviceStats.sort((a, b) => b.estimateMin - a.estimateMin);

  const suggestions = [];

  // --- Rule 1: High wait time (> 15 min) -> Suggest "Open Counter X" ---
  for (const stat of serviceStats) {
    if (stat.estimateMin >= alertThresholdMin) {
      // Find a closed or idle counter that supports this service
      const candidateCounter = counters.find(c =>
        c.status === 'closed' && (c.serviceIds || []).some(sId => sId.toString() === stat.service._id.toString())
      );

      if (candidateCounter) {
        // Calculate What-If reduction
        const whatIfData = await whatIf(branchId, stat.service._id, 1);
        const afterMin = whatIfData && whatIfData.afterMin !== null ? whatIfData.afterMin : Math.round(stat.estimateMin / 2);

        suggestions.push({
          type: 'open_counter',
          severity: 'warning',
          serviceId: stat.service._id,
          serviceName: stat.service.name,
          counterId: candidateCounter._id,
          counterName: candidateCounter.name,
          currentWaitMin: stat.estimateMin,
          projectedWaitMin: afterMin,
          text: `${stat.service.name} wait is ${stat.estimateMin} min. Open ${candidateCounter.name} to bring it to ${afterMin} min.`,
          action: {
            label: `Open ${candidateCounter.name}`,
            type: 'set_counter_status',
            counterId: candidateCounter._id,
            status: 'open'
          }
        });
        break; // Show top high-wait recommendation first
      }
    }
  }

  // --- Rule 2: Service rebalance (< 5 min vs high wait) ---
  const lowWait = serviceStats.find(s => s.estimateMin < 5 && s.openCounters > 1);
  const highWait = serviceStats.find(s => s.estimateMin >= 10);
  if (lowWait && highWait) {
    // Check if an open counter supports both services
    const flexibleCounter = counters.find(c =>
      c.status === 'open' &&
      (c.serviceIds || []).some(id => id.toString() === lowWait.service._id.toString()) &&
      (c.serviceIds || []).some(id => id.toString() === highWait.service._id.toString())
    );

    if (flexibleCounter) {
      suggestions.push({
        type: 'rebalance_counter',
        severity: 'info',
        counterId: flexibleCounter._id,
        counterName: flexibleCounter.name,
        fromService: lowWait.service.name,
        toService: highWait.service.name,
        text: `${lowWait.service.name} wait is under 5 min. Move ${flexibleCounter.name} to ${highWait.service.name}.`,
        action: {
          label: `Prioritize ${highWait.service.name}`,
          type: 'rebalance',
          counterId: flexibleCounter._id
        }
      });
    }
  }

  // --- Rule 3: Counter paused for > 10 minutes ---
  const now = Date.now();
  for (const c of counters) {
    if (c.status === 'break' && c.statusSince) {
      const elapsedMs = now - new Date(c.statusSince).getTime();
      const pausedMin = Math.floor(elapsedMs / (60 * 1000));
      if (pausedMin >= 10) {
        suggestions.push({
          type: 'check_counter',
          severity: 'warning',
          counterId: c._id,
          counterName: c.name,
          pausedMin,
          text: `${c.name} has been paused for ${pausedMin} minutes. Check on counter.`,
          action: {
            label: `Resume ${c.name}`,
            type: 'set_counter_status',
            counterId: c._id,
            status: 'open'
          }
        });
      }
    }
  }

  // If no recommendations triggered, return optimal status message
  if (suggestions.length === 0) {
    suggestions.push({
      type: 'optimal',
      severity: 'success',
      text: 'All counters operating normally. Waiting times within standard parameters.',
      action: null
    });
  }

  return { suggestions };
}

module.exports = {
  getCopilotSuggestions
};
