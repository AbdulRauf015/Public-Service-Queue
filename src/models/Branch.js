// src/models/Branch.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const BranchSchema = new Schema({
  name: { type: String, required: true, trim: true }, // "City Civic Center"
  type: { type: String, enum: ['hospital', 'bank', 'government', 'other'], default: 'government' },
  address: { type: String },
  isDemo: { type: Boolean, default: true },
  workingHours: {
    open: { type: String, default: '09:00' },
    close: { type: String, default: '17:00' }
  },

  settings: {
    graceSeconds: { type: Number, default: 90 }, // time to arrive after being called
    approachingAhead: { type: Number, default: 3 }, // "Almost your turn" threshold
    leaveBufferMinutes: { type: Number, default: 5 }, // extra margin for Smart Leave Alert
    alertThresholdMin: { type: Number, default: 15 }, // Copilot warns above this wait
    emaAlpha: { type: Number, default: 0.2 }, // learning speed for service time
    priorityBonusMinutes: { // transparent priority bonuses
      normal: { type: Number, default: 0 },
      senior: { type: Number, default: 20 },
      pregnant: { type: Number, default: 20 },
      disabled: { type: Number, default: 30 },
      emergency: { type: Number, default: 120 }
    },
    languages: { type: [String], default: ['en', 'ur', 'sd'] }
  }
}, { timestamps: true });

module.exports = mongoose.model('Branch', BranchSchema);
