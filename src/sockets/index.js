// src/sockets/index.js
// Socket.IO event setup and emitter utilities
const { Service, Counter, Token } = require('../models');
const { getServiceEstimate, getEstimate } = require('../services/waitTime');

/**
 * Setup Socket.IO connection and client listeners
 */
function setupSockets(io) {
  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // Join branch room (for staff, public displays, and join screens)
    socket.on('join:branch', (branchId) => {
      const room = `branch:${branchId}`;
      socket.join(room);
      console.log(`[Socket] ${socket.id} joined ${room}`);
      socket.emit('joined:branch', { branchId, room });
    });

    // Join token room (for customer tracking their specific token)
    socket.on('join:token', (publicId) => {
      const room = `token:${publicId}`;
      socket.join(room);
      console.log(`[Socket] ${socket.id} joined ${room}`);
      socket.emit('joined:token', { publicId, room });
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });
}

/**
 * Emit queue:updated to branch room with current waiting stats per service
 */
async function emitQueueUpdate(io, branchId) {
  if (!io || !branchId) return;

  try {
    const services = await Service.find({ branchId, isActive: true });
    const serviceStats = await Promise.all(
      services.map(async (svc) => {
        const est = await getServiceEstimate(branchId, svc._id);
        return {
          serviceId: svc._id,
          name: svc.name,
          prefix: svc.prefix,
          waiting: est.waitingCount,
          openCounters: est.openCounters,
          estimateSec: est.estimateSec,
          range: est.range,
          confidence: est.confidence
        };
      })
    );

    io.to(`branch:${branchId}`).emit('queue:updated', {
      branchId,
      services: serviceStats,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Socket] Error in emitQueueUpdate:', err.message);
  }
}

/**
 * Emit token:updated to specific token room
 */
async function emitTokenUpdate(io, publicId) {
  if (!io || !publicId) return;

  try {
    const token = await Token.findOne({ publicId })
      .populate('serviceId', 'name prefix emaServiceSec defaultServiceSec')
      .populate('counterId', 'name number status');

    if (!token) return;

    const est = await getEstimate(token);

    io.to(`token:${publicId}`).emit('token:updated', {
      publicId: token.publicId,
      code: token.code,
      status: token.status,
      ahead: est ? est.ahead : 0,
      estimateSec: est ? est.estimateSec : null,
      range: est ? est.range : null,
      counter: token.counterId ? { name: token.counterId.name, number: token.counterId.number } : null,
      token
    });
  } catch (err) {
    console.error('[Socket] Error in emitTokenUpdate:', err.message);
  }
}

/**
 * Emit token:called to both branch and token rooms
 */
function emitTokenCalled(io, branchId, publicId, code, counterName) {
  if (!io) return;
  const payload = {
    publicId,
    code,
    counterName,
    timestamp: new Date().toISOString()
  };

  io.to(`branch:${branchId}`).emit('token:called', payload);
  io.to(`token:${publicId}`).emit('token:called', payload);
}

/**
 * Emit counter:updated to branch room
 */
function emitCounterUpdate(io, branchId, counterId, status, currentToken) {
  if (!io || !branchId) return;
  io.to(`branch:${branchId}`).emit('counter:updated', {
    counterId,
    status,
    currentToken,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  setupSockets,
  emitQueueUpdate,
  emitTokenUpdate,
  emitTokenCalled,
  emitCounterUpdate
};
