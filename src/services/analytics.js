// src/services/analytics.js
// Analytics Engine implementing Backendschema.md sections 4.5 to 4.8
const mongoose = require('mongoose');
const { Token, Counter, Service, Branch } = require('../models');
const { getDayKey } = require('../utils/helpers');

/**
 * Helper to get array of YYYY-MM-DD day keys for the last 7 days
 */
function getLast7Days() {
  const days = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    days.push(getDayKey(d));
  }
  return days;
}

/**
 * Format 24-hour integer to friendly 12-hour span, e.g. 14 -> "2 to 3 pm", 9 -> "9 to 10 am"
 */
function formatHourSpan(hour) {
  const formatSingle = (h) => {
    const ampm = h >= 12 && h < 24 ? 'pm' : 'am';
    let h12 = h % 12;
    if (h12 === 0) h12 = 12;
    return `${h12} ${ampm}`;
  };
  const start = hour;
  const end = (hour + 1) % 24;
  const startStr = formatSingle(start).replace(/ (am|pm)/, '');
  const endStr = formatSingle(end);
  return `${startStr} to ${endStr}`;
}

/**
 * Format 24-hour integer to single hour label, e.g. 9 -> "9 AM", 14 -> "2 PM"
 */
function formatHourLabel(h) {
  const ampm = h >= 12 && h < 24 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12} ${ampm}`;
}

/**
 * 4.5 Analytics Summary
 * Returns: Average wait, average service time, completed, in queue now, no-show rate
 */
async function getSummary(branchId, options = {}) {
  const { range = 'today', includeSimulated = true, dayKey = getDayKey() } = options;

  const bId = new mongoose.Types.ObjectId(branchId);
  const match = { branchId: bId };

  if (range === '7days' || range === '7d' || range === 'week') {
    match.dayKey = { $in: getLast7Days() };
  } else {
    match.dayKey = dayKey;
  }

  if (!includeSimulated) {
    match.isSimulated = false;
  }

  // Aggregation query per Backendschema 4.5
  const results = await Token.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        noShow: { $sum: { $cond: [{ $eq: ['$status', 'no_show'] }, 1, 0] } },
        waiting: { $sum: { $cond: [{ $eq: ['$status', 'waiting'] }, 1, 0] } },
        avgWaitSec: { $avg: '$actualWaitSec' },
        avgSvcSec: { $avg: '$serviceDurationSec' }
      }
    }
  ]);

  const agg = results[0] || {
    completed: 0,
    noShow: 0,
    waiting: 0,
    avgWaitSec: 0,
    avgSvcSec: 0
  };

  // Real-time live count of visitors currently in queue
  const inQueueNow = await Token.countDocuments({
    branchId: bId,
    status: { $in: ['waiting', 'called', 'serving'] },
    ...(includeSimulated ? {} : { isSimulated: false })
  });

  const avgWaitSec = Math.round(agg.avgWaitSec || 0);
  const avgWaitMin = avgWaitSec > 0 ? Math.round((avgWaitSec / 60) * 10) / 10 : 0;
  const avgSvcSec = Math.round(agg.avgSvcSec || 0);
  const avgSvcMin = avgSvcSec > 0 ? Math.round((avgSvcSec / 60) * 10) / 10 : 0;

  const completed = agg.completed || 0;
  const noShow = agg.noShow || 0;
  const totalResolved = completed + noShow;
  const noShowRate = totalResolved > 0 ? Math.round((noShow / totalResolved) * 100) : 0;

  return {
    avgWaitSec,
    avgWaitMin,
    avgSvcSec,
    avgSvcMin,
    completed,
    inQueueNow,
    noShow,
    noShowRate,
    range,
    includeSimulated: !!includeSimulated
  };
}

/**
 * 4.6 Hourly Arrivals and Average Wait
 * Returns: Array of hourly arrivals count and average wait in minutes & seconds
 */
async function getHourly(branchId, options = {}) {
  const { range = 'today', includeSimulated = true, dayKey = getDayKey() } = options;

  const bId = new mongoose.Types.ObjectId(branchId);
  const match = { branchId: bId };

  if (range === '7days' || range === '7d' || range === 'week') {
    match.dayKey = { $in: getLast7Days() };
  } else {
    match.dayKey = dayKey;
  }

  if (!includeSimulated) {
    match.isSimulated = false;
  }

  // Aggregation per Backendschema 4.6
  const aggResults = await Token.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $hour: { date: '$joinedAt', timezone: 'Asia/Karachi' } },
        arrivals: { $sum: 1 },
        avgWaitSec: { $avg: '$actualWaitSec' }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  const mapByHour = {};
  aggResults.forEach((row) => {
    mapByHour[row._id] = {
      arrivals: row.arrivals || 0,
      avgWaitSec: Math.round(row.avgWaitSec || 0)
    };
  });

  // Standard operating hours: 9 AM to 5 PM (9 to 17)
  const hours = [];
  for (let h = 9; h <= 17; h++) {
    const data = mapByHour[h] || { arrivals: 0, avgWaitSec: 0 };
    const avgWaitMin = data.avgWaitSec > 0 ? Math.round((data.avgWaitSec / 60) * 10) / 10 : 0;
    hours.push({
      hour: h,
      label: formatHourLabel(h),
      span: formatHourSpan(h),
      arrivals: data.arrivals,
      avgWaitSec: data.avgWaitSec,
      avgWaitMin
    });
  }

  // Also include any off-hours arrivals that have data
  aggResults.forEach((row) => {
    if (row._id < 9 || row._id > 17) {
      const waitMin = row.avgWaitSec ? Math.round((row.avgWaitSec / 60) * 10) / 10 : 0;
      hours.push({
        hour: row._id,
        label: formatHourLabel(row._id),
        span: formatHourSpan(row._id),
        arrivals: row.arrivals,
        avgWaitSec: Math.round(row.avgWaitSec || 0),
        avgWaitMin: waitMin
      });
    }
  });

  hours.sort((a, b) => a.hour - b.hour);

  return {
    hours,
    range,
    includeSimulated: !!includeSimulated
  };
}

/**
 * 4.7 Best Time to Visit (last 7 days)
 * Returns the three hours with the lowest average wait time
 */
async function getBestTime(branchId, options = {}) {
  const { serviceId = null } = options;
  const bId = new mongoose.Types.ObjectId(branchId);

  const match = {
    branchId: bId,
    dayKey: { $in: getLast7Days() },
    actualWaitSec: { $gt: 0 }
  };

  if (serviceId) {
    match.serviceId = new mongoose.Types.ObjectId(serviceId);
  }

  const aggResults = await Token.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $hour: { date: '$joinedAt', timezone: 'Asia/Karachi' } },
        arrivals: { $sum: 1 },
        avgWaitSec: { $avg: '$actualWaitSec' }
      }
    },
    // Filter to standard visiting hours 9 AM to 5 PM
    { $match: { _id: { $gte: 9, $lte: 17 } } },
    { $sort: { avgWaitSec: 1 } },
    { $limit: 3 }
  ]);

  let bestHours = aggResults.map((r) => {
    const sec = Math.round(r.avgWaitSec || 0);
    return {
      hour: r._id,
      label: formatHourSpan(r._id),
      avgWaitSec: sec,
      avgWaitMin: sec > 0 ? Math.round((sec / 60) * 10) / 10 : 0,
      arrivals: r.arrivals
    };
  });

  // Fallback defaults if not enough historical records
  if (bestHours.length === 0) {
    bestHours = [
      { hour: 14, label: '2 to 3 pm', avgWaitSec: 180, avgWaitMin: 3, arrivals: 12 },
      { hour: 9, label: '9 to 10 am', avgWaitSec: 240, avgWaitMin: 4, arrivals: 15 },
      { hour: 16, label: '4 to 5 pm', avgWaitSec: 300, avgWaitMin: 5, arrivals: 18 }
    ];
  }

  const quietestHour = bestHours[0];

  return {
    bestHours,
    quietestHour,
    label: quietestHour ? quietestHour.label : '2 to 3 pm'
  };
}

/**
 * 4.8 Per-Counter Performance
 * Groups completed tokens by counter, returns served count and avg service duration
 */
async function getCounterPerformance(branchId, options = {}) {
  const { range = 'today', includeSimulated = true, dayKey = getDayKey() } = options;

  const bId = new mongoose.Types.ObjectId(branchId);
  const match = {
    branchId: bId,
    status: 'completed',
    counterId: { $ne: null }
  };

  if (range === '7days' || range === '7d' || range === 'week') {
    match.dayKey = { $in: getLast7Days() };
  } else {
    match.dayKey = dayKey;
  }

  if (!includeSimulated) {
    match.isSimulated = false;
  }

  // Aggregation per Backendschema 4.8
  const aggResults = await Token.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$counterId',
        served: { $sum: 1 },
        avgSvcSec: { $avg: '$serviceDurationSec' }
      }
    }
  ]);

  const mapByCounterId = {};
  aggResults.forEach((row) => {
    if (row._id) {
      mapByCounterId[row._id.toString()] = {
        served: row.served,
        avgSvcSec: Math.round(row.avgSvcSec || 0)
      };
    }
  });

  // Fetch all counters in the branch so every counter is displayed
  const counters = await Counter.find({ branchId: bId })
    .populate('serviceIds', 'name prefix')
    .sort({ number: 1 });

  const counterList = counters.map((c) => {
    const data = mapByCounterId[c._id.toString()] || { served: 0, avgSvcSec: 0 };
    const avgSvcMin = data.avgSvcSec > 0 ? Math.round((data.avgSvcSec / 60) * 10) / 10 : 0;
    return {
      counterId: c._id,
      name: c.name,
      number: c.number,
      status: c.status,
      services: (c.serviceIds || []).map((s) => s.name).join(', '),
      served: data.served,
      avgSvcSec: data.avgSvcSec,
      avgSvcMin
    };
  });

  return {
    counters: counterList,
    range,
    includeSimulated: !!includeSimulated
  };
}

module.exports = {
  getSummary,
  getHourly,
  getBestTime,
  getCounterPerformance,
  getLast7Days
};
