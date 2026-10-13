// src/models/QueueEvent.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const QueueEventSchema = new Schema({
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
  tokenId: { type: Schema.Types.ObjectId, ref: 'Token' },
  serviceId: { type: Schema.Types.ObjectId, ref: 'Service' },
  counterId: { type: Schema.Types.ObjectId, ref: 'Counter' },
  type: {
    type: String,
    enum: [
      'joined', 'called', 'here', 'started', 'completed',
      'no_show', 'recalled', 'cancelled', 'transferred',
      'priority_verified', 'priority_rejected',
      'counter_opened', 'counter_closed', 'counter_break',
      'alert_leave_now', 'alert_almost', 'alert_called',
      'sim_rush'
    ],
    required: true
  },
  at: { type: Date, default: Date.now, index: true },
  meta: Schema.Types.Mixed, // e.g., { waitSec, durationSec }
  isSimulated: { type: Boolean, default: false }
});

QueueEventSchema.index({ branchId: 1, at: -1 });

module.exports = mongoose.model('QueueEvent', QueueEventSchema);
