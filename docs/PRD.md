# Baari: Smart Queue & Wait-Time Optimizer
### Product Requirements Document (PRD)

**Hackathon problem:** SC-03, Public Service Queue and Wait-Time Optimizer (Smart Communities & Public Services)
**Product name:** Baari (باری, "your turn" in Urdu and Sindhi)
**Tagline:** *Wait anywhere. Be there when it's your baari.*
**Duration:** 24-hour hackathon build
**Data:** Simulated counters and customers (allowed by the problem statement)

---

## 1. Summary

Baari replaces the physical line at hospitals, banks, and government counters with a digital queue. A citizen scans a QR code, gets a token, and sees a live position and an honest wait-time estimate. Staff run counters from a dashboard. The system learns how fast each service really is, warns people when to leave home, and shows staff what would happen if they open one more counter.

---

## 2. Problem

- People stand in lines for hours with no idea when their turn comes.
- They cannot leave, even to eat, pray, or sit down, because they might miss their number.
- Elderly, disabled, and pregnant visitors suffer the most.
- Staff cannot see demand building, so they open counters late.
- Managers have no data on peak hours, slow counters, or no-shows.

---

## 3. Vision and Goals

**Vision:** Nobody should have to stand in line to wait for a public service.

**Goals (in order):**
1. Cover every MVP item in the SC-03 problem statement completely and reliably.
2. Make the wait time believable, explainable, and visibly responsive in a live demo.
3. Add a small number of unique features that judges will remember.
4. Deliver a polished, mobile-first, multilingual UI that works for ordinary citizens.

**Non-goals (will not build):**
- Real integration with any bank, hospital, or government system.
- Paid SMS or WhatsApp APIs (browser notifications are enough).
- Machine learning models (a transparent moving-average method is used on purpose).
- Payments, appointments for future dates, or user accounts for customers.

---

## 4. Users and Personas

| Persona | Who | Needs |
|---|---|---|
| **Ayesha, the Citizen** | 28, office worker, smartphone | Join the line from her phone, know when to leave, avoid wasting her lunch break |
| **Baba Raza, Assisted Visitor** | 70, no smartphone | A printed ticket handed over by staff, large display board, voice announcement |
| **Imran, Counter Operator** | Staff at Counter 2 | Call the next person in one click, handle no-shows, see what is coming |
| **Dr. Sana, Branch Manager** | Runs the branch | See wait times, peak hours, and advice on how many counters to open |

---

## 5. Core User Journeys

**Citizen journey**
1. Scans the QR code at the entrance, or opens the link.
2. Picks a service (for example Registration, Lab, Pharmacy), language, and optional priority type.
3. Optionally enters "I am 20 minutes away".
4. Gets a token such as **A-023** with position, people ahead, and estimated wait range.
5. Leaves. The page updates live and sends alerts: *Time to leave*, *Almost your turn*, *Go to Counter 3*.
6. Gets served and optionally rates the experience.

**Staff journey**
1. Logs in and opens or closes counters.
2. Presses **Call next**. The token appears on the display board with a sound.
3. Marks started, completed, or no-show.
4. Can issue a walk-in (printed) token for visitors without phones.
5. Reads the Staff Copilot suggestions and analytics.

---

## 6. Features

Priority legend: **P0** = must ship, **P1** = unique feature that wins points, **P2** = stretch only if time remains.

### 6.1 Official MVP (maps 1:1 to the problem statement)

| ID | Priority | Feature | Official MVP item |
|---|---|---|---|
| F-01 | P0 | Digital token generation via web form and QR code | "Generate digital tokens through web interface or QR code" |
| F-02 | P0 | Live queue position and estimated waiting time | "Display queue position and estimated waiting time" |
| F-03 | P0 | Staff dashboard: counter allocation, queue updates | "Staff dashboard for counter allocation and queue updates" |
| F-04 | P0 | Notification when turn is approaching | "Notify users when their turn is approaching" |
| F-05 | P0 | Basic analytics: average wait, completed tokens, queue length | "Basic analytics" |
| F-06 | P0 | Simulated counters and arrivals with visible effect on wait time | "Demonstrate how estimated waiting times change" |

### 6.2 Unique features (the differentiators)

| ID | Priority | Feature | Why it matters |
|---|---|---|---|
| U-01 | P1 | **Smart Leave Alert**: user enters travel time; Baari notifies "leave now" so they arrive just before their turn | Turns a queue into "wait anywhere", the core promise |
| U-02 | P1 | **Self-learning wait time**: each service's average time is updated after every completed token (exponential moving average), with a confidence label | Estimates get more accurate during the demo itself |
| U-03 | P1 | **What-If Panel for staff**: "Open 1 more counter and Lab wait drops from 24 to 13 min" | Shows the optimizer part of the problem name |
| U-04 | P1 | **Simulation Lab**: rush button, arrival-rate slider, counter break button, reset | Makes the live demo dramatic and controllable |
| U-05 | P1 | **Fair priority lanes**: seniors, disabled, pregnant, emergency get a transparent time bonus, not blind queue-jumping | Inclusive, explainable, and abuse-resistant |
| U-06 | P1 | **Public display board with voice announcement** (`/display`) | Works for people with no phone |
| U-07 | P1 | **Three languages**: English, Urdu, Sindhi, with right-to-left layout | Fits the region and the problem's language theme |
| U-08 | P1 | **Assisted walk-in token**: staff creates a printable ticket in 5 seconds | Inclusion for visitors without smartphones |
| U-09 | P1 | **No-show handling**: grace timer, auto-skip, one-time recall | Keeps the queue moving |
| U-10 | P2 | **Best-time-to-visit** hint based on historical hourly waits | Spreads demand away from peaks |
| U-11 | P2 | **Staff Copilot**: automatic suggestions such as "Move Counter 2 to Lab" | Smart operations without ML |
| U-12 | P2 | **Share my queue link** via WhatsApp for family members | Simple, free, and useful |
| U-13 | P2 | **Large-text and high-contrast mode** | Accessibility |

---

## 7. Functional Requirements

### Tokens
- FR-1: A token belongs to one service and one branch, and has a human-readable code (prefix + number, e.g. `L-014`), reset daily per service.
- FR-2: Token creation requires only a service choice. Name and phone are optional.
- FR-3: A token has these states: `waiting`, `called`, `serving`, `completed`, `no_show`, `cancelled`.
- FR-4: Customers can cancel their own token.
- FR-5: Each token page has a private, unguessable ID, so no login is needed.

### Queue and wait time
- FR-6: Queue order is by effective time (arrival time minus priority bonus).
- FR-7: Wait estimate = `(people ahead x average service time + remaining time of current customers) / open counters`.
- FR-8: Estimates are shown as a **range** and a **confidence label** (Learning, Fair, Good).
- FR-9: If no counter is open for a service, show "No counter open right now" instead of a fake number.
- FR-10: Every estimate is labelled as an estimate.

### Staff
- FR-11: Staff log in; roles are `operator` and `admin`.
- FR-12: Operators can open, close, or pause a counter and call next, start, complete, mark no-show, recall, and transfer a token.
- FR-13: Admins can edit services, counters, priority bonuses, grace time, and alert thresholds.
- FR-14: Staff can create a walk-in token and print it.

### Notifications
- FR-15: Three alert levels: **Leave now**, **Almost your turn** (3 or fewer ahead), **Your turn**.
- FR-16: Delivered by browser notifications, in-page banner, sound, and vibration where supported.
- FR-17: Alerts fire once per level per token.

### Display board
- FR-18: Shows "Now serving" per counter, the next five tokens, and the live clock.
- FR-19: Announces called tokens by voice (Web Speech API), with a chime fallback.

### Analytics
- FR-20: Today view: average wait, average service time, completed tokens, current queue length, no-show rate.
- FR-21: Hourly chart of arrivals and average wait.
- FR-22: Per-counter performance table.

### Simulation
- FR-23: Simulation controls are clearly marked "Demo mode" and only affect simulated tokens.
- FR-24: Simulated customers are labelled and never mixed into real analytics unless demo mode is on.

---

## 8. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Performance | Token page updates within 1 second of any queue change |
| Mobile-first | Fully usable at 360 px width; touch targets at least 44 px |
| Accessibility | Keyboard focus visible, contrast 4.5:1 or better, reduced-motion respected, large-text mode |
| Reliability | App must survive a refresh; token state lives in the database, not the browser |
| Privacy | No phone number or name required; no data sold or shared; demo data is fictional |
| Cost | Entire stack runs on free tiers |
| Languages | English, Urdu, Sindhi (RTL for Urdu and Sindhi) |

---

## 9. Success Metrics (for the demo and for judges)

- A new user can join the queue in **under 15 seconds** and 3 taps.
- Wait estimate visibly **changes within 1 second** when a counter opens or a rush is simulated.
- Estimate error falls as the simulation runs (shown by the confidence label moving from Learning to Good).
- All 6 official MVP items demonstrated live without a page refresh.
- The 3 unique features judges remember: Smart Leave Alert, What-If Panel, voice display board.

---

## 10. Honesty and Safety Notes

- All counters, customers, and hospitals in the demo are **simulated**; the app shows a "Demo data" badge.
- Priority claims (senior, disabled, pregnant) are **verified by staff at the counter**. Staff can demote an invalid claim.
- Wait times are **estimates**, never promises. The UI says so.
- No sensitive personal data is collected.

---

## 11. Mapping to Judging Criteria

| Typical criterion | How Baari answers it |
|---|---|
| Problem fit | All official MVP items, plus the simulation scope item |
| Innovation | Smart Leave Alert, What-If Panel, self-learning estimates, fair priority lanes |
| Technical depth | Real-time sockets, atomic token numbering, queue engine, notification scheduler |
| UI/UX | Ticket-stub design, live queue lane, 3 languages with RTL, accessible |
| Impact | Saves time, includes elderly and disabled people, reduces crowding |
| Feasibility | Simple stack, free hosting, no paid services |
| Presentation | Controlled 3-minute demo with rush simulation |

---

## 12. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Browser notifications blocked by the phone | In-page banner, sound, vibration, and the display board as backups |
| Wi-Fi failure at the venue | Run everything locally and share via phone hotspot; keep a recorded demo video |
| Time overrun | Strict cut line: P0 first, P1 by hour 17, nothing new after hour 21 |
| Urdu or Sindhi voice not available | Fall back to chime and large visual token |
| Sindhi translation errors | Keep strings few and short; verify with a native speaker |

---

## 13. Three-Minute Demo Script

1. **(0:00) Problem.** One sentence: "Standing in line wastes hours and excludes the elderly."
2. **(0:20) Join.** Scan the QR with a phone, pick Lab, enter "20 min away". Token **L-012** appears with a 24 min estimate.
3. **(0:50) Staff view.** Dashboard shows the queue. Press **Rush +20**. The phone's wait jumps live.
4. **(1:20) What-If.** Open the What-If panel, press "Open 1 more counter". Estimate drops from 24 to 13 min on the phone.
5. **(1:50) Fair priority.** A senior token joins and moves forward by the configured bonus, with the reason shown.
6. **(2:10) Display board.** Call next. The board lights up, a voice announces the token, the phone notifies "Your turn".
7. **(2:30) Languages.** Switch the phone to Urdu, then Sindhi. Layout flips right-to-left.
8. **(2:45) Analytics.** Show average wait, completed tokens, and the hourly chart.
9. **(2:55) Close.** "Wait anywhere. Be there when it's your baari."

---

## 14. Future Roadmap (mention only, do not build)

- Real SMS and WhatsApp alerts, appointment slots, multi-branch network view, and a prediction model trained on real historical data.
