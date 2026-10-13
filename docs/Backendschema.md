# Baari: Backend Schema

Database: **MongoDB** (Atlas free tier or local) with **Mongoose**.
Companion files: `PRD.md`, `TRD.md`, `UI-UX.md`, `Implementationplan.md`

---

## 1. Collections Overview

| Collection | Purpose |
|---|---|
| `branches` | A service location (hospital, bank, civic center) and its settings |
| `services` | What a branch offers (Registration, Lab, Pharmacy) and the learned average time |
| `counters` | Physical counters or desks and which services they can serve |
| `tokens` | One document per customer in the queue |
| `queueevents` | Append-only log of everything that happens (powers analytics and history) |
| `users` | Staff and admin accounts |
| `sequences` | Atomic daily number generator per branch and service |

### Relationships

```
Branch 1 ---- * Service
Branch 1 ---- * Counter
Branch 1 ---- * User (staff)
Service 1 ---- * Token
Counter * ---- * Service      (counter.serviceIds)
Counter 1 ---- 0..1 Token     (counter.currentTokenId)
Token 1 ---- * QueueEvent
```

---

## 2. Schemas (Mongoose)

### 2.1 Branch

```js
const BranchSchema = new Schema({
  name:        { type: String, required: true, trim: true },       // "City Civic Center"
  type:        { type: String, enum: ['hospital','bank','government','other'], default: 'government' },
  address:     { type: String },
  isDemo:      { type: Boolean, default: true },
  workingHours:{ open: { type: String, default: '09:00' }, close: { type: String, default: '17:00' } },

  settings: {
    graceSeconds:        { type: Number, default: 90 },     // time to arrive after being called
    approachingAhead:    { type: Number, default: 3 },      // "Almost your turn" threshold
    leaveBufferMinutes:  { type: Number, default: 5 },      // extra margin for Smart Leave Alert
    alertThresholdMin:   { type: Number, default: 15 },     // Copilot warns above this wait
    emaAlpha:            { type: Number, default: 0.2 },    // learning speed
    priorityBonusMinutes:{                                   // transparent priority rules
      normal: { type: Number, default: 0 },
      senior: { type: Number, default: 20 },
      pregnant: { type: Number, default: 20 },
      disabled: { type: Number, default: 30 },
      emergency: { type: Number, default: 120 }
    },
    languages: { type: [String], default: ['en','ur','sd'] }
  }
}, { timestamps: true });
```

### 2.2 Service

```js
const ServiceSchema = new Schema({
  branchId:   { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
  name:       { type: String, required: true },                    // "Lab tests"
  nameUr:     String,
  nameSd:     String,
  prefix:     { type: String, required: true, uppercase: true, maxlength: 2 },  // "L"
  isActive:   { type: Boolean, default: true },

  // Learned timing (self-learning wait time)
  defaultServiceSec: { type: Number, default: 180 },               // seeded starting value
  emaServiceSec:     { type: Number, default: 180 },               // updated after each completion
  sampleCount:       { type: Number, default: 0 }                  // drives confidence label
}, { timestamps: true });

ServiceSchema.index({ branchId: 1, prefix: 1 }, { unique: true });
```

**Confidence label (derived, not stored):** `sampleCount < 5` is Learning, `5-14` is Fair, `>= 15` is Good.

### 2.3 Counter

```js
const CounterSchema = new Schema({
  branchId:       { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
  name:           { type: String, required: true },                // "Counter 1"
  number:         { type: Number, required: true },
  serviceIds:     [{ type: Schema.Types.ObjectId, ref: 'Service' }],
  status:         { type: String, enum: ['open','closed','break'], default: 'closed', index: true },
  currentTokenId: { type: Schema.Types.ObjectId, ref: 'Token', default: null },
  staffId:        { type: Schema.Types.ObjectId, ref: 'User', default: null },
  statusSince:    { type: Date, default: Date.now },               // used by Copilot (paused too long)
  isSimulated:    { type: Boolean, default: false }
}, { timestamps: true });

CounterSchema.index({ branchId: 1, number: 1 }, { unique: true });
```

### 2.4 Token

```js
const TokenSchema = new Schema({
  branchId:   { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  serviceId:  { type: Schema.Types.ObjectId, ref: 'Service', required: true },
  publicId:   { type: String, required: true, unique: true },      // random 12 chars, used in URLs
  number:     { type: Number, required: true },                    // 14
  code:       { type: String, required: true },                    // "L-014"
  dayKey:     { type: String, required: true },                    // "2026-10-14" for daily reset and analytics

  customerName: { type: String, default: '' },                     // optional
  language:     { type: String, enum: ['en','ur','sd'], default: 'en' },
  channel:      { type: String, enum: ['web','qr','walkin'], default: 'web' },
  isSimulated:  { type: Boolean, default: false },

  // Priority lane
  priorityType:      { type: String, enum: ['normal','senior','pregnant','disabled','emergency'], default: 'normal' },
  priorityVerified:  { type: Boolean, default: null },             // null = not checked yet
  bonusMinutes:      { type: Number, default: 0 },                 // copied from settings at creation
  effectiveTime:     { type: Date, required: true },               // createdAt - bonus. Queue sorts by this.

  // State
  status: { type: String,
            enum: ['waiting','called','serving','completed','no_show','cancelled'],
            default: 'waiting' },
  counterId:        { type: Schema.Types.ObjectId, ref: 'Counter', default: null },
  recallCount:      { type: Number, default: 0 },                  // one-time recall allowed

  // Smart Leave Alert
  travelMinutes:    { type: Number, default: null },
  notified: {
    leaveNow: { type: Boolean, default: false },
    almost:   { type: Boolean, default: false },
    called:   { type: Boolean, default: false }
  },

  // Timeline
  joinedAt:          { type: Date, default: Date.now },
  calledAt:          Date,
  hereAt:            Date,                                         // customer pressed "I'm here"
  servingStartedAt:  Date,
  completedAt:       Date,

  // For analytics and honesty
  estimateAtJoinSec: Number,                                       // what we promised when they joined
  actualWaitSec:     Number,                                       // calledAt - joinedAt
  serviceDurationSec:Number,                                       // completedAt - servingStartedAt

  feedback: { rating: { type: Number, min: 1, max: 5 }, comment: String }
}, { timestamps: true });

// Indexes that matter for speed
TokenSchema.index({ branchId: 1, serviceId: 1, status: 1, effectiveTime: 1 }); // queue ordering
TokenSchema.index({ branchId: 1, dayKey: 1 });                                  // daily analytics
TokenSchema.index({ publicId: 1 }, { unique: true });
```

### 2.5 QueueEvent (append-only log)

```js
const QueueEventSchema = new Schema({
  branchId:   { type: Schema.Types.ObjectId, ref: 'Branch', index: true },
  tokenId:    { type: Schema.Types.ObjectId, ref: 'Token' },
  serviceId:  { type: Schema.Types.ObjectId, ref: 'Service' },
  counterId:  { type: Schema.Types.ObjectId, ref: 'Counter' },
  type:       { type: String, enum: [
                'joined','called','here','started','completed',
                'no_show','recalled','cancelled','transferred',
                'priority_verified','priority_rejected',
                'counter_opened','counter_closed','counter_break',
                'alert_leave_now','alert_almost','alert_called',
                'sim_rush'] },
  at:         { type: Date, default: Date.now, index: true },
  meta:       Schema.Types.Mixed,                                   // e.g. { waitSec, durationSec }
  isSimulated:{ type: Boolean, default: false }
});

QueueEventSchema.index({ branchId: 1, at: -1 });
```

### 2.6 User (staff)

```js
const UserSchema = new Schema({
  name:         { type: String, required: true },
  email:        { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role:         { type: String, enum: ['operator','admin'], default: 'operator' },
  branchId:     { type: Schema.Types.ObjectId, ref: 'Branch', required: true }
}, { timestamps: true });
```

### 2.7 Sequence (atomic token numbers)

```js
const SequenceSchema = new Schema({
  key: { type: String, unique: true },     // `${branchId}:${serviceId}:${dayKey}`
  seq: { type: Number, default: 0 }
});

// Usage inside createToken()
const s = await Sequence.findOneAndUpdate(
  { key },
  { $inc: { seq: 1 } },
  { upsert: true, new: true }
);
const number = s.seq;
const code = `${service.prefix}-${String(number).padStart(3, '0')}`;
```

---

## 3. Status Lifecycle of a Token

```
            +--------------------- cancel ---------------------+
            |                                                  v
 joined -> waiting -> called -> serving -> completed        cancelled
                         |                                     
                         +--(grace expires)--> no_show --(recall, once)--> waiting (3rd position)
```

Allowed transitions (enforce in the queue engine):

| From | To | Triggered by |
|---|---|---|
| waiting | called | Staff "Call next" |
| waiting | cancelled | Customer cancel |
| called | serving | Staff "Start serving" |
| called | no_show | Grace timer expires or staff mark |
| serving | completed | Staff "Complete" |
| no_show | waiting | Staff "Recall" (only if `recallCount == 0`) |
| waiting | waiting | Transfer to another service or priority change |

---

## 4. Key Queries

### 4.1 Next token for a counter
```js
Token.findOneAndUpdate(
  { branchId, serviceId: { $in: counter.serviceIds }, status: 'waiting' },
  { $set: { status: 'called', counterId: counter._id, calledAt: new Date() } },
  { sort: { effectiveTime: 1 }, new: true }
);
```
Using `findOneAndUpdate` makes the pick atomic, so two counters never take the same token.

### 4.2 People ahead of a token
```js
Token.countDocuments({
  branchId, serviceId, status: 'waiting',
  effectiveTime: { $lt: token.effectiveTime }
});
```

### 4.3 Open counters for a service
```js
Counter.find({ branchId, status: 'open', serviceIds: serviceId });
```

### 4.4 Learned service time after completion
```js
const duration = clamp((completedAt - servingStartedAt) / 1000, 30, 3600);
const alpha = branch.settings.emaAlpha;
service.emaServiceSec = alpha * duration + (1 - alpha) * service.emaServiceSec;
service.sampleCount += 1;
await service.save();
```

### 4.5 Analytics summary (today)
```js
Token.aggregate([
  { $match: { branchId, dayKey, ...(includeSim ? {} : { isSimulated: false }) } },
  { $group: {
      _id: null,
      completed:  { $sum: { $cond: [{ $eq: ['$status','completed'] }, 1, 0] } },
      noShow:     { $sum: { $cond: [{ $eq: ['$status','no_show'] }, 1, 0] } },
      waiting:    { $sum: { $cond: [{ $eq: ['$status','waiting'] }, 1, 0] } },
      avgWaitSec: { $avg: '$actualWaitSec' },
      avgSvcSec:  { $avg: '$serviceDurationSec' }
  }}
]);
```

### 4.6 Hourly arrivals and average wait
```js
Token.aggregate([
  { $match: { branchId, dayKey } },
  { $group: {
      _id: { $hour: { date: '$joinedAt', timezone: 'Asia/Karachi' } },
      arrivals:   { $sum: 1 },
      avgWaitSec: { $avg: '$actualWaitSec' }
  }},
  { $sort: { _id: 1 } }
]);
```

### 4.7 Best time to visit (last 7 days)
Same as 4.6, but `$match` on `dayKey: { $in: last7Days }` and a service filter; return the three hours with the lowest `avgWaitSec`.

### 4.8 Per-counter performance
```js
Token.aggregate([
  { $match: { branchId, dayKey, status: 'completed' } },
  { $group: { _id: '$counterId', served: { $sum: 1 }, avgSvcSec: { $avg: '$serviceDurationSec' } } }
]);
```

---

## 5. Seed Data (so the demo never looks empty)

Create with `npm run seed`:

**Branch:** "City Civic Center" (demo).

**Services**
| Name | Prefix | Default service time |
|---|---|---|
| Registration | R | 150 s |
| Lab tests | L | 240 s |
| Pharmacy | P | 90 s |

**Counters**
| Counter | Services | Status |
|---|---|---|
| Counter 1 | Registration, Pharmacy | open |
| Counter 2 | Lab tests | open |
| Counter 3 | Lab tests, Registration | closed (so you can open it live in the demo) |
| Counter 4 | Pharmacy | open |

**Users**
| Email | Password | Role |
|---|---|---|
| staff@baari.test | demo1234 | operator |
| admin@baari.test | demo1234 | admin |

**History:** generate about 7 days of completed simulated tokens (with `isSimulated: true`) with a realistic daily pattern: busy 10 to 12 and 3 to 5, quiet at lunch. This feeds the hourly chart and the best-time hint, and gives the services a starting `sampleCount` of around 20.

**Live starter queue:** about 8 waiting tokens spread across the three services, so the first screen has life.

---

## 6. Data Rules

- `dayKey` is computed in the Asia/Karachi time zone, so daily reset happens at local midnight.
- Never delete tokens; change status instead. Keep the log for analytics.
- Simulated documents always carry `isSimulated: true`. Analytics include them only when demo mode is on.
- Do not store phone numbers. Customer name is optional.
- `publicId` uses a random URL-safe string (for example `nanoid(12)` or `crypto.randomBytes(9).toString('base64url')`).
- Validate every enum and number on input; reject unknown fields.

---

## 7. Sample Documents

**Token**
```json
{
  "publicId": "k8Vd2xQpL1aZ",
  "code": "L-014",
  "number": 14,
  "dayKey": "2026-10-14",
  "status": "waiting",
  "priorityType": "senior",
  "bonusMinutes": 20,
  "joinedAt": "2026-10-14T05:12:08.000Z",
  "effectiveTime": "2026-10-14T04:52:08.000Z",
  "travelMinutes": 20,
  "notified": { "leaveNow": false, "almost": false, "called": false },
  "estimateAtJoinSec": 1440
}
```

**Service**
```json
{
  "name": "Lab tests",
  "prefix": "L",
  "defaultServiceSec": 240,
  "emaServiceSec": 212.4,
  "sampleCount": 23
}
```

**QueueEvent**
```json
{
  "type": "completed",
  "tokenId": "...",
  "serviceId": "...",
  "counterId": "...",
  "at": "2026-10-14T05:40:51.000Z",
  "meta": { "waitSec": 612, "durationSec": 198 }
}
```
