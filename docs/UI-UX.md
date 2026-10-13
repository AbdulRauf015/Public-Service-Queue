# Baari: UI/UX Design Document

> File is named `UI-UX.md` because a slash is not allowed in file names.

---

## 1. Design Direction

**Subject:** a public-service queue. People are tired, standing, holding a phone in one hand, often in a hurry, and sometimes reading Urdu or Sindhi instead of English.

**Primary job of the design:** answer three questions instantly: *Where am I in line? How long will it take? What do I do next?*

**The one memorable thing (spend boldness here only):**
The **ticket stub**. Every customer's main screen is a big, tactile paper token with a perforated edge, like the ones from a real counter dispenser. When you join, it "prints" out of a slot. When it is your turn, it turns green. Everything else on the page stays quiet and disciplined so the ticket is the star.

**Supporting idea:** the **Queue Lane**, a single horizontal strip of small person-dots that shows you moving toward the counter as people ahead of you get served.

### What was changed from generic defaults
| Default we avoided | What we do instead |
|---|---|
| Cream background with serif and terracotta accent | Cool mist-blue background, navy ink, ticket-yellow used only on the stub |
| Near-black with neon accent | Light, high-contrast interface readable in bright hospital corridors |
| Identical rounded cards with soft grey shadows | Different shapes for different jobs: perforated ticket, flat bordered panels, pill chips; one shadow only (on the ticket) |
| ALL-CAPS eyebrow labels, middle-dot meta strings, arrows on buttons | Sentence case, plain labels, buttons that say exactly what they do |
| Fade-and-slide on every section | One orchestrated moment (ticket print) and motion only in response to user action or queue change |

---

## 2. Design Tokens

### 2.1 Color

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#14213D` | Text, headings, staff sidebar |
| `--mist` | `#EEF2F8` | Page background |
| `--paper` | `#FFFFFF` | Panels and inputs |
| `--signal` | `#2F5BEA` | Primary buttons, focus ring, your dot in the Queue Lane |
| `--ticket` | `#FFD23F` | Ticket stub only (and priority lane marker) |
| `--go` | `#14A37F` | Your turn, completed, counter open |
| `--flag` | `#D9462F` | No-show, error, counter closed |
| `--hold` | `#E0A100` | Paused counter, "learning" confidence |
| `--muted` | `#5B6785` | Secondary text (contrast checked on mist) |
| `--line` | `#D5DCEA` | 1px borders |

Dark mode is out of scope. Use high contrast instead (see accessibility).

### 2.2 Typography

| Role | Font | Notes |
|---|---|---|
| Display and numbers | **Archivo** (variable, width axis) | Use the condensed-to-normal width for big token numbers; `font-variant-numeric: tabular-nums` |
| Body and UI | **Figtree** | Friendly, clear at small sizes |
| Urdu | **Noto Nastaliq Urdu** | Needs tall line-height (about 2.0) |
| Sindhi | **Noto Naskh Arabic** | Line-height about 1.8 |

Load from Google Fonts with `display=swap` and set fallbacks (`system-ui, sans-serif`).

**Type scale:** 12, 14, 16, 20, 28, 40, 72, 120 px.
Body is 16 px minimum. Line length stays under 70 characters. Token code always renders left-to-right (`dir="ltr"`) even in Urdu and Sindhi.

### 2.3 Spacing, shape, elevation
- Base unit 4 px; common steps 8, 12, 16, 24, 32, 48.
- Radii by role: ticket 14 px with notches, panels 8 px, inputs 10 px, chips and buttons full pill.
- No decorative shadows. Panels use a 1 px `--line` border. The ticket has one soft shadow: `0 10px 24px rgba(20,33,61,.18)`.

### 2.4 Copy-paste CSS starter (`tokens.css`)

```css
:root{
  --ink:#14213D; --mist:#EEF2F8; --paper:#fff; --signal:#2F5BEA;
  --ticket:#FFD23F; --go:#14A37F; --flag:#D9462F; --hold:#E0A100;
  --muted:#5B6785; --line:#D5DCEA;
  --r-panel:8px; --r-input:10px; --r-ticket:14px;
  --font-display:'Archivo',system-ui,sans-serif;
  --font-body:'Figtree',system-ui,sans-serif;
}
html[lang="ur"]{--font-body:'Noto Nastaliq Urdu',serif; line-height:2}
html[lang="sd"]{--font-body:'Noto Naskh Arabic',serif; line-height:1.8}
body{background:var(--mist);color:var(--ink);font-family:var(--font-body);font-size:16px}
.num{font-family:var(--font-display);font-variant-numeric:tabular-nums}
:focus-visible{outline:3px solid var(--signal);outline-offset:2px}

/* Ticket stub with side notches and a perforated divider */
.ticket{
  background:var(--ticket); color:var(--ink); border-radius:var(--r-ticket);
  padding:20px 20px 16px; position:relative;
  box-shadow:0 10px 24px rgba(20,33,61,.18);
  -webkit-mask:
    radial-gradient(circle 10px at 0 62%, #0000 98%, #000) left/51% 100% no-repeat,
    radial-gradient(circle 10px at 100% 62%, #0000 98%, #000) right/51% 100% no-repeat;
          mask:
    radial-gradient(circle 10px at 0 62%, #0000 98%, #000) left/51% 100% no-repeat,
    radial-gradient(circle 10px at 100% 62%, #0000 98%, #000) right/51% 100% no-repeat;
}
.ticket .perf{border-top:2px dashed rgba(20,33,61,.35); margin:14px 0}
.ticket.is-turn{background:var(--go); color:#fff}

@media (prefers-reduced-motion:no-preference){
  .ticket.printing{animation:print .7s cubic-bezier(.2,.8,.2,1) both}
  @keyframes print{from{transform:translateY(-40px);opacity:0}to{transform:none;opacity:1}}
}
```

Use CSS logical properties (`margin-inline-start`, `padding-inline-end`, `text-align:start`) everywhere so Urdu and Sindhi flip correctly with `dir="rtl"`.

---

## 3. Screen Map

| Screen | Path | Audience |
|---|---|---|
| Join | `/q/:branchId` | Citizen (QR landing) |
| My Token | `/t/:publicId` | Citizen |
| Display Board | `/display/:branchId` | Everyone, on a TV |
| Staff Login | `/login` | Staff |
| Staff Console | `/staff` | Operator |
| Admin and Analytics | `/admin` | Manager |
| Printed Ticket | print view from Staff Console | Assisted visitor |

---

## 4. Screen Designs

### 4.1 Join (mobile, 360 px wide)

Left-aligned (right-aligned automatically in Urdu and Sindhi). One column, one decision per step, one primary button.

```
+------------------------------------+
|  Baari            [ EN | اردو | سنڌي ] |
|                                    |
|  Skip the line.                    |
|  Keep your turn.                   |
|                                    |
|  City Civic Center       (demo data)|
|  Busy now:  [====---] Moderate     |
|                                    |
|  What do you need?                 |
|  ( ) Registration     ~12 min      |
|  (x) Lab tests        ~24 min      |
|  ( ) Pharmacy         ~6 min       |
|                                    |
|  Need priority?   [None v]         |
|  How far away are you? [ 20 ] min  |
|  (optional, we will tell you       |
|   when to leave)                   |
|                                    |
|  [        Get my token         ]   |
|                                    |
|  Quietest time today: 2 to 3 pm    |
+------------------------------------+
```

Notes:
- Service rows show the live estimate so people choose smartly.
- **Busy meter** has four steps: Quiet, Moderate, Busy, Very busy, with text as well as color.
- Priority selector opens a small note: "Staff will check at the counter."
- Language switch is always visible at the top and is remembered.

### 4.2 My Token (the hero screen)

```
+------------------------------------+
|  Lab tests                         |
|  +------------------------------+  |
|  |   Your token                 |  |
|  |                              |  |
|  |       L - 0 1 4              |  |  <- 120 px Archivo, ticket yellow
|  |- - - - - - - - - - - - - - - |  |  <- perforation
|  |  7 people ahead              |  |
|  |  Estimated wait 14 to 20 min |  |
|  |  Confidence: Good            |  |
|  +------------------------------+  |
|                                    |
|  Queue lane                        |
|  o o o o o o o (you) . . . [Ctr]   |
|                                    |
|  I am [ 20 ] min away   [Update]   |
|  We will say "Leave now" in 6 min. |
|                                    |
|  [ Share link ]   [ Cancel token ] |
|                                    |
|  Estimates update live. They are   |
|  not promises.                     |
+------------------------------------+
```

**States of the ticket**
| State | Look | Message |
|---|---|---|
| Waiting | Yellow ticket | "7 people ahead" |
| Leave soon | Yellow ticket with blue banner | "Leave now. You will reach Counter 3 just before your turn." |
| Almost | Yellow ticket, banner turns amber | "Almost your turn. 3 people ahead." |
| Called | Ticket turns **green**, one soft pulse | "Your turn. Go to Counter 3." and a large **I'm here** button, with the grace countdown |
| Serving | Green ticket, calm | "Being served at Counter 3" |
| Done | White ticket | "Done. How was it?" with five rating buttons |
| No-show | Grey ticket | "You missed your turn. Ask staff to recall your token." |
| Cancelled | Grey ticket | "Token cancelled. Get a new token" |
| No counter open | Yellow ticket | "No counter is open for Lab tests right now. We will tell you when one opens." |

**Queue Lane details**
- One dot per person ahead (cap at 12 dots, then show "+N").
- Your dot is `--signal` with your code; others are `--line`.
- When someone is served, dots shift one step toward the counter with a 300 ms transform. This is motion that answers a real change.
- Priority-lane people ahead of you are marked with a small yellow dot and a tooltip: "Priority visitor".

### 4.3 Staff Console (laptop, three-pane control room)

```
+---------+-----------------------------------+--------------------+
| Baari   |  Counters                         |  Waiting (14)      |
| Staff   |  +--------+ +--------+ +--------+ |  L-014  Lab  12m   |
|         |  | Ctr 1  | | Ctr 2  | | Ctr 3  | |  L-015  Lab  9m *  |
| Queue   |  | OPEN   | | OPEN   | | CLOSED | |  R-021  Reg  7m    |
| Analytics|  | L-011  | | idle   | | [Open] | |  P-006  Pharm 3m   |
| Settings|  | 02:10  | | [Call] | |        | |  ...               |
| Demo    |  | [Done] | |        | |        | |                    |
| Lab     |  +--------+ +--------+ +--------+ |  * priority        |
|         |                                   |                    |
|         |  Staff Copilot                    |  [+ Walk-in token] |
|         |  Lab wait is 24 min. Open Counter |                    |
|         |  3 to bring it to 13 min. [Open]  |                    |
+---------+-----------------------------------+--------------------+
```

Rules:
- Counter tiles differ from queue rows (tiles are tall and show a timer; rows are compact). They are not the same card repeated.
- **Call next** is the biggest button on the screen and also bound to the keyboard shortcut `N`.
- Status uses color **and** text: Open (green), Paused (amber), Closed (red).
- Priority rows carry a yellow marker and the reason ("Senior, verify at counter").
- Every action confirms with a toast using the same verb as the button.

### 4.4 Simulation Lab and What-If (drawer inside Staff Console)

```
+----------------------------------------+
| Demo Lab                    (Demo mode) |
|                                        |
| [ Add 20 people ]  [ Reset demo ]      |
| Arrivals per minute  --o-------  4     |
| [x] Auto-serve at counters             |
| [ Pause Counter 2 ]                    |
|                                        |
| What if...                             |
| Open 1 more counter for [Lab v]        |
|   Now: 24 min    After: 13 min         |
|   Saves 11 min    [Open it]            |
+----------------------------------------+
```

Design intent: make the cause and effect between a slider and the wait number obvious on a projector. Use a large count-up/count-down animation on the wait number (animates only when the value changes).

### 4.5 Display Board (TV, 1920 x 1080, read from 5 metres)

```
+-------------------------------------------------------------+
|  City Civic Center                              10:42 AM    |
|-------------------------------------------------------------|
|  Now serving                                                |
|   L-011   >  Counter 1                                      |
|   R-020   >  Counter 2                                      |
|   P-005   >  Counter 4                                      |
|                                                             |
|  Next                                                       |
|   L-012    L-013    R-021    P-006    L-014                 |
|-------------------------------------------------------------|
|  Scan to join:  [QR]      Average wait today: 11 min        |
+-------------------------------------------------------------+
```

- Minimum text size 48 px for tokens; high contrast.
- When a token is called: that row flashes once, a chime plays, then voice says "Token L-011, Counter 1".
- Add a one-time "Tap to enable sound" overlay because browsers block auto audio until a click.

### 4.6 Admin and Analytics

```
+-------------------------------------------------------------+
| Today   [Today | 7 days]               (include demo data)  |
|                                                             |
| Average wait   Average service   Completed   In queue now   |
|   11 min          3.2 min           86           14         |
|                                                             |
| Arrivals and wait by hour       |  Counter performance      |
| [bar + line chart]              |  Ctr 1  41 served  2.9 m  |
|                                 |  Ctr 2  33 served  3.4 m  |
| Quietest hours (best to visit)  |  Ctr 3  12 served  3.1 m  |
| 2-3 pm   9-10 am   4-5 pm       |  No-show rate  6%         |
+-------------------------------------------------------------+
```

Use only 4 stat figures, one combined chart, and one table. Do not add more charts.

### 4.7 Printed Walk-in Ticket (for visitors without phones)

Thermal-receipt style (58 mm wide, `@media print`): token code in 48 pt, service name, people ahead, estimated wait, QR to follow on a phone, and a line "Watch the board for your number." Simple, black on white.

### 4.8 Staff Login
Single centered form, two fields, one button "Sign in". Show demo credentials in a small note for judges ("Demo: staff@baari.test / demo1234").

---

## 5. Interaction and Motion Rules

| Moment | Motion | Notes |
|---|---|---|
| Token created | Ticket slides out of a slot (about 0.7 s), once | The single orchestrated moment |
| Position changes | Queue Lane dots shift 300 ms | Responds to real change |
| Wait number changes | Count tween 400 ms | Only when value changes |
| Your turn | One soft pulse on the green ticket, plus vibration and sound | Not looping |
| Button press | Immediate pressed state, 100 ms | |
| Everything else | No entrance animations, no hover flourishes | Respect `prefers-reduced-motion` |

---

## 6. Copy (Voice and Microcopy)

Tone: calm, plain, short. Active voice. Sentence case. Buttons name the exact result. Errors say what happened and how to fix it. No apologies, no jokes.

| Place | Text |
|---|---|
| Join button | Get my token |
| Token created toast | Token L-014 created |
| Waiting | 7 people ahead |
| Estimate label | Estimated wait 14 to 20 min |
| Honest note | Estimates update live. They are not promises. |
| Leave alert | Leave now. You will reach Counter 3 just before your turn. |
| Almost alert | Almost your turn. 3 people ahead. |
| Turn alert | Your turn. Go to Counter 3. |
| Staff buttons | Call next, Start serving, Complete, Mark no-show, Recall, Open counter, Pause counter, Close counter |
| Demo buttons | Add 20 people, Open one more counter, Reset demo |
| Empty queue (staff) | No one is waiting. New tokens will appear here. |
| No counter open | No counter is open for Lab tests right now. We will tell you when one opens. |
| Notification blocked | Notifications are off. Keep this page open, or turn on notifications in your browser settings. |
| Offline chip | Reconnecting... |
| Server error | Could not create your token. Check your connection and try again. |
| Priority note | Staff will check priority at the counter. |

### Sample translations
**Ask a native speaker to verify the Sindhi before the demo.**

| Key | English | Urdu | Sindhi |
|---|---|---|---|
| `get_token` | Get my token | میرا ٹوکن لیں | منهنجو ٽوڪن وٺو |
| `people_ahead` | people ahead | لوگ آپ سے آگے | ماڻهو توهان کان اڳيان |
| `est_wait` | Estimated wait | اندازاً انتظار | اندازي مطابق انتظار |
| `your_turn` | Your turn | آپ کی باری ہے | توهان جي واري آهي |
| `minutes` | min | منٹ | منٽ |

Store strings in `locales/en.json`, `ur.json`, `sd.json`; a small `t('key')` helper swaps text and sets `lang` and `dir` on `<html>`.

---

## 7. Accessibility Checklist

- Contrast at least 4.5:1 for text (`--ink` on `--mist`, white on `--signal` and on `--go`; check `--muted` on `--paper`).
- Never use color alone: statuses include text and an icon shape.
- Visible keyboard focus (blue outline) on every control; logical tab order; `N` shortcut documented.
- Touch targets at least 44 x 44 px.
- Live regions: `aria-live="polite"` on position and wait updates; `aria-live="assertive"` on "Your turn".
- Large-text toggle (A+) scales base font to 20 px.
- High-contrast toggle switches to pure white background and ink text.
- Voice announcement on the display board plus vibration on phones.
- Reduced motion: remove ticket slide and dot transitions.
- Simple, short sentences (reading level suitable for everyone).

---

## 8. Responsive Rules

| Width | Layout |
|---|---|
| 360 to 599 px | Single column, sticky bottom action bar on Join and My Token |
| 600 to 1023 px | Single column centered, max 560 px |
| 1024 px and up | Staff Console becomes three panes; Admin becomes two columns |
| TV | Display Board uses fixed 16:9 layout with large type |

Always test at 360 px first, then 1366 px, then the TV layout.

---

## 9. Screen States Checklist (build each one)

For every screen: **loading** (skeleton lines, no spinner walls), **empty**, **error**, **offline**, and **success**. For My Token also: called, serving, done, no-show, cancelled, no counter open.

---

## 10. Demo Polish List (do last, in this order)

1. Ticket print animation and green "Your turn" state.
2. Wait number tween and Queue Lane movement.
3. Display Board voice and chime.
4. Urdu and Sindhi layouts (check RTL on every screen).
5. Real QR on the display board and printed ticket.
6. Favicon, page titles with the token code (for example "L-014 · 7 ahead" updates in the browser tab).
7. Consistent seed data so no screen looks empty.
