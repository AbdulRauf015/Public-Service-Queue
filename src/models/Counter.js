// src/models/Counter.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const CounterSchema = new Schema({
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
  name: { type: String, required: true }, // "Counter 1"
  number: { type: Number, required: true },
  serviceIds: [{ type: Schema.Types.ObjectId, ref: 'Service' }],
  status: { type: String, enum: ['open', 'closed', 'break'], default: 'closed', index: true },
  currentTokenId: { type: Schema.Types.ObjectId, ref: 'Token', default: null },
  staffId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  statusSince: { type: Date, default: Date.now }, // used by Copilot (paused too long)
  isSimulated: { type: Boolean, default: false }
}, { timestamps: true });

CounterSchema.index({ branchId: 1, number: 1 }, { unique: true });

module.exports = mongoose.model('Counter', CounterSchema);
