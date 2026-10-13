# Baari: 24-Hour Implementation Plan

Companion files: `PRD.md`, `TRD.md`, `UI-UX.md`, `Backendschema.md`
Assumption: you are working alone with AI help. If you have teammates, see section 9.

---

## 0. Golden Rules

1. **Working beats perfect.** After every stage, the app must run and be committed to Git.
2. **P0 first.** Official MVP items come before unique features. Unique features come before polish.
3. **Feature freeze at hour 21.** After that, only bug fixes, deployment, and rehearsal.
4. **Build vertical slices.** One working path (join, see position, staff calls next) before adding extras.
5. **Do not wait on AI.** If a prompt fails twice, simplify the task or write the small part by hand.
6. **Eat, drink water, and sleep 20 minutes** around hour 14. Tired mistakes cost more than the break.

---

## 1. Overview Timeline

| Hours | Stage | Output |
|---|---|---|
| 0 to 1 | Setup | Repo, dependencies, database connection |
| 1 to 3 | Data layer and seed | Models, seed data, token creation API |
| 3 to 5 | Queue and wait-time engine | Call next, complete, no-show, estimates, EMA |
| 5 to 7 | Real-time and auth | Socket.IO events, staff login |
| 7 to 10 | Customer UI | Join page, token page with ticket and Queue Lane |
| 10 to 13 | Staff Console | Counters, queue list, actions, walk-in token |
| 13 to 15 | Alerts and display | Smart Leave Alert, notifications, display board with voice |
| 15 to 17 | Demo Lab | Simulation, What-If, Copilot |
| 17 to 19 | Analytics | Summary stats, hourly chart, best time |
| 19 to 20 | Languages and accessibility | English, Urdu, Sindhi, RTL, large text |
| 20 to 21 | Deploy | Render + Atlas, real QR, phone test |
| 21 to 22 | Polish | Animations, empty and error states |
| 22 to 23 | Rehearse and record | 3-minute demo three times, backup video, README |
| 23 to 24 | Buffer | Fixes, submission |

---

## 2. Stage-by-Stage Plan

Each stage lists: **what to build**, **how**, **tools**, **done when**, and a **prompt** you can paste to your AI assistant.

### Stage 1 (Hour 0 to 1): Setup
**Build:** project folder, Git repo, Express server serving the `public/` folder, MongoDB connection.
**Tools:** Node.js 20, VS Code, GitHub, MongoDB Atlas (free M0 cluster; also install MongoDB locally if possible as a backup).
**Steps:**
1. `mkdir baari && cd baari && npm init -y`
2. `npm i express mongoose socket.io dotenv jsonwebtoken bcryptjs cors nanoid qrcode`
3. `npm i -D nodemon` and add scripts `"start": "node server.js"`, `"dev": "nodemon server.js"`, `"seed": "node src/seed/seed.js"`.
4. Create `.env` from `TRD.md` section 9a. Create the folder tree from `TRD.md` section 9.
5. First commit and push to GitHub.

**Done when:** `npm run dev` shows "MongoDB connected" and `http://localhost:3000` opens a placeholder page.

**Prompt:**
> I am building "Baari", a queue management app (Node, Express, MongoDB, Socket.IO, plain HTML/CSS/JS frontend). Create `server.js` that loads dotenv, connects to MongoDB with Mongoose, serves the `public` folder statically, sets up Socket.IO on the same HTTP server, and has a `/api/health` route. Use CommonJS. Keep the code short with comments I can understand as a beginner.

---

### Stage 2 (Hour 1 to 3): Models, seed, token creation
**Build:** Mongoose models from `Backendschema.md` (Branch, Service, Counter, Token, QueueEvent, User, Sequence), seed script, `POST /api/tokens`, `GET /api/tokens/:publicId`, `GET /api/branches/:id/public`.
**Done when:** `npm run seed` fills the database, and a request in Thunder Client creates token `L-009` then `L-010` with no duplicates.

**Prompt:**
> Here is my database schema file (paste `Backendschema.md`). Write the Mongoose models in `src/models/`. Then write `src/seed/seed.js` that creates the demo branch, 3 services, 4 counters, 2 users (bcrypt hashed), 7 days of simulated completed tokens with a realistic busy-hour pattern, and 8 live waiting tokens. Then write the routes `POST /api/tokens` (atomic number using the Sequence collection), `GET /api/tokens/:publicId`, and `GET /api/branches/:branchId/public`.

---

### Stage 3 (Hour 3 to 5): Queue engine and wait-time engine
**Build:** `queueEngine.js` (call next, start, complete, no-show, recall, transfer, cancel) and `waitTime.js` (ahead count, estimate with range, confidence, EMA update, what-if). Wire these into the token routes.
**Tip:** Write the formulas exactly as in `TRD.md` section 4. Test with a tiny Node script before connecting to routes.
**Done when:**
- Estimate for a token equals the hand calculation (for example `(10 x 180 + 120) / 2 = 960 s`).
- Calling next picks the earliest `effectiveTime`; a senior added later jumps ahead by 20 minutes.
- Completing a token changes the service's `emaServiceSec`.

**Prompt:**
> Using the formulas in this TRD section (paste TRD section 4), write `src/services/waitTime.js` with functions `getAhead`, `getEstimate(token)`, `getServiceEstimate(serviceId)`, `confidenceLabel(sampleCount)`, `updateEma(service, durationSec)`, and `whatIf(serviceId, deltaCounters)`. Then write `src/services/queueEngine.js` with `callNext(counterId)` using an atomic `findOneAndUpdate` sorted by `effectiveTime`, plus `start`, `complete`, `markNoShow`, `recall`, `cancel`, `transfer`. Log a QueueEvent for each action. Add a small test script that prints results for sample numbers.

---

### Stage 4 (Hour 5 to 7): Real-time and staff auth
**Build:** Socket.IO rooms (`branch:*`, `token:*`), emit `queue:updated`, `token:updated`, `token:called`, `counter:updated` after every queue action; JWT login and auth middleware; staff routes (counter status, call-next, start, complete, no-show, recall, walk-in).
**Done when:** two browser tabs on a test page both update when you call `call-next` from Thunder Client.

**Prompt:**
> Add Socket.IO events from this TRD table (paste TRD section 5). Create `src/sockets/index.js` that exposes `emitQueueUpdate(branchId)` and `emitTokenUpdate(publicId)`. Call them from the queue engine after each change. Add JWT auth (`/api/auth/login`, `auth` and `requireRole` middleware) and the staff routes from TRD section 6.2. Return helpful error messages.

**Checkpoint (hour 7):** commit with message "Backend core complete". You now have a working product behind an API.

---

### Stage 5 (Hour 7 to 10): Customer UI
**Build:** `index.html` (Join, `/q/:branchId`), `token.html` (My Token), shared `tokens.css`, `app.css`, `api.js`, `socket.js`. Implement the **ticket stub** and **Queue Lane** exactly as in `UI-UX.md` sections 2 and 4.
**Order:** Join form first, then token page with live updates, then the print animation, then the Queue Lane.
**Done when:** you can scan a QR (or open the link) on your phone, get a token, and watch "people ahead" and the estimate change when you call next from the laptop.

**Prompt:**
> Build the customer pages for my queue app using plain HTML, CSS and vanilla JS (no frameworks). Follow this design spec (paste UI-UX sections 2 and 4.1 to 4.2). Include `tokens.css` with the design tokens, a Join page that loads services from `/api/branches/:id/public` and posts to `/api/tokens`, and a My Token page that connects to Socket.IO, shows the ticket stub, people ahead, the estimate range with confidence, the Queue Lane, and all token states. Mobile-first at 360 px, accessible, no external UI libraries.

---

### Stage 6 (Hour 10 to 13): Staff Console
**Build:** `login.html`, `staff.html` with counter tiles, waiting list, actions (Call next, Start serving, Complete, Mark no-show, Recall, Open, Pause, Close), walk-in token with print view, keyboard shortcut `N`, and the **Priority** verify/reject buttons.
**Done when:** you can run a full cycle (join on phone, call next, start, complete) using only the UI.

**Prompt:**
> Build `staff.html` as a three-pane control room as in this wireframe (paste UI-UX 4.3). Use the staff API routes (paste TRD 6.2) and Socket.IO events to keep everything live. Counter tiles must show status, current token, and a running timer. Add a "Walk-in token" button that creates a token and opens a print-friendly ticket (58 mm width) with a QR code to the token page.

**Checkpoint (hour 13):** all six official MVP items (F-01 to F-06 except analytics and simulation) work. Commit and eat something.

---

### Stage 7 (Hour 13 to 15): Alerts and Display Board
**Build:** `notifier.js` (checks every 10 seconds and after each queue change; Leave now, Almost your turn, Your turn), browser Notification permission prompt on the token page, in-page banner, vibration, sound. Then `display.html` with Now serving, Next five, QR, and voice announcement with a "Tap to enable sound" overlay.
**Done when:** with `travelMinutes = 10` the phone shows "Leave now" at the right moment; calling next triggers the voice on the display board.

**Prompt:**
> Write `src/services/notifier.js` that runs `setInterval` every 10 seconds and after each queue update. For each waiting token compute the estimate and `ahead`, then emit `notify:alert` for levels leaveNow (`travelMinutes` set and `estimate <= travelMinutes + buffer`), almost (`ahead <= approachingAhead`), and called. Use the `notified` flags to fire once only. Then write the client code `notify.js` for browser notifications, banner, vibration and sound, and `display.html` using `speechSynthesis` for voice with a chime fallback.

---

### Stage 8 (Hour 15 to 17): Demo Lab, What-If, Copilot
**Build:** `simulator.js` (rush, steady arrivals, auto-serve, reset), `/api/sim/*` routes, `copilot.js` suggestions, the Demo Lab drawer and What-If panel in the Staff Console.
**Done when:** pressing **Add 20 people** raises the wait on the phone; **Open one more counter** lowers it; Copilot suggests opening Counter 3 when Lab wait exceeds 15 minutes.

**Prompt:**
> Write `src/services/simulator.js` and routes `/api/sim/rush`, `/start`, `/stop`, `/autoserve`, `/reset`, `/whatif` as described in TRD section 7. Simulated tokens must have `isSimulated: true`. Auto-serve should complete tokens at random durations around the service's EMA so the learning effect is visible. Then write `copilot.js` using the three rules in TRD 4.5 and add the Demo Lab drawer UI from UI-UX 4.4.

---

### Stage 9 (Hour 17 to 19): Analytics
**Build:** the three aggregation queries from `Backendschema.md` section 4, the Admin page with four stat figures, one combined hourly chart (Chart.js via CDN), counter performance table, and the "Quietest hours" hint on the Join page.
**Done when:** numbers match what you see in the queue after running a simulation.

**Prompt:**
> Using these MongoDB aggregations (paste Backendschema 4.5 to 4.8) write `analytics.js` and routes `/api/analytics/summary`, `/hourly`, `/counters`, and `/api/branches/:id/best-time`. Then build `admin.html` as in UI-UX 4.6 with four stat figures, one Chart.js bar-and-line chart, and a counter table. Add a toggle "include demo data".

---

### Stage 10 (Hour 19 to 20): Languages and accessibility
**Build:** `i18n.js` with `t(key)`, `en.json`, `ur.json`, `sd.json`; language switch; set `lang` and `dir` on `<html>`; load Urdu and Sindhi fonts; large-text and high-contrast toggles; `aria-live` regions.
**Cut line:** if behind schedule, ship English and Urdu only, and keep Sindhi for the Join page and token page.
**Done when:** switching to Urdu flips the layout and nothing overlaps; token code stays left-to-right.

**Prompt:**
> Add i18n to my vanilla JS app. Create `i18n.js` with `setLang(lang)` that loads `/locales/{lang}.json`, updates every element with `data-i18n`, sets `document.documentElement.lang` and `dir` (rtl for ur and sd), and saves the choice in localStorage. Convert my CSS to logical properties so RTL works. Provide the three JSON files for the strings used on the Join and My Token pages.

---

### Stage 11 (Hour 20 to 21): Deployment and phone test
**Build:** deploy to Render (free web service) with Atlas; set env vars; regenerate the QR with the final URL; test on 2 real phones; confirm Socket.IO works over HTTPS.
**Backup:** run locally with hotspot or a Cloudflare Tunnel or ngrok link.
**Done when:** a stranger can scan the QR on the display board and get a token on their own phone.

**Prompt:**
> Give me exact click-by-click steps to deploy my Node + Express + Socket.IO + MongoDB app on Render's free tier with MongoDB Atlas M0. Include the environment variables, the Atlas IP allow-list setting, the start command, and how to confirm WebSockets work. Also give me a backup plan using a Cloudflare Tunnel from my laptop.

**FEATURE FREEZE at hour 21.**

---

### Stage 12 (Hour 21 to 22): Polish
Do these in order and stop when time is up (full list in `UI-UX.md` section 10):
1. Ticket print animation, green "Your turn" state.
2. Wait-number tween and Queue Lane movement.
3. Empty, loading, error, and offline states.
4. Page titles that show the token code and people ahead.
5. Seed data check: no screen looks empty.

---

### Stage 13 (Hour 22 to 23): Rehearse and record
1. Write the README: what Baari is, features, how to run, demo credentials, tech stack, screenshots.
2. Run the **3-minute demo script** from `PRD.md` section 13 three times, with a timer.
3. Record a backup screen video of a perfect run.
4. Prepare 5 slides at most: Problem, Solution, Live demo, Unique features and tech, Impact and next steps.
5. Prepare short answers (section 6 below).

### Stage 14 (Hour 23 to 24): Buffer
Reset the demo data, open the deployed URL to wake the server, charge devices, close extra tabs, and submit.

---

## 3. Priority Ladder (what to cut if you fall behind)

Cut from the bottom upward. Never cut P0.

| Rank | Item | Priority |
|---|---|---|
| 1 | Token creation, queue position, wait estimate | P0 |
| 2 | Staff dashboard: call next, complete, open/close counters | P0 |
| 3 | Notifications (at least "Almost your turn" and "Your turn") | P0 |
| 4 | Simulation and live wait-time change | P0 |
| 5 | Basic analytics (4 numbers) | P0 |
| 6 | Smart Leave Alert, What-If, fair priority | P1 |
| 7 | Display board with voice | P1 |
| 8 | Urdu | P1 |
| 9 | Walk-in print ticket, no-show handling | P1 |
| 10 | Sindhi, best-time hint, Copilot, share link | P2 |
| 11 | Large text and high-contrast toggles, hourly chart polish | P2 |

**Checkpoints:**
- Hour 7: backend core works. If not, simplify (drop recall and transfer).
- Hour 13: official MVP works end to end. If not, skip Display Board and Copilot.
- Hour 17: demo lab works. If not, skip analytics charts; use four numbers only.
- Hour 21: freeze.

---

## 4. Daily Git Habit

- Commit after each stage with a clear message: "Stage 3: queue and wait-time engine".
- Create a `stable` branch at hours 7, 13, and 21. If something breaks late, switch back.
- Never push `.env`; keep `.env.example` instead.

---

## 5. Testing Checklist (run at hours 13, 17, 21, 23)

- [ ] Two phones join at the same second and get different codes.
- [ ] Refreshing the token page keeps the same token and live updates.
- [ ] Opening Counter 3 lowers the estimate; closing raises it.
- [ ] Senior token added later is placed ahead by the bonus.
- [ ] Call next, start, complete updates the board and the phone within a second.
- [ ] No-show after the grace time; recall works once.
- [ ] "Leave now", "Almost", and "Your turn" alerts fire once each.
- [ ] Urdu and Sindhi layouts flip and the token code stays readable.
- [ ] Rush +20 and Reset demo both work without errors.
- [ ] Analytics numbers match the queue.
- [ ] Deployed URL works on mobile data, not just Wi-Fi.

---

## 6. Likely Judge Questions and Short Answers

| Question | Answer |
|---|---|
| How accurate is the wait time? | It uses a transparent formula and learns each service's real speed after every completed token. It shows a range and a confidence label, and says it is an estimate. |
| Why no machine learning? | With a small dataset, a moving average is more reliable and explainable. The design allows an ML model later. |
| How do you stop people faking priority? | Priority is a time bonus, not a queue jump, and staff verify at the counter and can remove it. |
| What about people without phones? | Staff create printable walk-in tokens, and the display board announces numbers by voice. |
| Is it ready for real use? | The demo uses simulated data. A real deployment would connect to a branch's actual counters and add SMS. |
| What if the internet drops? | Token state lives on the server, the page reconnects automatically, and the display board still shows the queue. |
| What is unique? | Smart Leave Alert, What-If staff panel, self-learning estimates, fair priority lanes, and three-language RTL support. |

---

## 7. Demo-Day Checklist

- [ ] Server awake (open the URL 5 minutes before).
- [ ] Demo data reset; Counter 3 closed so you can open it live.
- [ ] Phone browser notifications allowed; volume on.
- [ ] Display board opened on a second screen with sound enabled (tap the overlay once).
- [ ] QR printed or on the display board.
- [ ] Backup video on the desktop and on your phone.
- [ ] Laptop charger, phone charger, hotspot ready.
- [ ] README and GitHub link ready to share.

---

## 8. If Something Breaks During the Demo

1. Say calmly what you are showing, and switch to the backup path (hotspot, local server, or video).
2. Do not debug live in front of judges. Continue with the next step of the script.
3. Mention that the data is simulated; the problem statement allows it.

---

## 9. If You Have Teammates

| Person | Owns |
|---|---|
| You | Backend engines, sockets, deployment |
| Teammate A | Customer UI and Display Board |
| Teammate B | Staff Console, Admin, i18n, demo script and slides |

Agree on the API (`TRD.md` section 6) and the socket events (`TRD.md` section 5) first; then build in parallel against the seed data.

---

## 10. After the Hackathon

Keep the project: add it to your portfolio and GitHub. It shows real-time systems, queue algorithms, multilingual UI, and deployment. These are strong skills for a fullstack developer path.
