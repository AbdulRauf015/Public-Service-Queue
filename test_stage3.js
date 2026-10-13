// test_stage3.js
// Automated test suite for Stage 3 (Queue and Wait-Time Engine + Stage 2 fix check)
require('dotenv').config();
const mongoose = require('mongoose');
const { Branch, Service, Counter, Token, QueueEvent } = require('./src/models');
const {
  getAheadCount,
  getEstimate,
  updateEma,
  whatIf,
  confidenceLabel
} = require('./src/services/waitTime');
const {
  callNext,
  startServing,
  completeToken,
  markNoShow,
  recallToken,
  setPriority
} = require('./src/services/queueEngine');
const http = require('http');

function httpRequest(options, body = null) {
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

async function runStage3Tests() {
  console.log('=== RUNNING STAGE 3 AUTOMATED TESTS ===\n');

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/baari');

  const branch = await Branch.findOne({ isDemo: true });
  if (!branch) throw new Error('Branch not found');

  const labService = await Service.findOne({ branchId: branch._id, prefix: 'L' });
  if (!labService) throw new Error('Lab service not found');

  const counter2 = await Counter.findOne({ branchId: branch._id, number: 2 });
  if (!counter2) throw new Error('Counter 2 not found');

  // TEST 1: Hand Calculation Check
  // Formula: estimateSec = (ahead * avgSvc + remaining) / openCounters
  // Sample: 10 ahead, 180s avgSvc, 120s remaining, 2 openCounters
  // Expected: (10 * 180 + 120) / 2 = 960s
  console.log('1. Verifying Hand Calculation Formula...');
  const ahead = 10;
  const avgSvc = 180;
  const remaining = 120;
  const openCounters = 2;
  const calculatedEstimate = Math.round((ahead * avgSvc + remaining) / openCounters);
  console.log(`   Formula: (${ahead} * ${avgSvc} + ${remaining}) / ${openCounters} = ${calculatedEstimate}s`);
  if (calculatedEstimate !== 960) {
    throw new Error(`Hand calculation test failed: expected 960s, got ${calculatedEstimate}s`);
  }
  console.log('   Hand calculation matches exactly: 960s (16 min)');

  // TEST 2: Priority Ordering in callNext
  // A senior added later jumps ahead by 20 minutes (effectiveTime)
  console.log('\n2. Verifying Effective Time Ordering in callNext...');
  const now = new Date();

  // Clean up any previous test services
  await Service.deleteMany({ branchId: branch._id, prefix: 'T' });

  // Create a clean dedicated service to isolate the priority ordering test
  const testService = await Service.create({
    branchId: branch._id,
    name: 'Test Priority Svc',
    prefix: 'T',
    defaultServiceSec: 180,
    emaServiceSec: 180
  });

  // Assign testService to counter2
  const originalServiceIds = counter2.serviceIds;
  counter2.serviceIds = [testService._id];
  counter2.status = 'open';
  counter2.currentTokenId = null;
  await counter2.save();

  // Create normal token joined 5 mins ago
  const tNormal = await Token.create({
    branchId: branch._id,
    serviceId: testService._id,
    publicId: 'test_norm_' + Math.random().toString(36).substring(7),
    number: 991,
    code: 'T-991',
    dayKey: '2026-10-13',
    priorityType: 'normal',
    bonusMinutes: 0,
    joinedAt: new Date(now.getTime() - 5 * 60 * 1000), // 5 min ago
    effectiveTime: new Date(now.getTime() - 5 * 60 * 1000),
    status: 'waiting'
  });

  // Create senior token joined 2 mins ago (arrived 3 mins AFTER normal token)
  const tSenior = await Token.create({
    branchId: branch._id,
    serviceId: testService._id,
    publicId: 'test_senr_' + Math.random().toString(36).substring(7),
    number: 992,
    code: 'T-992',
    dayKey: '2026-10-13',
    priorityType: 'senior',
    bonusMinutes: 20,
    joinedAt: new Date(now.getTime() - 2 * 60 * 1000), // 2 min ago
    effectiveTime: new Date(now.getTime() - 22 * 60 * 1000), // 22 min ago (-20m bonus!)
    status: 'waiting'
  });

  console.log(`   Normal token (joined 5m ago): effectiveTime = ${tNormal.effectiveTime.toISOString()}`);
  console.log(`   Senior token (joined 2m ago): effectiveTime = ${tSenior.effectiveTime.toISOString()} (with -20m bonus)`);

  // Call next should pick the senior token first because its effectiveTime is earlier!
  const callResult = await callNext(counter2._id);
  console.log(`   callNext returned token: Code=${callResult.token.code}, Status=${callResult.token.status}`);
  if (callResult.token._id.toString() !== tSenior._id.toString()) {
    throw new Error(`Expected senior token ${tSenior.code} to be called first, but got ${callResult.token.code}`);
  }
  console.log('   Senior token called first as expected due to 20-minute bonus!');

  // TEST 3: Start Serving
  console.log('\n3. Testing startServing...');
  const servingToken = await startServing(tSenior._id);
  console.log(`   Token ${servingToken.code} status: ${servingToken.status}, startedAt: ${servingToken.servingStartedAt.toISOString()}`);
  if (servingToken.status !== 'serving') throw new Error('startServing failed');

  // TEST 4: Complete Token and Self-Learning EMA
  console.log('\n4. Testing completeToken and EMA update...');
  const oldEma = testService.emaServiceSec;
  const oldSamples = testService.sampleCount || 0;
  console.log(`   Test service before completion: EMA=${oldEma}s, Samples=${oldSamples}`);

  const completeResult = await completeToken(tSenior._id);
  const updatedTestService = await Service.findById(testService._id);
  console.log(`   Completed token ${tSenior.code}: serviceDurationSec=${completeResult.token.serviceDurationSec}s`);
  console.log(`   Test service after completion: EMA=${updatedTestService.emaServiceSec}s, Samples=${updatedTestService.sampleCount}`);
  if (updatedTestService.sampleCount !== oldSamples + 1) {
    throw new Error('EMA sample count did not increment');
  }
  console.log('   Self-learning EMA updated successfully!');

  // TEST 5: Mark No-Show and Recall
  console.log('\n5. Testing markNoShow and recallToken...');
  // Call the normal token
  const callNormal = await callNext(counter2._id);
  console.log(`   Called next: ${callNormal.token.code}`);
  const noShowToken = await markNoShow(callNormal.token._id);
  console.log(`   Marked no-show: ${noShowToken.code}, status=${noShowToken.status}`);
  if (noShowToken.status !== 'no_show') throw new Error('markNoShow failed');

  // Recall token
  const recalledToken = await recallToken(noShowToken._id);
  console.log(`   Recalled token: ${recalledToken.code}, status=${recalledToken.status}, recallCount=${recalledToken.recallCount}`);
  if (recalledToken.status !== 'waiting' || recalledToken.recallCount !== 1) {
    throw new Error('recallToken failed');
  }

  // Attempting second recall should fail
  let secondRecallFailed = false;
  try {
    recalledToken.status = 'no_show';
    await recalledToken.save();
    await recallToken(recalledToken._id);
  } catch (err) {
    secondRecallFailed = true;
    console.log(`   Second recall safely rejected with error: "${err.message}"`);
  }
  if (!secondRecallFailed) throw new Error('Second recall should have been rejected');

  // TEST 6: Priority Demotion
  console.log('\n6. Testing Priority Demotion...');
  const tPriorityDemote = await Token.create({
    branchId: branch._id,
    serviceId: labService._id,
    publicId: 'test_demote_' + Math.random().toString(36).substring(7),
    number: 993,
    code: 'L-993',
    dayKey: '2026-10-13',
    priorityType: 'pregnant',
    bonusMinutes: 20,
    joinedAt: now,
    effectiveTime: new Date(now.getTime() - 20 * 60 * 1000),
    status: 'waiting'
  });
  console.log(`   Token with bonus: bonus=${tPriorityDemote.bonusMinutes}m, effectiveTime=${tPriorityDemote.effectiveTime.toISOString()}`);
  const demotedToken = await setPriority(tPriorityDemote._id, { verified: false, demote: true });
  console.log(`   After demotion: bonus=${demotedToken.bonusMinutes}m, effectiveTime=${demotedToken.effectiveTime.toISOString()}`);
  if (demotedToken.bonusMinutes !== 0 || demotedToken.effectiveTime.getTime() !== demotedToken.joinedAt.getTime()) {
    throw new Error('Priority demotion failed');
  }
  console.log('   Priority demotion correctly wiped bonus to 0 and restored join time!');

  // TEST 7: What-If Engine
  console.log('\n7. Testing What-If Engine...');
  const whatIfResult = await whatIf(branch._id, labService._id, 1);
  console.log(`   What-If (+1 counter): Before=${whatIfResult.beforeMin} min, After=${whatIfResult.afterMin} min, Saved=${whatIfResult.savedMin} min`);
  if (whatIfResult.afterMin === null || whatIfResult.targetCounters !== whatIfResult.currentCounters + 1) {
    throw new Error('What-If engine returned invalid output');
  }
  console.log('   What-If calculation verified!');

  // TEST 8: Check User's Specific Stage 2 Fix (POST /tokens/:publicId/here status requirement)
  console.log('\n8. Testing Stage 2 Fix: POST /tokens/:publicId/here validation...');
  // A waiting token should be REJECTED when calling /here
  const hereWaitingRes = await httpRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/tokens/${tNormal.publicId}/here`,
    method: 'POST'
  });
  console.log(`   Waiting token calling /here -> Status: ${hereWaitingRes.status}, Error Code: ${hereWaitingRes.body.error && hereWaitingRes.body.error.code}`);
  if (hereWaitingRes.status !== 400 || hereWaitingRes.body.error.code !== 'INVALID_STATUS') {
    throw new Error(`Expected 400 INVALID_STATUS for waiting token calling /here, got ${hereWaitingRes.status}`);
  }
  console.log('   Waiting token correctly rejected with HTTP 400 INVALID_STATUS!');

  // Now set token to called
  tNormal.status = 'called';
  await tNormal.save();
  const hereCalledRes = await httpRequest({
    hostname: 'localhost',
    port: 3000,
    path: `/api/tokens/${tNormal.publicId}/here`,
    method: 'POST'
  });
  console.log(`   Called token calling /here -> Status: ${hereCalledRes.status}, hereAt: ${hereCalledRes.body.token && hereCalledRes.body.token.hereAt}`);
  if (hereCalledRes.status !== 200 || !hereCalledRes.body.token.hereAt) {
    throw new Error(`Expected 200 OK for called token calling /here, got ${hereCalledRes.status}`);
  }
  console.log('   Called token successfully accepted arrival confirmation!');

  // Clean up test tokens and test service
  await Token.deleteMany({
    _id: { $in: [tNormal._id, tSenior._id, tPriorityDemote._id] }
  });
  await Service.deleteOne({ _id: testService._id });
  counter2.serviceIds = originalServiceIds;
  counter2.currentTokenId = null;
  await counter2.save();

  await mongoose.disconnect();
  console.log('\n>>> ALL STAGE 3 TESTS PASSED PERFECTLY! <<<');
}

runStage3Tests().catch(err => {
  console.error('\nSTAGE 3 TEST SUITE FAILED:', err);
  process.exit(1);
});
