// src/models/Token.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const TokenSchema = new Schema({
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
  publicId: { type: String, required: true, unique: true }, // random 12 chars, used in URLs
  number: { type: Number, required: true }, // 14
  code: { type: String, required: true }, // "L-014"
  dayKey: { type: String, required: true }, // "YYYY-MM-DD" Asia/Karachi

  customerName: { type: String, default: '' },
  language: { type: String, enum: ['en', 'ur', 'sd'], default: 'en' },
  channel: { type: String, enum: ['web', 'qr', 'walkin'], default: 'web' },
  isSimulated: { type: Boolean, default: false },

  // Priority lane
  priorityType: {
    type: String,
    enum: ['normal', 'senior', 'pregnant', 'disabled', 'emergency'],
    default: 'normal'
  },
  priorityVerified: { type: Boolean, default: null }, // null = not checked yet
  bonusMinutes: { type: Number, default: 0 },
  effectiveTime: { type: Date, required: true }, // createdAt - bonus. Queue sorts by this.

  // State
  status: {
    type: String,
    enum: ['waiting', 'called', 'serving', 'completed', 'no_show', 'cancelled'],
    default: 'waiting'
  },
  counterId: { type: Schema.Types.ObjectId, ref: 'Counter', default: null },
  recallCount: { type: Number, default: 0 }, // one-time recall allowed

  // Smart Leave Alert
  travelMinutes: { type: Number, default: null },
  notified: {
    leaveNow: { type: Boolean, default: false },
    almost: { type: Boolean, default: false },
    called: { type: Boolean, default: false }
  },

  // Timeline
  joinedAt: { type: Date, default: Date.now },
  calledAt: { type: Date },
  hereAt: { type: Date },
  servingStartedAt: { type: Date },
  completedAt: { type: Date },

  // For analytics and honesty
  estimateAtJoinSec: { type: Number },
  actualWaitSec: { type: Number }, // calledAt - joinedAt in seconds
  serviceDurationSec: { type: Number }, // completedAt - servingStartedAt in seconds

  feedback: {
    rating: { type: Number, min: 1, max: 5 },
    comment: { type: String }
  }
}, { timestamps: true });

// Speed and queue ordering indexes
TokenSchema.index({ branchId: 1, serviceId: 1, status: 1, effectiveTime: 1 });
TokenSchema.index({ branchId: 1, dayKey: 1 });

module.exports = mongoose.model('Token', TokenSchema);
