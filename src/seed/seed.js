// src/seed/seed.js
// Seeds demo branch, services, counters, staff accounts, 7 days of history, and 8 live waiting tokens
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { Branch, Service, Counter, Token, QueueEvent, User, Sequence } = require('../models');
const { getDayKey, generatePublicId } = require('../utils/helpers');

async function seed() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/baari';
  console.log('Connecting to database for seeding...');
  await mongoose.connect(uri);

  // Clear existing collections
  console.log('Clearing old data...');
  await Promise.all([
    Branch.deleteMany({}),
    Service.deleteMany({}),
    Counter.deleteMany({}),
    Token.deleteMany({}),
    QueueEvent.deleteMany({}),
    User.deleteMany({}),
    Sequence.deleteMany({})
  ]);

  // 1. Create Demo Branch
  console.log('Creating demo branch...');
  const branch = await Branch.create({
    name: 'City Civic Center',
    type: 'government',
    address: 'Plot 42, Service Road, Civic Center',
    isDemo: true,
    workingHours: { open: '09:00', close: '17:00' },
    settings: {
      graceSeconds: 90,
      approachingAhead: 3,
      leaveBufferMinutes: 5,
      alertThresholdMin: 15,
      emaAlpha: 0.2,
      priorityBonusMinutes: {
        normal: 0,
        senior: 20,
        pregnant: 20,
        disabled: 30,
        emergency: 120
      },
      languages: ['en', 'ur', 'sd']
    }
  });

  // 2. Create Services
  console.log('Creating services...');
  const regService = await Service.create({
    branchId: branch._id,
    name: 'Registration',
    nameUr: 'رجسٹریشن',
    nameSd: 'رجسٽريشن',
    prefix: 'R',
    defaultServiceSec: 150,
    emaServiceSec: 145,
    sampleCount: 22
  });

  const labService = await Service.create({
    branchId: branch._id,
    name: 'Lab tests',
    nameUr: 'لیب ٹیسٹ',
    nameSd: 'ليب ٽيسٽ',
    prefix: 'L',
    defaultServiceSec: 240,
    emaServiceSec: 230,
    sampleCount: 24
  });

  const pharmService = await Service.create({
    branchId: branch._id,
    name: 'Pharmacy',
    nameUr: 'فارمیسی',
    nameSd: 'فارميسي',
    prefix: 'P',
    defaultServiceSec: 90,
    emaServiceSec: 85,
    sampleCount: 26
  });

  const services = [regService, labService, pharmService];

  // 3. Create Counters
  console.log('Creating counters...');
  const counter1 = await Counter.create({
    branchId: branch._id,
    name: 'Counter 1',
    number: 1,
    serviceIds: [regService._id, pharmService._id],
    status: 'open',
    isSimulated: false
  });

  const counter2 = await Counter.create({
    branchId: branch._id,
    name: 'Counter 2',
    number: 2,
    serviceIds: [labService._id],
    status: 'open',
    isSimulated: false
  });

  const counter3 = await Counter.create({
    branchId: branch._id,
    name: 'Counter 3',
    number: 3,
    serviceIds: [labService._id, regService._id],
    status: 'closed', // Left closed for live "Open Counter" demo!
    isSimulated: false
  });

  const counter4 = await Counter.create({
    branchId: branch._id,
    name: 'Counter 4',
    number: 4,
    serviceIds: [pharmService._id],
    status: 'open',
    isSimulated: false
  });

  const counters = [counter1, counter2, counter3, counter4];

  // 4. Create Staff Accounts
  console.log('Creating staff users...');
  const passwordHash = await bcrypt.hash('demo1234', 10);
  await User.create([
    {
      name: 'Imran (Operator)',
      email: 'staff@baari.test',
      passwordHash,
      role: 'operator',
      branchId: branch._id
    },
    {
      name: 'Dr. Sana (Admin)',
      email: 'admin@baari.test',
      passwordHash,
      role: 'admin',
      branchId: branch._id
    }
  ]);

  // 5. Generate 7 Days of Historical Tokens
  console.log('Generating 7 days of simulated historical tokens...');
  const today = new Date();
  const historicalTokens = [];
  const historicalEvents = [];

  // Hourly distribution weights (09:00 to 17:00): busy 10-12 (wt 5-6) & 15-17 (wt 5), quiet at lunch 12-14 (wt 2)
  const hourlyArrivals = {
    9: 3, 10: 6, 11: 7, 12: 2, 13: 2, 14: 4, 15: 6, 16: 5
  };

  for (let dayOffset = 7; dayOffset >= 1; dayOffset--) {
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() - dayOffset);
    const dayKey = getDayKey(targetDate);

    let daySeq = { R: 0, L: 0, P: 0 };

    for (const [hourStr, count] of Object.entries(hourlyArrivals)) {
      const hour = parseInt(hourStr, 10);

      for (let i = 0; i < count; i++) {
        // Pick random service
        const svc = services[Math.floor(Math.random() * services.length)];
        daySeq[svc.prefix]++;
        const num = daySeq[svc.prefix];
        const code = `${svc.prefix}-${String(num).padStart(3, '0')}`;

        // Random minute within hour
        const joined = new Date(targetDate);
        joined.setHours(hour, Math.floor(Math.random() * 55), Math.floor(Math.random() * 50));

        // Sim wait & service duration
        const waitSec = Math.floor(300 + Math.random() * 600); // 5 to 15 min wait
        const svcSec = Math.floor(svc.defaultServiceSec * (0.8 + Math.random() * 0.4)); // ±20%
        const called = new Date(joined.getTime() + waitSec * 1000);
        const completed = new Date(called.getTime() + svcSec * 1000);

        // Find counter that supports this service
        const matchingCounters = counters.filter(c => c.serviceIds.includes(svc._id));
        const pickedCounter = matchingCounters[Math.floor(Math.random() * matchingCounters.length)];

        // Decide if no_show (~6% chance)
        const isNoShow = Math.random() < 0.06;
        const status = isNoShow ? 'no_show' : 'completed';

        const tokenDoc = {
          branchId: branch._id,
          serviceId: svc._id,
          publicId: generatePublicId(),
          number: num,
          code,
          dayKey,
          isSimulated: true,
          status,
          counterId: pickedCounter._id,
          priorityType: 'normal',
          bonusMinutes: 0,
          effectiveTime: joined,
          joinedAt: joined,
          calledAt: called,
          servingStartedAt: called,
          completedAt: isNoShow ? null : completed,
          actualWaitSec: waitSec,
          serviceDurationSec: isNoShow ? null : svcSec,
          feedback: isNoShow ? null : { rating: Math.floor(4 + Math.random() * 2) }
        };
        historicalTokens.push(tokenDoc);
      }
    }
  }

  await Token.insertMany(historicalTokens);
  console.log(`Inserted ${historicalTokens.length} historical tokens`);

  // 6. Live Starter Queue (16 waiting tokens for today)
  console.log('Generating 16 live waiting tokens for today...');
  const todayKey = getDayKey(today);
  const liveTokensData = [
    // Registration (3)
    { svc: regService, priority: 'normal', name: 'Zubair Khan', bonus: 0 },
    { svc: regService, priority: 'senior', name: 'Baba Raza', bonus: 20 },
    { svc: regService, priority: 'normal', name: 'Noman Ali', bonus: 0 },
    // Lab tests (11) -> wait with 2 counters is ~21 min (20-25 min range)
    { svc: labService, priority: 'normal', name: 'Ayesha Tariq', bonus: 0 },
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
    // Pharmacy (2)
    { svc: pharmService, priority: 'normal', name: 'Hamza Ali', bonus: 0 },
    { svc: pharmService, priority: 'disabled', name: 'Usman Ghani', bonus: 30 }
  ];

  const todaySeq = { R: 0, L: 0, P: 0 };
  const createdLiveTokens = [];

  for (let idx = 0; idx < liveTokensData.length; idx++) {
    const item = liveTokensData[idx];
    todaySeq[item.svc.prefix]++;
    const num = todaySeq[item.svc.prefix];
    const code = `${item.svc.prefix}-${String(num).padStart(3, '0')}`;

    // Joined 5 to 15 minutes ago
    const joinedAt = new Date(Date.now() - (15 - idx) * 60 * 1000);
    const effectiveTime = new Date(joinedAt.getTime() - item.bonus * 60 * 1000);

    const liveToken = await Token.create({
      branchId: branch._id,
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
      travelMinutes: item.name === 'Ayesha Tariq' ? 20 : null
    });

    createdLiveTokens.push(liveToken);

    await QueueEvent.create({
      branchId: branch._id,
      tokenId: liveToken._id,
      serviceId: item.svc._id,
      type: 'joined',
      at: joinedAt,
      isSimulated: false
    });
  }

  // Update sequences for today so future tokens continue from the current number
  for (const [prefix, maxNum] of Object.entries(todaySeq)) {
    const svc = services.find(s => s.prefix === prefix);
    const key = `${branch._id}:${svc._id}:${todayKey}`;
    await Sequence.create({ key, seq: maxNum });
  }

  console.log('Seed completed successfully!');
  console.log(`Branch ID: ${branch._id}`);
  console.log('Services: Registration (R), Lab tests (L), Pharmacy (P)');
  console.log('Live tokens created:', createdLiveTokens.map(t => `${t.code} (${t.priorityType})`).join(', '));

  await mongoose.disconnect();
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}

module.exports = seed;
