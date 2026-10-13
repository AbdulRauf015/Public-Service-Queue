// src/models/Sequence.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const SequenceSchema = new Schema({
  key: { type: String, unique: true, required: true }, // `${branchId}:${serviceId}:${dayKey}`
  seq: { type: Number, default: 0 }
});

module.exports = mongoose.model('Sequence', SequenceSchema);
