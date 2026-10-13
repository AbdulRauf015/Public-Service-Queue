// test_stage4.js
// Automated test suite for Stage 4: Real-time Socket.IO and Staff Auth
require('dotenv').config();
const http = require('http');
const ioClient = require('socket.io-client');
const mongoose = require('mongoose');
const { Branch, Service, Counter, Token } = require('./src/models');

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runStage4Tests() {
  console.log('=== RUNNING STAGE 4 AUTOMATED TESTS ===\n');

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/baari');

  const branch = await Branch.findOne({ isDemo: true });
  if (!branch) throw new Error('Demo branch not found');
  const branchId = branch._id.toString();

  const labService = await Service.findOne({ branchId, prefix: 'L' });
  const regService = await Service.findOne({ branchId, prefix: 'R' });
  const counter1 = await Counter.findOne({ branchId, number: 1 });
  const counter2 = await Counter.findOne({ branchId, number: 2 });
  counter2.serviceIds = [labService._id];
  await counter2.save();

  // 1. Setup two Socket.IO clients to simulate two open browser tabs
  console.log('1. Setting up 2 Socket.IO clients (simulating 2 browser tabs)...');
  const socketTab1 = ioClient('http://localhost:3000');
  const socketTab2 = ioClient('http://localhost:3000');

  const tab1Events = [];
  const tab2Events = [];

  await new Promise((resolve) => {
    let connected = 0;
    const check = () => {
      connected++;
      if (connected === 2) resolve();
    };
    socketTab1.on('connect', check);
    socketTab2.on('connect', check);
  });

  console.log(`   Tab 1 connected: ${socketTab1.id}`);
  console.log(`   Tab 2 connected: ${socketTab2.id}`);

  // Both tabs join the branch room
  socketTab1.emit('join:branch', branchId);
  socketTab2.emit('join:branch', branchId);

  // Register listeners for real-time events
  socketTab1.on('queue:updated', (data) => tab1Events.push({ event: 'queue:updated', data }));
  socketTab1.on('token:called', (data) => tab1Events.push({ event: 'token:called', data }));
  socketTab1.on('counter:updated', (data) => tab1Events.push({ event: 'counter:updated', data }));

  socketTab2.on('queue:updated', (data) => tab2Events.push({ event: 'queue:updated', data }));
  socketTab2.on('token:called', (data) => tab2Events.push({ event: 'token:called', data }));
  socketTab2.on('counter:updated', (data) => tab2Events.push({ event: 'counter:updated', data }));

  // 2. Test Staff Login
  console.log('\n2. Testing Staff Login (POST /api/auth/login)...');
  const loginRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    email: 'staff@baari.test',
    password: 'demo1234'
  });

  console.log(`   Status: ${loginRes.status}`);
  console.log(`   User: ${loginRes.body.user && loginRes.body.user.name} (${loginRes.body.user && loginRes.body.user.role})`);
  console.log(`   Token received: ${loginRes.body.token ? 'YES (' + loginRes.body.token.substring(0, 24) + '...)' : 'NO'}`);

  if (loginRes.status !== 200 || !loginRes.body.token) {
    throw new Error('Staff login failed');
  }
  const token = loginRes.body.token;

  // Test invalid login
  console.log('\n3. Testing Invalid Login rejection...');
  const badLoginRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    email: 'staff@baari.test',
    password: 'wrongpassword'
  });
  console.log(`   Status: ${badLoginRes.status}, Error Code: ${badLoginRes.body.error && badLoginRes.body.error.code}`);
  if (badLoginRes.status !== 401) throw new Error('Invalid login should return 401');

  // Test unauthorized access
  console.log('\n4. Testing Unauthorized Route Protection...');
  const unauthRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/staff/queue?branchId=${branchId}`,
    method: 'GET'
  });
  console.log(`   Without token -> Status: ${unauthRes.status}, Error Code: ${unauthRes.body.error && unauthRes.body.error.code}`);
  if (unauthRes.status !== 401) throw new Error('Unauthenticated access should return 401');

  // 5. Test GET /api/staff/queue with valid token
  console.log('\n5. Testing GET /api/staff/queue with Bearer token...');
  const queueRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/staff/queue?branchId=${branchId}`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log(`   Status: ${queueRes.status}`);
  console.log(`   Branch: ${queueRes.body.branch && queueRes.body.branch.name}`);
  console.log(`   Counters: ${queueRes.body.counters && queueRes.body.counters.length}`);
  console.log(`   Waiting tokens: ${queueRes.body.totalWaiting}`);
  if (queueRes.status !== 200 || !queueRes.body.counters) throw new Error('GET /api/staff/queue failed');

  // 6. Test Counter Status change
  console.log('\n6. Testing POST /api/counters/:id/status...');
  const counterStatusRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/counters/${counter1._id}/status`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  }, { status: 'break' });

  console.log(`   Counter 1 set to 'break' -> Status: ${counterStatusRes.status}, New status: ${counterStatusRes.body.counter && counterStatusRes.body.counter.status}`);
  if (counterStatusRes.status !== 200 || counterStatusRes.body.counter.status !== 'break') {
    throw new Error('Counter status update failed');
  }

  // Restore counter 1 to open
  await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/counters/${counter1._id}/status`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  }, { status: 'open' });

  // 7. Test Call Next
  console.log('\n7. Testing POST /api/counters/:id/call-next...');
  // Create a waiting token for counter 2
  const now = new Date();
  const testWaitingToken = await Token.create({
    branchId,
    serviceId: labService._id,
    publicId: 's4_call_' + Math.random().toString(36).substring(7),
    number: 994,
    code: 'L-994',
    dayKey: '2026-10-13',
    priorityType: 'normal',
    bonusMinutes: 0,
    joinedAt: now,
    effectiveTime: now,
    status: 'waiting'
  });

  counter2.status = 'open';
  counter2.currentTokenId = null;
  await counter2.save();

  const callNextRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/counters/${counter2._id}/call-next`,
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log(`   call-next Status: ${callNextRes.status}`);
  console.log(`   Called token: Code=${callNextRes.body.token && callNextRes.body.token.code}, Status=${callNextRes.body.token && callNextRes.body.token.status}`);
  if (callNextRes.status !== 200 || !callNextRes.body.token) throw new Error('Call next failed');
  const calledToken = callNextRes.body.token;

  // 8. Test Start Serving and Complete
  console.log('\n8. Testing POST /api/tokens/:id/start & complete...');
  const startRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/tokens/${calledToken._id}/start`,
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log(`   Start serving Status: ${startRes.status}, Token status: ${startRes.body.token && startRes.body.token.status}`);
  if (startRes.status !== 200 || startRes.body.token.status !== 'serving') throw new Error('Start serving failed');

  const completeRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/tokens/${calledToken._id}/complete`,
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log(`   Complete token Status: ${completeRes.status}, Token status: ${completeRes.body.token && completeRes.body.token.status}`);
  if (completeRes.status !== 200 || completeRes.body.token.status !== 'completed') throw new Error('Complete token failed');

  // 9. Test Walk-in Token
  console.log('\n9. Testing POST /api/tokens/walk-in (Assisted visitor)...');
  const walkInRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/tokens/walk-in',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  }, {
    branchId,
    serviceId: regService._id.toString(),
    priorityType: 'normal',
    customerName: 'Baba Raza (Assisted Walk-in)'
  });

  console.log(`   Walk-in Status: ${walkInRes.status}`);
  console.log(`   Token Code: ${walkInRes.body.token && walkInRes.body.token.code}, Channel: ${walkInRes.body.token && walkInRes.body.token.channel}`);
  console.log(`   Printable ticket info: ${walkInRes.body.printable && walkInRes.body.printable.serviceName}, QR Data URL present: ${!!(walkInRes.body.printable && walkInRes.body.printable.qrDataUrl)}`);
  if (walkInRes.status !== 201 || walkInRes.body.token.channel !== 'walkin' || !walkInRes.body.printable.qrDataUrl) {
    throw new Error('Walk-in token generation failed');
  }

  // Allow 500ms for all socket events to propagate
  await new Promise((r) => setTimeout(r, 500));

  // 10. Verify Socket.IO Real-time Events Delivery
  console.log('\n10. Verifying Socket.IO Real-time Events received across Tab 1 & Tab 2...');
  console.log(`   Tab 1 total events received: ${tab1Events.length}`);
  console.log(`   Tab 2 total events received: ${tab2Events.length}`);

  const tab1EventNames = tab1Events.map(e => e.event);
  const tab2EventNames = tab2Events.map(e => e.event);
  console.log(`   Tab 1 event types: ${[...new Set(tab1EventNames)].join(', ')}`);
  console.log(`   Tab 2 event types: ${[...new Set(tab2EventNames)].join(', ')}`);

  if (!tab1EventNames.includes('token:called') || !tab2EventNames.includes('token:called')) {
    throw new Error('token:called event was not delivered to both tabs');
  }
  if (!tab1EventNames.includes('queue:updated') || !tab2EventNames.includes('queue:updated')) {
    throw new Error('queue:updated event was not delivered to both tabs');
  }
  if (!tab1EventNames.includes('counter:updated') || !tab2EventNames.includes('counter:updated')) {
    throw new Error('counter:updated event was not delivered to both tabs');
  }

  console.log('   Real-time multi-tab socket synchronization fully verified!');

  // Cleanup
  socketTab1.disconnect();
  socketTab2.disconnect();
  await Token.deleteOne({ _id: walkInRes.body.token._id });
  await mongoose.disconnect();

  console.log('\n>>> ALL STAGE 4 TESTS PASSED PERFECTLY! <<<');
}

runStage4Tests().catch(err => {
  console.error('\nSTAGE 4 TEST SUITE FAILED:', err);
  process.exit(1);
});
