// test_stage2.js
// Automated test suite for Stage 2
const http = require('http');

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
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== RUNNING STAGE 2 AUTOMATED TESTS ===\n');

  // 1. Health check
  console.log('1. Testing /api/health...');
  const healthRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/health',
    method: 'GET'
  });
  console.log(`   Status: ${healthRes.status}, Message: ${healthRes.body.message}`);
  if (healthRes.status !== 200) throw new Error('Health check failed');

  // Need a branchId from the database
  const mongoose = require('mongoose');
  require('dotenv').config();
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/baari');
  const { Branch, Service } = require('./src/models');
  const branch = await Branch.findOne({ isDemo: true });
  if (!branch) throw new Error('Demo branch not found in DB. Run seed first.');
  const branchId = branch._id.toString();

  const labService = await Service.findOne({ branchId, prefix: 'L' });
  if (!labService) throw new Error('Lab service not found');
  const labServiceId = labService._id.toString();

  // 2. Test GET /api/branches/:branchId/public
  console.log('\n2. Testing GET /api/branches/:branchId/public...');
  const branchRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/branches/${branchId}/public`,
    method: 'GET'
  });
  console.log(`   Status: ${branchRes.status}`);
  console.log(`   Branch Name: ${branchRes.body.branch.name}`);
  console.log(`   Total Waiting: ${branchRes.body.totalWaiting}, Busy Level: ${branchRes.body.busyLevel}`);
  console.log(`   Services loaded: ${branchRes.body.services.map(s => `${s.name} (${s.prefix}, wait: ${s.waitingCount})`).join(', ')}`);
  if (branchRes.status !== 200 || branchRes.body.services.length !== 3) {
    throw new Error('Public branch endpoint test failed');
  }

  // 3. Test POST /api/tokens (First token creation)
  console.log('\n3. Testing POST /api/tokens (Token 1)...');
  const token1Res = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/tokens',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    branchId,
    serviceId: labServiceId,
    customerName: 'Test Citizen 1',
    priorityType: 'normal',
    language: 'en'
  });
  console.log(`   Status: ${token1Res.status}`);
  const t1 = token1Res.body.token;
  console.log(`   Created Token 1: Code=${t1.code}, Number=${t1.number}, PublicId=${t1.publicId}`);
  if (token1Res.status !== 201 || !t1.code.startsWith('L-')) {
    throw new Error('Token 1 creation failed');
  }

  // 4. Test POST /api/tokens (Second token creation - checking atomic sequential increment)
  console.log('\n4. Testing POST /api/tokens (Token 2 - Senior priority)...');
  const token2Res = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/tokens',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    branchId,
    serviceId: labServiceId,
    customerName: 'Senior Citizen 2',
    priorityType: 'senior',
    language: 'ur',
    travelMinutes: 15
  });
  console.log(`   Status: ${token2Res.status}`);
  const t2 = token2Res.body.token;
  console.log(`   Created Token 2: Code=${t2.code}, Number=${t2.number}, PublicId=${t2.publicId}`);
  console.log(`   Bonus Minutes: ${t2.bonusMinutes} min`);
  if (token2Res.status !== 201 || t2.number !== t1.number + 1) {
    throw new Error(`Sequential atomic increment failed: expected ${t1.number + 1}, got ${t2.number}`);
  }

  // 5. Test GET /api/tokens/:publicId
  console.log('\n5. Testing GET /api/tokens/:publicId...');
  const tokenDetailsRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/tokens/${t2.publicId}`,
    method: 'GET'
  });
  console.log(`   Status: ${tokenDetailsRes.status}`);
  console.log(`   Retrieved Code: ${tokenDetailsRes.body.token.code}`);
  console.log(`   People Ahead: ${tokenDetailsRes.body.queue.ahead}`);
  console.log(`   Estimated Wait: ${tokenDetailsRes.body.queue.estimateSec}s (${Math.round(tokenDetailsRes.body.queue.estimateSec / 60)} min)`);
  console.log(`   Range: ${tokenDetailsRes.body.queue.range.low}s - ${tokenDetailsRes.body.queue.range.high}s`);
  console.log(`   Confidence: ${tokenDetailsRes.body.queue.confidence}`);
  if (tokenDetailsRes.status !== 200 || tokenDetailsRes.body.token.publicId !== t2.publicId) {
    throw new Error('GET /api/tokens/:publicId failed');
  }

  // 6. Test PATCH /api/tokens/:publicId
  console.log('\n6. Testing PATCH /api/tokens/:publicId (update travelMinutes)...');
  const patchRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/tokens/${t2.publicId}`,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' }
  }, {
    travelMinutes: 25,
    language: 'sd'
  });
  console.log(`   Status: ${patchRes.status}`);
  console.log(`   Updated travelMinutes: ${patchRes.body.token.travelMinutes}, language: ${patchRes.body.token.language}`);
  if (patchRes.status !== 200 || patchRes.body.token.travelMinutes !== 25) {
    throw new Error('PATCH /api/tokens/:publicId failed');
  }

  // 7. Test POST /api/tokens/:publicId/here
  console.log('\n7. Testing POST /api/tokens/:publicId/here...');
  const hereRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/tokens/${t2.publicId}/here`,
    method: 'POST'
  });
  console.log(`   Status: ${hereRes.status}, hereAt recorded: ${hereRes.body.token.hereAt}`);
  if (hereRes.status !== 200 || !hereRes.body.token.hereAt) {
    throw new Error('POST /api/tokens/:publicId/here failed');
  }

  // 8. Test POST /api/tokens/:publicId/cancel
  console.log('\n8. Testing POST /api/tokens/:publicId/cancel...');
  const cancelRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/tokens/${t1.publicId}/cancel`,
    method: 'POST'
  });
  console.log(`   Status: ${cancelRes.status}, Token status: ${cancelRes.body.token.status}`);
  if (cancelRes.status !== 200 || cancelRes.body.token.status !== 'cancelled') {
    throw new Error('POST /api/tokens/:publicId/cancel failed');
  }

  await mongoose.disconnect();
  console.log('\n>>> ALL STAGE 2 TESTS PASSED PERFECTLY! <<<');
}

runTests().catch(err => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
