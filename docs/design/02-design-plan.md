# Lobbyee — Design Execution Plan

> How we go from the IA (`01-ia-and-flows.md`) to wireframes to high-fidelity Figma designs to code handoff — using AI at every stage. This doc is also a learning artifact: each stage names the tool, the technique, and the failure mode to avoid.

---

## 0. Goals

1. **Product goal:** validate the structure of the core loop (assign → train → feedback → dashboard) on screens before writing app code. Moving a box in a wireframe is free; moving it in React is not.
2. **Learning goal:** practice the full AI-assisted design pipeline — IA → flows → lo-fi → tokens → hi-fi → design-to-code handoff — so it's repeatable for every future project.

---

## 1. The pipeline, stage by stage

| # | Stage | Tool / skill | Output | Status |
|---|---|---|---|---|
| 1 | Information architecture | `ui-ux` agent | `01-ia-and-flows.md` §1 | ✅ done |
| 2 | User flows | `ui-ux` agent | `01-ia-and-flows.md` §2 | ✅ done |
| 3 | **Lo-fi wireframes** | Figma MCP — `figma-generate-design` skill (load first), `create_new_file`, `use_figma` | Grayscale frames in Figma, batched | Batches 1–3 ✅ (2026-06-11) — wireframe phase built, pending founder review |
| 4 | Review & iterate | Mayank in Figma + `get_screenshot` to pull frames back into chat | Comments resolved, sign-off per batch | |
| 5 | Foundations / tokens | Figma (`figma-generate-library` skill) | Colors, type scale, spacing, core components — mapped to Tailwind/shadcn names | |
| 6 | Hi-fi screens | Figma MCP, building on tokens + signed-off wireframes | Polished designs for the signed-off screens | |
| 7 | Handoff to code | `get_design_context` / `get_screenshot` / Code Connect → `web-frontend` agent | Pixel-faithful Next.js components | build phase |

**Key workflow lesson:** AI design generation is cheap to *create* and expensive to *surgically edit*. So we (a) nail structure at lo-fi where regeneration is painless, (b) build shared components/tokens BEFORE hi-fi so consistency is structural rather than per-screen luck, and (c) regenerate whole frames rather than nudging individual layers when a layout is wrong.

---

## 2. Figma file organization

One Figma file: **"Lobbyee — Product Design"** — https://www.figma.com/design/zuU8iD7elXyGsLoX8qcvCg (lives in the *Mayank Goel's team* Education team — moved there from the Starter team because Starter caps Figma MCP tool calls AND pages-per-file at 3; Education = free Professional tier).

```
Pages:
00 Cover            — project name, status, links to docs
01 Foundations      — tokens, type, color, components (stage 5)
02 WF · Staff       — wireframes, mobile 390×844 frames
03 WF · Manager     — wireframes, desktop 1440×900 frames
04 WF · States      — edge/error/empty state variants
05 Hi-fi            — stage 6
99 Archive          — rejected explorations (never delete, move here)
```

Frame naming convention: `area/screen/state` — e.g. `staff/live-session/listening`, `manager/dashboard/cold-start`. This matters because frame names become our shared vocabulary in review ("change `staff/feedback/ready`") and later map to routes/components in code.

Canvas sizes: **390×844** (iPhone-class, staff screens, portrait only), **1440×900** (manager screens). No tablet frames in pass one — responsive behavior is described in annotations, designed only if a breakpoint is genuinely ambiguous.

---

## 3. Wireframe batches (scope + order)

### Batch 1 — The hero pair (designed together; they share the transcript metaphor)

| Frame | Why it exists |
|---|---|
| `staff/live-session/ready` | Baseline layout: avatar, mood strip, caption area, mic, secondary bar |
| `staff/live-session/listening` | Mic active, partial transcript streaming |
| `staff/live-session/guest-speaking` | Avatar pulsing, mic disabled, captions crawling |
| `staff/live-session/text-mode` | Avatar collapsed to 25%, chat UI — the fallback IS a first-class design |
| `staff/live-session/network-degraded` | Reconnect banner + "switch to text?" offer |
| `staff/live-session/end-confirm` | Confirm sheet — ending must feel deliberate, not accidental |
| `staff/feedback/ready` | Overall card, 4 competency rows, one expanded with evidence cards |
| `staff/feedback/evidence-jump` | Transcript section with inline green/amber markers + highlight animation target |
| `staff/feedback/pending` | "Coaching is being prepared" skeleton — the eval-latency moment |
| `staff/feedback/eval-failed` | Honest failure + transcript still available |

### Batch 2 — The loop around the heroes

| Frame | Why |
|---|---|
| `staff/pre-session-brief/default` | Carries the load-bearing "Tap to start" (iOS audio unlock) |
| `staff/pre-session-brief/mic-denied` | The #1 funnel-killer path — must offer text, never dead-end |
| `staff/pre-session-brief/cap-reached` | Billing boundary surfaces to a non-paying user — tone matters |
| `staff/assignments/default` + `/cold-start` | Staff home; cold start sets the product's tone |
| `manager/dashboard/populated` | The manager hero — KPI row, staff table, top-missed panel |
| `manager/dashboard/cold-start` | The "looks broken" risk — full-bleed empty state + checklist |
| `manager/persona-editor/default` | Pins the constrained-form decision before scope creep |

### Batch 3 — Pattern reuse (after batches 1–2 are signed off)

Assignment wizard, scenario editor, team list + invite modal, staff profile drill-in, session replay (manager variant of feedback), settings/billing, auth screens, invite landing, onboarding checklist. These reuse the visual language set above; wireframing them is fast and low-risk once the patterns exist.

**Gate between batches:** Mayank reviews in Figma (or via screenshots in chat), gives plain-language feedback ("the mood strip draws my eye too much"), we regenerate affected frames. No batch starts until the previous one is signed off — later batches inherit the patterns, so churn upstream multiplies downstream.

---

## 4. Edge-case matrix

### 4a. Cross-cutting states (apply to nearly every screen — wireframe once as patterns on page `04 WF · States`)

| State pattern | Design rule |
|---|---|
| **Cold start / empty** | Every list/dashboard has a designed empty state with one clear next action. Empty ≠ blank. |
| **Loading** | Skeletons matching final layout, not spinners, for anything > 300ms. |
| **Error + retry** | Inline, human copy, always a retry or escape path. Never raw error codes. |
| **Permission denied (mic)** | Immediate same-scenario text continuation. Never a dead end. |
| **Cap reached** | Different copy per role: staff get "ask your manager," owners get the upgrade CTA. |
| **Offline / degraded network** | Banner + graceful degradation; partial transcript always preserved. |
| **Pending (eval latency)** | Honest ETA copy + skeleton + "we'll notify you" exit. The 30–90s eval wait is a designed moment, not a gap. |
| **Role-based visibility** | Manager vs staff variants explicitly framed where they differ (feedback vs replay). |
| **Reduced motion** | Every animation has a static/fade equivalent. Noted as annotation, not separate frames. |

### 4b. Screen-specific edge cases that MUST be designed (not discovered in code)

| Screen | Edge case | Why it's dangerous if undesigned |
|---|---|---|
| Live session | Guest speaking when user barges in | Without a designed interrupt affordance, trainees wait politely for an AI — unrealistic training |
| Live session | 90s silence | Auto-ending feels like surveillance; we design the gentle "Still there?" prompt |
| Live session | Mid-session voice→text switch | If layout jumps jarringly, users fear the toggle and stay stuck in broken voice |
| Live session | Very long guest reply | Caption area must scroll/truncate gracefully on 390px |
| Feedback | Score with zero evidence | Empty evidence section reads as "the AI has no reason" — destroys trust; needs explicit copy |
| Feedback | Partial eval (3 of 4 competencies done) | Show ready ones progressively, not all-or-nothing |
| Feedback | 1/5 score | The most emotionally loaded state in the product — coaching copy is load-bearing |
| Feedback | Multiple citations on one message | Markers must stack, not overlap illegibly |
| Dashboard | 1 staff member, 1 session | Averages of n=1 mislead; design the low-data treatment (show sessions, suppress trends) |
| Dashboard | Staff invited, none accepted | "Pending" state with resend, distinct from cold start |
| Persona editor | Voice preview fails to load | Don't block saving on a preview |
| Pre-session brief | Token/connection fails after tap | The user already did the magic gesture; retry must not require re-tap ceremony |
| Invite landing | Expired / already-used token | Most common real-world invite outcome after "works" |
| Assignments | Overdue assignment | Pressure framing: due-date chip, not red alarm |

### 4c. Deliberately NOT designed in pass one

Tablet layouts, dark mode, localization/RTL, leaderboards (never, per UX risk #2), manager free-text persona prompts (v2 behind flag), notification emails (copy doc, not Figma), marketing site (separate later effort — different design language than the app).

---

## 5. Sample data pack (canonical, used in every frame)

AI-generated screens look fake when every generation invents new placeholder data. We fix one canonical dataset and reuse it everywhere — frames stay coherent, reviews compare like-to-like, and the same data later seeds the dev database and the demo environment.

- **Workspace:** *The Marlowe Hotel* (boutique, 24 staff)
- **Manager:** Priya Sharma (owner)
- **Staff:** Daniel Okafor (front desk, our protagonist), Sofia Reyes, James Park, Aisha Khan
- **Personas:** *Maria Castellanos*, 34, business traveler — frustrated about a disputed minibar charge, baseline mood tense; *Robert Lindqvist*, 61, elite-tier loyalty guest — polite but demanding, high expectations
- **Scenarios:** "Disputed minibar charge" (difficulty 3), "Late check-in, room not ready" (difficulty 2), "VIP early check-in request during full house" (difficulty 4)
- **The canonical session:** Daniel × Maria × disputed charge, 5m42s, voice, 14 turns. Scores: Empathy 4, Clarity 3, Problem-solving 5, Professionalism 4. Strength quote: *"I completely understand — let me pull up the charges right now so we can look at this together."* Missed-opportunity quote: *"That's just our policy."* (evaluator suggests: explain the why before citing policy). Mood arc: frustration 72 → 31.
- **Dashboard numbers:** 38/50 sessions used; Daniel trending up in empathy, Sofia flat, James 2 sessions only (low-data treatment), Aisha invite pending.

A short transcript excerpt (8–10 turns) gets written once during Batch 1 and reused verbatim in live-session and feedback frames.

---

## 6. Bottlenecks & mitigations

### 6a. Product/UX bottlenecks (what the designs must solve)

1. **The mic-permission funnel** — one tap must do everything (audio unlock + permission + connect), and the denial path lands in text mode with zero shame. This is the highest-leverage screen sequence in the product.
2. **The eval-latency moment** — 30–90s between "End session" and feedback. Designed as a breathing space ("coaching is being prepared") with a notify-me exit, or it reads as breakage.
3. **Cold start everywhere** — a new workspace has no staff, personas, sessions, or data. Every first-run screen must look intentional, or the trial dies in minute two.
4. **Mood-strip legibility vs distraction** — too prominent = scoreboard that breaks immersion; too subtle = the feature doesn't exist. The wireframe review explicitly tests this balance.
5. **Trust framing of feedback** — staff must not feel surveilled. Coaching microcopy is part of the design deliverable, not a copywriting afterthought.

### 6b. AI-workflow bottlenecks (what WE must work around — the learning content)

1. **Consistency drift across generations.** Each AI generation call is independent — fonts, spacing, and component shapes drift between screens. *Mitigation:* one foundations/components pass before hi-fi; in lo-fi, batch related screens in the same generation request; keep one canonical frame as the style reference.
2. **Iteration granularity.** "Move that button 8px" via AI is slower than doing it by hand in Figma. *Mitigation:* AI generates structure and variants; micro-nudges happen by hand in the Figma editor (you can drag things — that's allowed and faster); structural rework = regenerate the frame.
3. **Lorem-ipsum syndrome.** Generated screens with random placeholder content can't be evaluated. *Mitigation:* the sample data pack (§5) goes into every generation prompt.
4. **Over-fidelity too early.** AI loves making things pretty; a beautiful wrong layout gets attachment. *Mitigation:* lo-fi prompts explicitly demand grayscale, system font, boxes-and-labels only.
5. **The review loop needs eyes.** I can generate and screenshot frames back into chat (`get_screenshot`), but Mayank reviewing inside Figma directly is higher-bandwidth. *Mitigation:* both — screenshots in chat for quick passes, Figma comments for real review.
6. **Skill prerequisites.** The Figma MCP requires loading `figma-generate-design` (and `figma-use` before `use_figma` calls) — skipping these produces worse output. Process note: load the skill at the start of every design session.
7. **Generation limits.** Large multi-frame generations can fail or time out. *Mitigation:* generate per-screen or per-small-batch; never "the whole app in one prompt."

### 6c. Handoff bottlenecks (designing now to avoid pain later)

1. **Token naming.** Foundations colors/spacing get Tailwind-compatible names (`primary-600`, `space-4`) from day one, so hi-fi → code is mechanical, not interpretive.
2. **Wireframes are not specs.** Behavior (animations, streaming captions, mood transitions) lives in frame annotations + `01-ia-and-flows.md` §3, not in the visuals alone.
3. **States must reach code.** The edge-case frames map 1:1 to component states in the build phase; the build phase's `web-frontend` agent reads this doc + the Figma file, so frame names = future component state names.

---

## 7. Review checkpoints & definition of done

**Per batch:** generate → screenshot review in chat → Mayank reacts in plain language → regenerate/hand-tune → Mayank signs off in Figma → next batch.

**Wireframe phase is DONE when:**
- All Batch 1 + 2 frames exist with their listed states, using the canonical sample data
- Every edge case in §4b is either framed or consciously deferred with a note
- The two flows in `01-ia-and-flows.md` §2 can be walked frame-by-frame as a demo story
- Mayank has signed off on the hero pair (live session + feedback) specifically — these gate hi-fi

**Then:** foundations/tokens (stage 5) → hi-fi (stage 6) → this design phase feeds Phase 0/Phase 3 of the build plan in `docs/architecture.md` §13.

---

## 8. Open design decisions (to settle during Batch 1 review)

> **Resolved 2026-06-11 — live coaching is ALWAYS-ON.** A persistent one-line `COACH` strip on the live session screen updates every turn (added to all six live-session frames). Founder chose always-on over on-demand/difficulty-gated, accepting the immersion trade-off; mitigation is visual (peripheral styling, fixed slot, no animation). The mood strip stays as the implicit signal. A per-workspace "hints off" setting remains available as a future lever if pilot data shows hint-dependence. Architecture impact recorded in `docs/architecture.md` §5g.

1. **Mood strip representation** — four mini-bars vs a single blended "temperature" indicator. Wireframe both, pick in review.
2. **Mic interaction** — tap-to-toggle vs hold-to-talk vs auto-VAD (always listening with voice activity detection). Wireframe assumes tap-to-toggle with auto-VAD noted as v2; revisit after first voice prototype.
3. **Feedback screen ordering** — scores-then-transcript (current plan) vs transcript-first-with-floating-scores. Current plan reflects "coaching first"; test against the demo story.
4. **Avatar art direction** — illustrated avatars vs initials-on-gradient for personas (affects persona editor + live session + feedback consistency). Decide before hi-fi, not before wireframes.
