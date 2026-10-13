# Baari: Technical Requirements Document (TRD)

Companion files: `PRD.md`, `UI-UX.md`, `Backendschema.md`, `Implementationplan.md`

---

## 1. Technical Goals

1. **Beginner-safe:** one language (JavaScript), no build step, minimum tools.
2. **Real-time:** every queue change reaches every screen in under 1 second.
3. **Free:** every service has a free tier.
4. **Explainable:** every number on screen can be explained in one sentence.
5. **Demo-proof:** works on Wi-Fi, on a phone hotspot, or fully offline on one laptop.

---

## 2. Technology Stack

| Layer | Choice | Why | Free fallback |
|---|---|---|---|
| Runtime | Node.js 20 LTS | Already in your JS path | none needed |
| Server | Express.js | You have used it before | none needed |
| Database | MongoDB with Mongoose | You have used it before; flexible schema for fast changes | Local MongoDB if Atlas is slow |
| Real-time | Socket.IO | Rooms per branch and per token, auto-reconnect | Polling every 3 s |
| Auth | JWT + bcryptjs | Staff only; customers need no login | Hard-coded demo staff accounts |
| Frontend | Plain HTML + CSS + JavaScript modules, served by Express | No build tools to break | none needed |
| Charts | Chart.js (CDN) | One script tag | Simple CSS bars |
| QR code | `qrcode` npm package | Server generates PNG/SVG | Any free online QR for the final URL |
| Notifications | Browser Notification API + in-page banner + Vibration API | Free, no external service | Sound and banner only |
| Voice | Web Speech API (`speechSynthesis`) | Free, built into browsers | Chime audio file |
| Scheduling | `setInterval` inside the server (no cron library needed) | Simple | none needed |
| Hosting | Render free web service + MongoDB Atlas M0 | Free public URL for QR on phones | Laptop + hotspot + Cloudflare Tunnel or ngrok |
| Version control | Git + GitHub | Commit after each stage | none needed |

**Not used on purpose:** React, TypeScript, Redis, Docker, ML libraries. Each adds failure risk in 24 hours.

---

## 3. Architecture

```
 Citizen phone            Staff laptop           TV / Display board
 (index, token page)      (staff, admin)         (display page)
        |                      |                        |
        +-----------+----------+------------------------+
                    |   HTTPS REST + WebSocket (Socket.IO)
            +-------v--------------------------------+
            |            Express Server               |
            |  routes -> controllers -> services      |
            |                                         |
            |  Queue Engine     Wait-Time Engine      |
            |  Priority Engine  Notification Engine   |
            |  Simulation Lab   Analytics Service     |
            +-------+-------------------+-------------+
                    |                   |
             +------v------+     +------v-------+
             |  MongoDB    |     | In-memory    |
             |  (Mongoose) |     | sim state    |
             +-------------+     +--------------+
```

**Flow of a queue change (example: staff presses "Call next"):**
1. Staff UI sends `POST /api/counters/:id/call-next`.
2. Queue Engine picks the next token by effective time, sets `called`, logs a `QueueEvent`.
3. Wait-Time Engine recomputes estimates for the affected service.
4. Server emits Socket.IO events: `queue:updated` to the branch room, `token:called` to that token's room.
5. Display board plays the voice announcement; the customer's phone shows "Go to Counter 3".
6. Notification Engine checks all waiting tokens and sends *Almost your turn* or *Leave now* alerts when thresholds are crossed.

---

## 4. Core Algorithms (the heart of the project)

### 4.1 Effective time and priority lanes
Instead of letting priority customers jump to the very front, each priority type earns a **time bonus**. This keeps the rule transparent and abuse-resistant.

```
effectiveTime = createdAt - bonusMinutes[priorityType]

default bonusMinutes = { normal: 0, senior: 20, pregnant: 20, disabled: 30, emergency: 120 }
```

Queue order = ascending `effectiveTime`. A senior who arrives 10 minutes after a normal customer is placed ahead of that customer. Bonuses are editable by admin.
If staff mark a priority claim "not verified", the token's bonus becomes 0 and its position is recomputed.

### 4.2 Wait-time estimate

```
ahead        = number of waiting tokens in the same service with smaller effectiveTime
avgSvc       = service.emaServiceSec            (seconds, learned)
openCounters = counters open and supporting this service
remaining    = sum over busy counters of max(0, avgSvc - secondsSinceServiceStarted)

estimateSec  = (ahead * avgSvc + remaining) / openCounters
```

- If `openCounters == 0`, return `null` and show "No counter open right now".
- **Range:** `low = estimate * 0.8`, `high = estimate * 1.25 + 60 s`.
- **Confidence label:** based on `service.sampleCount`: fewer than 5 = *Learning*, 5 to 14 = *Fair*, 15 or more = *Good*.

Example: 10 ahead, 3 min average, 2 counters open, 1 minute remaining on current customers: `(10 x 180 + 120) / 2 = 960 s = 16 min`.

### 4.3 Self-learning service time (exponential moving average)

When a token completes:

```
duration = completedAt - servingStartedAt   (clamped to 30 s ... 3600 s)
ema_new  = 0.2 * duration + 0.8 * ema_old
sampleCount += 1
```

Starts from a seeded default per service. This is why estimates improve during the live demo.

### 4.4 What-If engine (powers the What-If Panel)
Same formula as 4.2, but with a hypothetical `openCounters + delta`. Returns the before and after estimate for the longest-waiting service.

```
GET /api/sim/whatif?branchId=...&serviceId=...&counters=+1
-> { before: 24 min, after: 13 min, savedMin: 11 }
```

### 4.5 Staff Copilot rules (simple, not ML)
Every 15 seconds evaluate each service:
- If `estimate > alertThresholdMin` (default 15) and an idle or closed counter that supports the service exists: suggest **Open Counter X**.
- If another service has `estimate < 5 min` and a counter that supports both services: suggest **Move Counter X to this service**.
- If a counter has been `paused` for more than 10 minutes: suggest **Check Counter X**.

### 4.6 Notification triggers
Evaluated after every queue change and every 10 seconds:

| Alert | Rule |
|---|---|
| **Leave now** | `travelMinutes` is set and `estimate <= travelMinutes + 5` and not sent yet |
| **Almost your turn** | `ahead <= 3` and not sent yet |
| **Your turn** | status becomes `called` |

Each alert flag is stored on the token (`notified.leaveNow`, `notified.almost`, `notified.called`) so it fires once only.

### 4.7 No-show handling
- When called, a **grace timer** starts (default 90 seconds).
- Customer can press **I'm here** (sets status `serving` once staff start).
- When the timer expires, the token becomes `no_show` and the next token is eligible.
- One-time **recall**: staff can bring a no-show back; it is reinserted three positions from the front.

### 4.8 Atomic token numbers
Use one `Sequence` document per `branch + service + day` and increment with `findOneAndUpdate({ $inc: { seq: 1 } }, { upsert: true, new: true })`. Two people can never receive the same number.

---

## 5. Real-Time Design (Socket.IO)

**Rooms:** `branch:{branchId}` (staff, display), `token:{publicId}` (one customer).

| Event (server to client) | Payload | Used by |
|---|---|---|
| `queue:updated` | `{ branchId, services: [{ serviceId, waiting, estimateSec }] }` | Staff, display, join page |
| `token:updated` | `{ publicId, status, ahead, estimateSec, range, counter }` | Customer token page |
| `token:called` | `{ publicId, code, counterName }` | Display (voice), customer |
| `counter:updated` | `{ counterId, status, currentToken }` | Staff, display |
| `notify:alert` | `{ publicId, level, message }` | Customer |
| `sim:status` | `{ running, arrivalsPerMin }` | Staff |

Client events: `join:branch`, `join:token`.

**Fallback:** if the socket disconnects, the client polls `GET /api/tokens/:publicId` every 5 seconds and shows a small "Reconnecting" chip.

---

## 6. REST API

Base path: `/api`. JSON in and out. Errors use `{ error: { code, message } }`.

### 6.1 Public (no login)

| Method | Path | Purpose |
|---|---|---|
| GET | `/branches/:branchId/public` | Branch info, services, live stats, busy level |
| POST | `/tokens` | Create token `{ branchId, serviceId, priorityType, language, travelMinutes?, customerName? }` |
| GET | `/tokens/:publicId` | Token status, ahead count, estimate range, counter |
| PATCH | `/tokens/:publicId` | Update `travelMinutes` or `language` |
| POST | `/tokens/:publicId/here` | Customer confirms arrival after being called |
| POST | `/tokens/:publicId/cancel` | Cancel token |
| POST | `/tokens/:publicId/feedback` | `{ rating 1-5, comment? }` |
| GET | `/display/:branchId` | Now serving and next five |
| GET | `/branches/:branchId/best-time?serviceId=` | Quietest hours based on history |
| GET | `/branches/:branchId/qr.png` | QR image pointing to `/q/:branchId` |

### 6.2 Staff (JWT required)

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | Returns JWT |
| GET | `/staff/queue?branchId=` | Full queue with tokens, counters, estimates |
| POST | `/counters/:id/status` | `{ status: open / closed / break }` |
| POST | `/counters/:id/call-next` | Calls the next eligible token |
| POST | `/tokens/:id/start` | Begin serving |
| POST | `/tokens/:id/complete` | Finish and update learned service time |
| POST | `/tokens/:id/no-show` | Mark no-show |
| POST | `/tokens/:id/recall` | One-time recall |
| POST | `/tokens/:id/transfer` | Move to another service `{ serviceId }` |
| POST | `/tokens/:id/priority` | Verify or reject priority claim |
| POST | `/tokens/walk-in` | Create token for assisted visitor; returns printable data |
| GET | `/analytics/summary?branchId=&range=today` | Average wait, service time, completed, queue length, no-show rate |
| GET | `/analytics/hourly?branchId=&range=today` | Arrivals and average wait per hour |
| GET | `/analytics/counters?branchId=` | Per-counter performance |
| GET | `/copilot/suggestions?branchId=` | Staff Copilot suggestions |

### 6.3 Admin and Simulation (JWT, role admin or demo)

| Method | Path | Purpose |
|---|---|---|
| PATCH | `/branches/:id/settings` | Priority bonuses, grace seconds, thresholds |
| POST/PATCH/DELETE | `/services`, `/counters` | Manage services and counters |
| POST | `/sim/rush` | Add `{ count, serviceId? }` simulated tokens now |
| POST | `/sim/start` | Start steady arrivals `{ arrivalsPerMin }` |
| POST | `/sim/stop` | Stop arrivals |
| POST | `/sim/autoserve` | Toggle simulated counters finishing customers automatically |
| POST | `/sim/reset` | Clear simulated data and reseed |
| GET | `/sim/whatif` | What-If estimate `{ serviceId, counters: +1 }` |

---

## 7. Simulation Lab Design

- Simulated tokens have `isSimulated: true` and names like "Sim Customer 14".
- **Rush:** inserts N tokens with timestamps spread across the last minute.
- **Steady arrivals:** a server `setInterval` creates tokens with random exponential gaps (rate set by slider).
- **Auto-serve:** simulated counters complete tokens after a random time around the service average (so the learning effect is visible).
- Everything emits the same socket events as real traffic, so the UI needs no special code.
- Analytics default to "include simulated data" while demo mode is on.

---

## 8. Security and Privacy

- Passwords hashed with `bcryptjs`; JWT expires in 8 hours; secret in `.env`.
- Staff routes protected by auth middleware and role checks.
- Customer tokens identified by a random 12-character `publicId`; no sequential IDs are exposed.
- Rate limit `POST /tokens` (for example 10 per minute per IP) using a simple in-memory limiter, so nobody can flood the demo.
- Validate every input (Joi or manual checks); escape text before rendering.
- CORS restricted to the app's own origin.
- No real personal data. The UI shows a "Demo data" badge.

---

## 9. Folder Structure

```
baari/
  package.json
  .env.example
  server.js                  # app + socket setup
  src/
    config/db.js
    models/                  # Branch, Service, Counter, Token, User, QueueEvent, Sequence
    routes/                  # public.js, staff.js, admin.js, sim.js
    controllers/
    services/
      queueEngine.js         # ordering, call next, no-show
      waitTime.js            # estimate + EMA + what-if
      priority.js
      notifier.js            # alert rules + emit
      copilot.js
      analytics.js
      simulator.js
    sockets/index.js
    middleware/              # auth.js, rateLimit.js, errors.js
    seed/seed.js             # demo branch, services, counters, 7 days of history
  public/
    index.html               # join page (/q/:branchId serves this)
    token.html               # live token page
    staff.html
    admin.html
    login.html
    display.html
    css/tokens.css  css/app.css
    js/api.js  js/socket.js  js/i18n.js  js/notify.js  js/voice.js  js/ui/*.js
    locales/en.json  locales/ur.json  locales/sd.json
    assets/chime.mp3  fonts/
  README.md
```

---

## 9a. Environment Variables (`.env`)

```
PORT=3000
MONGODB_URI=mongodb+srv://...
JWT_SECRET=change-me
BASE_URL=https://your-app.onrender.com
DEMO_MODE=true
```

---

## 10. Deployment

1. **Primary:** push to GitHub; create a Render Web Service (build `npm install`, start `node server.js`); connect MongoDB Atlas M0 using `MONGODB_URI`. Render free services sleep, so open the URL 5 minutes before judging.
2. **Backup (recommended):** run locally with `npm start`, expose with a Cloudflare Tunnel or ngrok, or have all devices join the same phone hotspot and use the laptop's local IP.
3. QR code must encode the **final public URL**; regenerate it after deployment.

---

## 11. Testing

| Type | What | How |
|---|---|---|
| Unit | Wait-time formula, priority ordering, EMA update | Small Node script with sample numbers (3 to 5 checks) |
| API | Token create, call-next, complete | Thunder Client or curl |
| Realtime | Two browser tabs update together | Manual |
| Mobile | Join, notify, RTL layout | Real phone, one Android and one iPhone if possible |
| Demo | Full 3-minute script | Rehearse three times |

**Acceptance checks:**
- Two simultaneous joins never get the same code.
- Opening a counter lowers the estimate; closing raises it.
- A senior token lands ahead of a later normal token by the configured bonus.
- Refreshing the token page keeps the same token.
- Calling next produces a visible event on the display board in under a second.

---

## 12. Fallback Plan

| If this breaks | Do this |
|---|---|
| Atlas connection | Switch `MONGODB_URI` to local MongoDB |
| Render sleeps or deploy fails | Run on laptop with hotspot |
| Socket.IO issues | Client polling every 3 to 5 seconds |
| Notifications blocked | Banner, sound, display board |
| Voice missing | Chime file |
| Live demo fails | Play the recorded backup video |
