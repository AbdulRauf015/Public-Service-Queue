// src/models/Service.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const ServiceSchema = new Schema({
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
  name: { type: String, required: true }, // "Lab tests"
  nameUr: { type: String },
  nameSd: { type: String },
  prefix: { type: String, required: true, uppercase: true, maxlength: 2 }, // "L"
  isActive: { type: Boolean, default: true },

  // Learned timing (self-learning wait time)
  defaultServiceSec: { type: Number, default: 180 }, // seeded starting value
  emaServiceSec: { type: Number, default: 180 },     // updated after each completion
  sampleCount: { type: Number, default: 0 }          // drives confidence label
}, { timestamps: true });

ServiceSchema.index({ branchId: 1, prefix: 1 }, { unique: true });

module.exports = mongoose.model('Service', ServiceSchema);
