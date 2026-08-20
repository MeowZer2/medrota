# MedRota Recovery Audit

Read-only reconstruction and technical audit. Verified against running code and a live database, not the documentation.

**Audit date:** 2026-08-19

```text
Current branch:        main  (41 commits AHEAD of origin — never pushed)
Current commit:        93b0d32  "Document PARO scheduling rules"  (2026-06-20)
Working tree:          clean  (unchanged by this audit)
Database reachable:    YES — local PostgreSQL "medrota" @ localhost:5432, 7/7 migrations applied, schema valid
Frontend builds:       YES — 619.48 kB JS (180 kB gzip), single chunk, >500 kB warning
                              lint: pass · perf:guard: pass (1 known warning)
Backend checks:        PASS — paro:smoke, phase5:smoke, phase6:smoke (3 sub-checks),
                              roles:smoke, roles:audit, prisma validate
E2E:                   NOT RUN — seeds and mutates the database; Chromium IS installed
Overall project state: Functional MVP — single-tenant only
```

**Evidence labels used throughout:** `CONFIRMED` · `LIKELY` · `STALE DOCUMENTATION` · `PARTIALLY IMPLEMENTED` · `BROKEN` · `NOT IMPLEMENTED` · `NEEDS PRODUCT DECISION`

---

## Table of contents

1. [Executive Summary](#1-executive-summary)
2. [Reconstructed Product Vision](#2-reconstructed-product-vision)
3. [Intended Users and User Journeys](#3-intended-users-and-user-journeys)
4. [Git / Development History](#4-git--development-history)
5. [Current Architecture](#5-current-architecture)
6. [Database / Data Model](#6-database--data-model)
7. [Roles & Permissions](#7-roles--permissions)
8. [Registration & Onboarding](#8-registration--onboarding)
9. [Scheduling Engine — Exact Current Behaviour](#9-scheduling-engine--exact-current-behaviour)
10. [PARO Compliance Matrix](#10-paro-compliance-matrix)
11. [Calendar Workflow](#11-calendar-workflow)
12. [Program & Block Settings](#12-program--block-settings)
13. [Publishing & Sharing](#13-publishing--sharing)
14. [Excel / PDF / Export](#14-excel--pdf--export)
15. [UI/UX & Responsiveness](#15-uiux--responsiveness)
16. [Frontend Performance](#16-frontend-performance)
17. [Security & Privacy](#17-security--privacy)
18. [Automated Testing & QA](#18-automated-testing--qa)
19. [Documentation Accuracy](#19-documentation-accuracy)
20. [Bugs / Defects Found](#20-bugs--defects-found)
21. [Technical Debt](#21-technical-debt)
22. [Production Readiness Scores](#22-production-readiness-scores)
23. [What Should Be Deferred](#23-what-should-be-deferred)
24. [P0/P1/P2/P3 Recovery Roadmap](#24-p0p1p2p3-recovery-roadmap)
25. [Recommended MVP Definition](#25-recommended-mvp-definition)
26. [MedRota in Plain English](#26-medrota-in-plain-english)
27. [Questions That Require Product-Owner Decisions](#27-questions-that-require-product-owner-decisions)

---

## 1. Executive Summary

MedRota is further along than a dormant project usually is. Authentication, program setup, resident and attending management, a PARO-aware auto-generator, a manual-editing calendar, publishing with immutable snapshots, a public read-only schedule link, Excel and printable exports, four canonical roles, a QA seed, and browser E2E coverage all exist and all run. Every automated check in the repository passes on this machine. The build succeeds. The database is in sync with the schema.

That is also the problem. **The green checks substantially overstate the health of the system.** The test suites are thin in a specific and misleading way: the PARO suite unit-tests helper functions and then asserts that certain *strings appear in the scheduler source file* rather than testing scheduler behaviour; the Phase 5 suite runs against hand-written mocks whose shape diverges from what the real database returns, and its headline med-student assertion passes for a reason unrelated to the setting it claims to exercise. No automated test anywhere exercises route authorization.

Three findings matter more than the rest.

- **A confirmed cross-program data breach.** `GET /api/programs/stats` has no membership check. During this audit, a Viewer in one program successfully retrieved another program's resident names and per-resident call counts. This was demonstrated against the live API, not inferred from reading code. `CONFIRMED`
- **Block settings that silently do nothing.** The PARO rewrite deleted the old fairness engine and, with it, the code that read `maxCallsPerResident`, `allowWeekendConsecutive`, and `limitWeekendCalls`. The database columns, the API, and *two separate UI surfaces* that let a Chief Resident edit them all survived. You can set "Max calls per resident" to 4, save it successfully, and the generator will ignore it entirely. `CONFIRMED`
- **Manual edits are completely unchecked.** Saving a day from the calendar writes directly with `isOverride: true` and no rule validation of any kind. Worse, assigning the same resident to both the senior and junior slot silently destroys the senior assignment — the second write updates the first row's role instead of creating a second row — and the warning written to catch exactly this is dead code that can never render. `CONFIRMED`

The scheduling engine itself is real and mostly principled, but it enforces a narrower set of PARO rules than the documentation claims, and the blended-call rule as implemented is mathematically incapable of ever binding in a generated schedule. Roles are the healthiest part of the system: canonical, consistent between frontend and backend, and correctly enforced on nearly every route.

**Verdict: Functional MVP.** Trustworthy enough for one person to build one program's schedule on one machine, provided they check the output by eye. Not safe to put a second program or a second institution in front of, and not close to deployable.

---

## 2. Reconstructed Product Vision

### What problem MedRota solves

MedRota replaces the hand-built Excel call schedule a Chief or Senior Resident assembles each 28-day block. The real work it absorbs is not drawing the grid — it is holding a dozen constraints in your head at once (who is on vacation, who did last weekend, who is already at their call maximum, who must not be post-call on the first day of their leave) and then re-solving the whole thing when one person's leave changes.

The present-day product is narrower than that framing suggests. Read from the code, MedRota is **a single-program, block-at-a-time call scheduler for residency programs, with a compliance-aware generator and a shareable read-only published schedule.** Scaffolding for multi-program and multi-institution use exists in the schema but is not implemented in the application. `INFERRED`

### Priorities, ranked by what the code actually invests in

| # | Priority | Status |
|---|---|---|
| 1 | Enforce residency scheduling constraints automatically | `CONFIRMED CURRENT` — the last five commits are all PARO work; unambiguously where attention was when the project stopped |
| 2 | Allow manual override when human judgment is required | `CONFIRMED CURRENT` — override preservation across regeneration is deliberately engineered and tested |
| 3 | Publish schedules securely and share them | `CONFIRMED CURRENT` — snapshot versioning plus a public-safe shaping layer is real, deliberate work |
| 4 | Protect private scheduling metadata on public surfaces | `CONFIRMED CURRENT` — genuinely well-built, for the `/api/public/*` routes specifically |
| 5 | Avoid performance-heavy animation | `CONFIRMED CURRENT` — a real regression happened, was root-caused, fixed, documented, and guarded |
| 6 | Make schedule generation fast and easy for Chief Residents | `PARTIALLY IMPLEMENTED` — one-click generation exists, but the setup path in front of it is long and the summary it returns is hard to act on |
| 7 | Stay responsive on desktop, tablet, and phone | `PARTIALLY IMPLEMENTED` — Calendar and public schedule have real mobile layouts; most other pages have none |
| 8 | Maintain a modern, professional UI | `PARTIALLY IMPLEMENTED` — the authenticated app is polished; Register and Setup are visibly from an earlier design generation |

### Apparently abandoned goals

- The multi-institution "request access → pending organization → approval" flow. The endpoint exists, creates a `pending` organization, and nothing ever reads that status again.
- The holiday feature. Modelled, respected by the scheduler, invisible in the calendar, no UI to create one, zero rows in the database.
- The onboarding metadata captured at registration. Four fields collected, validated, stored, and never read.

---

## 3. Intended Users and User Journeys

Four program roles exist and are real. The personas in the original brief map onto them only partially — three of the guesses are not represented in the system at all.

| Persona | Exists? | How it is actually modelled |
|---|---|---|
| Chief Resident | YES | `chief_resident` — the full scheduling operator. Cannot manage users or program settings. |
| Program Admin | YES | `program_admin` — everything, and the only role granted `delete_program` (which has no route). |
| Program Director | YES | `program_director` — identical to Program Admin minus `delete_program`. In practice indistinguishable. |
| Viewer | YES | `viewer` — published schedules only; explicitly denied draft view. |
| Residents | **NO** | A `ResidentProfile` is scheduling *data*, not a user. Its optional email is never used to log in or notify. |
| Medical students | DATA ONLY | `isMedStudent` on a profile. Always off-service, always block-scoped, assigned only as junior backfill. |
| Attendings | DATA ONLY | `AttendingRoster` + `AttendingEntry`. Attendings are scheduled around, never users. |

> **The most consequential gap in the product model:** the people whose lives the schedule governs — residents — are not users. There is no route by which a resident logs in, sees their own calls, or requests a change. Every current workflow serves the person *building* the schedule, not the people living under it.

### The real primary workflow

The idealised flow in the brief is close, but the actual sequence differs in ways that matter.

1. **Register** → redirected to the login screen and must sign in again.
2. **Setup wizard** → create Organization → create Program → 13 blocks generated automatically. This makes the creator a Program Admin.
3. **Add residents**, each tagged senior or junior, with vacation entered as date ranges.
4. **Build the attending schedule** — optionally via a weekly template applied across blocks, or copied from a previous block.
5. **Set block rules** — in *either* the dedicated Block Settings page or a collapsed panel inside the Calendar. Three of the six controls do nothing.
6. **Auto-generate** from the Calendar. A summary modal reports assigned/unassigned counts, per-resident load, unassigned dates, and warnings.
7. **Manually adjust** by clicking a day and picking residents from dropdowns. Every such edit becomes a permanent override.
8. **Publish** — snapshots the schedule, mints a public token, surfaces a copyable link.
9. **Share or export** — public link, Excel, or printable HTML.

**The validation step in the idealised flow does not exist as a step.** There is no "check this schedule" action. Validation happens only as a side effect of generation, and manual edits made afterwards are never re-validated. A Chief Resident who generates a clean schedule and then hand-edits six days has no way to ask whether the result is still compliant. `NOT IMPLEMENTED`

---

## 4. Git / Development History

43 commits, all on `main`, no branches, no merges. `origin/main` sits at commit 2 — **41 commits of work exist only on this machine.** That is the single largest operational risk in the project and it has nothing to do with code quality.

Development happened in three bursts: a long build-out ending 2026-05-06, then near-total silence, then a dense sprint from 2026-06-18 to 2026-06-20 that produced 41 of the 43 commits. The project stopped mid-sprint, not at a natural boundary.

### Project evolution

| Stage | Commits | What was built | Survives today? |
|---|---|---|---|
| **Foundation** (Apr–May) | `728dfaf`, `407097f` | Whole app scaffolded in one commit: Express + Prisma backend, React frontend, 4 migrations, all major pages. Then a machine migration adding `setup.ps1`. | Yes — structure unchanged. |
| **Date & duplication bug hunt** (Jun 18) | `02bf84e` → `ef3e65f` | Six consecutive fixes for one class of bug: dates round-tripping through local `Date` parsing and shifting a day, plus duplicate `CallDay`/`AttendingEntry` rows. Converted date handling to UTC throughout. | Yes — the UTC fix survived the PARO rewrite. `STILL FIXED` |
| **Scheduling hardening** (Jun 19) | `86af839` → `25fea89` | Manual-override preservation, block settings editing, generation summary, publish flow, duplicate diagnostics, academic-day handling. | Mostly. Override preservation survives; block settings were later orphaned. |
| **Phase 5 QA** (Jun 19) | `4230e68` → `88f5b6e` | Mock-backed smoke suite plus a real-DB persistence check. Declared closed. | Yes, but its claims are now stale — see §19. |
| **Performance regression** (Jun 19) | `383e353` → `f48607c` | A design-tool import introduced a full-page animated gradient plus animated shadows on every calendar cell. Root-caused, reverted, documented, guarded. | Yes — the best-handled incident in the project. `STILL FIXED` |
| **Phase 6 publishing** (Jun 19) | `89a0fb5` → `f9a3450` | Public privacy shaping, public schedule page, Excel and printable exports, smoke checks. | Yes. |
| **Roles redesign** (Jun 20) | `2e9da8f` → `000ff32` | Legacy roles (`builder`, `editor`, `admin`, `coordinator`) collapsed into four canonical roles via a data migration. QA seed, role audit tool, first browser E2E tests. | Yes — clean and consistent. |
| **PARO rewrite** (Jun 20) | `196fc48` → `93b0d32` | Program-level call-type toggles, a new `paroRules` module, and a full scheduler rewrite: **438 lines deleted, 280 added.** | Yes — and this is where the damage is. |

### Where a later refactor broke earlier work

> **The PARO rewrite (`48f499f`) is the pivotal commit.** It replaced a working fairness engine with a PARO eligibility engine and, in doing so, deleted the code that consumed three block settings without removing the settings themselves.
>
> The deleted engine had `getWeekKey()`, `makeWeekendState()` tracking Friday/Saturday/Sunday weeks separately, and honoured `maxCallsPerResident`, `allowWeekendConsecutive`, and `limitWeekendCalls`. The new engine honours none of them. The columns, the API, the Block Settings page, and the Calendar's inline rules panel all still expose them as if they work.

A second, subtler regression came from **`6d0bfb2`**. It rewrote the resident-pool merge so that all active service residents are folded in whether or not they are enrolled in the block. That is defensible — service residents genuinely often lack enrollment rows. But the `usedFallback` flag, which previously meant "something is wrong, fewer than two residents were enrolled," now evaluates true in the ordinary case. The Calendar still shows a warning banner keyed to it, so the banner has become noise. And residents folded in this way arrive with **empty vacation lists**.

---

## 5. Current Architecture

### Backend architecture map

Express 5 on Node 22, CommonJS, Prisma 7 against PostgreSQL via the `@prisma/adapter-pg` driver adapter. No build step, no TypeScript, no test framework — validation is a set of hand-written Node scripts run through npm.

| Layer | Files | Responsibility |
|---|---|---|
| Entry | `index.js` | CORS allowlist (4 hardcoded localhost origins), JSON body parsing, a request logger that prints every path, 11 route mounts, health check, catch-all error handler that returns `err.message` to the client. |
| Auth | `middleware/auth.js` | Bearer JWT verify. Sets `req.user = {userId, email}`. 40 lines, no refresh, no revocation. |
| Authorization | `lib/roles.js` | The good part. Canonical roles, legacy mapping, a permission table, and four guards: `requireProgramPermission`, `requireBlockPermission`, `requireBlockView`, `getMembership`. Self-heals legacy role strings on read. |
| Routes | 11 files | `auth`, `programs`, `residents`, `attending`, `attendingTemplate`, `assignments`, `schedule`, `blocks`, `flags`, `organizations`, `public`. All except `public` apply `router.use(auth)`. |
| Scheduling | `services/scheduler.js`, `services/paroRules.js` | Generator plus a pure, dependency-free rules module. The separation is genuinely good design — `paroRules` is testable in isolation and is the only well-tested code in the repo. |
| Export | `excelExport.js`, `printableSchedule.js`, `publicScheduleShape.js` | Shared row-builder feeds both Excel and HTML. Two shaping functions: `shapeProtectedSchedule` (includes notes) and `shapePublicSchedule` (strips all IDs). |
| Scripts | 10 files | QA seed, role audit, and eight validation scripts wired to npm. |

### Frontend architecture map

React 19, Vite 8, React Router 7, Tailwind 4, Framer Motion, axios, react-hot-toast. Single bundle, no code splitting, no state library beyond React context.

| Concern | Implementation | Assessment |
|---|---|---|
| Routing | `App.jsx` — 12 routes, all eagerly imported, wrapped in `AnimatePresence`. | **NO AUTH GUARD.** "Protected" routes render for logged-out users. Only redirect is *logged-in-but-no-program* → `/setup`. |
| Global state | `AppContext` splits into `UserContext` and `BlockContext`, both memoised, exposing `can(permission)`. | Well structured. The split avoids re-rendering the whole tree on block change. |
| API client | `api/axios.js` attaches the bearer token from `localStorage`; `api/base.js` falls back to relative `/api`. | **NO 401 INTERCEPTOR.** When the 7-day token expires the app fails silently rather than returning to login. |
| Permission-aware UI | Sidebar hides Residents/Attending/Settings by permission; Calendar gates edit controls on `manual_assign_calls`. | Consistent with the backend table. Verified by E2E for Viewer. |
| Calendar | `Calendar.jsx`, 1809 lines — grid, mobile row list, day modal, attending sub-editor, flag sub-editor, block-rules panel, generate/clear/publish/export. | **MONOLITH.** Roughly a third of all frontend code. Six responsibilities in one file. |
| Date handling | A local `normalizeDateKey` that prefers the leading `YYYY-MM-DD` of an ISO string over re-parsing. | **CORRECT.** This is the Phase 5 fix and it is intact. |

---

## 6. Database / Data Model

19 tables, 7 migrations, all applied. `prisma validate` passes. The shape is sensible.

```text
Organization → Program → AcademicYear → Block → CallDay → CallAssignment → ResidentProfile
  Program → ProgramMember → User
  Program → ResidentProfile → BlockEnrollment → Block
  Block → BlockSettings (1:1) | AttendingEntry | DayFlag | ScheduleVersion
  AcademicYear → PublicHoliday
  Program → AttendingRoster | AttendingScheduleTemplate | Invite
```

### Integrity problems

| Issue | Detail | Status |
|---|---|---|
| **No foreign-key indexes** | Verified live: the database contains only primary keys and four unique constraints. Every `where: { blockId }`, `{ programId }`, `{ callDayId }` is a sequential scan. | `CONFIRMED` |
| **No uniqueness on logical days** | Nothing prevents two `CallDay` rows for the same `(blockId, date)`, two `BlockEnrollment` rows for the same `(blockId, residentId)`, or two `ProgramMember` rows for the same `(programId, userId)`. The code compensates with *find-then-create*, which is racy. | `CONFIRMED` |
| Duplicate-day symptom management | A `/api/schedule/diagnostics` endpoint exists solely to *report* duplicate CallDays and AttendingEntries. The project built a detector instead of a constraint. No duplicates exist in current data. | DESIGN SMELL |
| **Dead columns** | `BlockSettings.maxCallsPerResident`, `.allowWeekendConsecutive`, `.limitWeekendCalls` — written, never read. `BlockEnrollment.academicDayPref` — written, never read. `Organization.status` — set, never checked. `User.category`, `.clinicalIdentity`, `.desiredRole`, `.homeSpecialty` — stored, never read. | `CONFIRMED` |
| Ambiguous ownership | `ResidentProfile` belongs to a Program, but `BlockEnrollment` can link it to a Block in *any* program — nothing validates the pair. Same for `CallAssignment`. | `CONFIRMED` |
| Unused relation | `CallDay.attendingEntryId` links a call day to one attending entry, but the calendar derives attendings from a date map instead. Written by the assignment route, never meaningfully read. | VESTIGIAL |
| No cascade rules | Every relation is a bare FK with no `onDelete`. Deletion is done by hand: `DELETE /residents/:id` manually deletes assignments, then enrollments, then the profile — not in a transaction. | FRAGILE |
| Free-form enums | `residentRole`, `roleOnDay`, and `ProgramMember.role` are all `String`. A typo in `residentRole` makes a resident permanently invisible to the scheduler, silently. Live data is clean (`senior`×6, `junior`×9). | LATENT |

### The roles migration transformed data in a way worth reviewing

> `20260620000000_roles_onboarding` did two things beyond adding columns.
>
> First, it mapped every membership role through a `CASE` whose fall-through is `ELSE 'viewer'` — any unrecognised role string became a Viewer with no record of what it was.
>
> Second, and more significant: it found every program with no `program_admin` and **promoted the earliest-created member to Program Admin.** If that earliest member was intentionally a Viewer, they were silently granted full administrative control. And because the match is on `createdAt` equality, ties promote *everyone* tied.
>
> The current local database is clean (2 admins, 2 directors, 1 chief, 1 viewer, no legacy strings). **But this migration has not run against any other dataset yet** — and if it ever does, it should be audited afterwards. `REVIEW BEFORE ANY PRODUCTION MIGRATION`

---

## 7. Roles & Permissions

The canonical roles are `chief_resident`, `program_admin`, `program_director`, `viewer`. Legacy values map as `coordinator`→director, `admin`→admin, `builder`/`editor`→chief, unknown→viewer. The backend table in `lib/roles.js` and the frontend table in `constants/roles.js` were compared permission-by-permission and are **byte-for-byte equivalent**. This is the most disciplined part of the codebase.

### Actual current permission matrix

| Permission | Chief Resident | Program Admin | Program Director | Viewer | Enforcement |
|---|:--:|:--:|:--:|:--:|---|
| view draft schedule | ✔ | ✔ | ✔ | — | OK |
| view published schedule | ✔ | ✔ | ✔ | ✔ | OK — via `requireBlockView` |
| add / edit residents | ✔ | ✔ | ✔ | — | **NO PROGRAM SCOPING** |
| edit attending schedule | ✔ | ✔ | ✔ | — | **COPY READS ANY BLOCK** |
| assign calls manually | ✔ | ✔ | ✔ | — | OK — verified 403 for Viewer |
| auto-generate | ✔ | ✔ | ✔ | — | OK |
| clear generated schedule | ✔ | ✔ | ✔ | — | OK |
| publish | ✔ | ✔ | ✔ | — | OK |
| export draft | ✔ | ✔ | ✔ | — | OK |
| export published | ✔ | ✔ | ✔ | ✔ | Public export needs no auth at all |
| edit block settings | ✔ | ✔ | ✔ | — | OK — but 3 of 6 settings are inert |
| edit program settings | — | ✔ | ✔ | — | OK — covered by E2E |
| manage users | — | ✔ | ✔ | — | **GET USES WRONG PERMISSION** |
| change roles | — | ✔ | ✔ | — | **NO SELF-DEMOTION GUARD** |
| create academic year | — | ✔ | ✔ | — | OK |
| delete program | — | ✔ | — | — | **NO ROUTE EXISTS** |

### Frontend/backend divergences

- **Backend allows what the frontend hides:** `GET /api/schedule/history` uses `requireBlockView`, so a Viewer in the program gets HTTP 200 and the *raw, unshaped* `snapshotJson` — including resident IDs, assignment IDs, `isOverride`, and `overrideReason`. The Program Settings page hides this UI from Viewers, so it is invisible but reachable. This directly contradicts the privacy boundary the Phase 6 documentation asserts. Verified: a same-program Viewer received 200; a different-program Viewer correctly received 403. `CONFIRMED`
- **Backend allows what nothing checks:** `GET /api/programs/stats` performs no membership check whatsoever. See §17 for the demonstrated breach.
- **Frontend offers what the backend cannot do:** `delete_program` appears in both permission tables and is asserted in `roles:smoke`, but no `DELETE /api/programs/:id` route exists. `LOCAL_QA.md` lists it as a Program Admin capability.
- **Inconsistent guard choice:** `GET /api/programs/:id/members` requires `edit_program_settings` while `PUT .../members/:userId` requires `manage_users`. Same resource, two different permissions.
- **Missing guard:** a Program Admin can change their *own* role to Viewer via `PUT /members/:userId`. The last-admin protection only fires on the leave-program path, not the role-change path — so a program can be orphaned.

---

## 8. Registration & Onboarding

### What the journey actually does

| Step | Collected | Stored | Used for anything? |
|---|---|---|---|
| `/register` | name, email, password | Yes | Yes — bcrypt cost 10, no strength rule, no verification email |
| | user category | Yes | **NEVER READ** |
| | desired app role | Yes | **NEVER READ** |
| | clinical identity | Yes | **NEVER READ** |
| | home specialty | Yes | **NEVER READ** |
| | invite token (optional) | — | Yes — creates membership at the invite's role |
| | *On success: navigates to `/login`. The user must type their credentials again.* | | |
| `/setup` | org name, country, program name, specialty, year start | Yes | Yes — creates org, program, 13 blocks; creator becomes **Program Admin** |

### Answers to the specific questions

- **Can high-privilege roles be self-selected?** Not through the "desired app role" dropdown — that field is inert, which is the safe outcome, though it misleads the user who picks "Program Admin" and expects it. **But privilege is trivially self-granted another way:** any registered user can run the Setup wizard, create an organization (status hardcoded `active`), create a program, and be made Program Admin automatically. There is no approval, no verification, no limit. `CONFIRMED`
- **Does joining an existing program require approval?** It requires an invite link, which is stronger than approval — the invite's role is authoritative and is normalised server-side. Invites are single-use but **never expire**.
- **Does specialty selection work?** Yes. A flat list is shared between frontend and backend constants and validated on submit for both registration and program creation.
- **Can onboarding dead-end?** **YES.** The Setup wizard offers *only* "create a new organization." There is no "join an existing program" or "request access" path in the UI. A resident whose program already exists in MedRota, arriving without an invite link, has exactly one option: create a duplicate organization and program. The `POST /api/auth/request-access` endpoint that would serve this case exists, creates a `pending` organization, and is called by nothing — and nothing ever reads that pending status.
- **Can users accidentally become viewers or admins?** Viewer is the fall-through for every unrecognised role, so a malformed invite silently downgrades. Admin is granted automatically to whoever creates the program — and was granted retroactively by the roles migration to the earliest member of any admin-less program.

> **New user's experience, plainly:** you fill in a seven-field form including three dropdowns that turn out not to matter, get bounced to a login page to re-enter what you just typed, and are then dropped into a wizard that assumes you are founding an institution. If someone sent you an invite link, the experience is good — one click and you are in at the right role.

---

## 9. Scheduling Engine — Exact Current Behaviour

The PARO rewrite **was completed**, not merely planned. `services/paroRules.js` is a real, pure, dependency-free rules module and the scheduler genuinely consults it. What follows is what the code does today, step by step.

### Step 1 — Load and merge the resident pool

The block is loaded with settings, holidays, enrollments, and flags. Then **every active service resident in the program is merged in**, whether or not they are enrolled in this block. Enrolled residents keep their real vacation dates and call-cap override; merged-in residents arrive with `vacationDates: []`.

> **Consequence:** a service resident who is on vacation but has no `BlockEnrollment` row for this block will be treated as fully available and can be assigned call during their leave. Vacation is stored on the enrollment, not the profile, so the merge path has nowhere to read it from. `CONFIRMED`

### Step 2 — Compute per-resident PARO state

- **Days on service** = block length − vacation days. No other time-away is deducted; academic days, off-service rotations, and partial enrollment do not reduce it.
- **In-house maximum** and **home-call maximum** are looked up from the PARO tables by days on service. Below the published ranges the code prorates conservatively (`floor(days/4)` in-house, `floor(days/3)` home, minimum 1) so short QA blocks still generate.
- **Call type is fixed per resident**, derived from `residentRole` plus the two program toggles. A senior is home call unless "Senior in-house call" is on; a junior is in-house unless "Junior in-house call" is off.

### Step 3 — Seed from manual overrides

Existing `CallAssignment` rows with `isOverride: true` are loaded first. Each one increments the resident's call counters and marks its day as covered, so overrides both survive regeneration *and* count against that resident's PARO limits. Overrides that violate vacation, post-call-before-vacation, or consecutive-call rules produce warnings but are never removed. This part works as documented. `CONFIRMED`

### Step 4 — Walk the block day by day

Chronologically, for each date: skip holidays silently; skip academic-flagged days with a warning if `avoidAcademicDays` is on; otherwise fill the senior slot (unless `allowAttendingOnlyDays`) then the junior slot.

**Eligibility is a hard gate.** A candidate is rejected if *any* of these hold: on vacation; the day before vacation starts; adjacent to an existing call; over their per-block cap override; over the med-student cap; over their in-house or home maximum; would create consecutive home-call weekends; would breach the blended-call limit; or would drop them below the required number of complete weekends off.

**Ranking:** fewest total calls, then fewest weighted points, then original roster order. **The first candidate wins** — a greedy pass, no backtracking, no lookahead.

### Step 5 — Med student backfill

A second pass assigns med students as juniors, but only on days that already have a senior and still have no junior. Med students are also subject to `residentRole === 'junior'`, so a med student stored with any other role is silently unschedulable.

### Step 6 — Summary

Returns totals, unassigned dates, warnings, and a per-resident summary carrying calls, home/in-house split, days on service, both maxima, and weighted points.

> **The structural weakness:** because the generator is greedy and chronological with hard constraints, early days consume the residents who will be needed later. The engine cannot backtrack, so it reports failure by leaving days unassigned. On a tight roster this produces a schedule that is compliant but sparse — and the summary gives counts, not an explanation a Chief Resident can act on beyond a comma-joined list of reason codes.

---

## 10. PARO Compliance Matrix

| PARO Rule | Implemented | Partially | Missing | Incorrect |
|---|:--:|:--:|:--:|:--:|
| Days on service after time-away deductions | | ✔ | | |
| In-house call maximums (19–22→5 … 35–38→9) | ✔ | | | |
| Home-call maximums (17–19→6 … 29–30→10) | ✔ | | | |
| Blended call limit | | | | ✔ |
| No consecutive call | ✔ | | | |
| Two complete weekends off incl. Friday night | ✔ | | | |
| No consecutive home-call weekends | ✔ | | | |
| No call while on vacation | | ✔ | | |
| Not post-call on first day of vacation | ✔ | | | |
| Program call-type settings (junior/senior in-house) | ✔ | | | |
| Manual overrides | | | | ✔ |
| Academic-day avoidance | ✔ | | | |

### Evidence

**Days on service — `PARTIALLY IMPLEMENTED`**
`calculateDaysOnService` subtracts only vacation days from block length. Academic days, off-service periods, and partial enrollment are not deducted. Residents merged in without an enrollment get the full block as days on service.

**In-house maximums — `IMPLEMENTED`**
Table reproduced exactly in `getInHouseMax`; all five boundaries asserted in `paro:smoke` and passing.

**Home-call maximums — `IMPLEMENTED`**
Table reproduced exactly in `getHomeCallMax`; all five boundaries asserted and passing.

**Blended call — `INCORRECT` / `NEEDS PRODUCT DECISION`**
Implemented as `home + (3 × in-house) <= 30` — different weights entirely from the `(home×3) + (in-house×4) <= 30` rule stated in the audit brief. The project's own `SCHEDULING_RULES_PARO.md` documents the *implemented* formula, so code and project docs agree with each other but **disagree with the brief**. Separately, because call type is fixed per resident, nobody ever accumulates both kinds — a pure in-house resident maxes at 27 points, a pure home-call resident at 10. **The constraint can never bind in a generated schedule.**

**No consecutive call — `IMPLEMENTED`**
`hasConsecutiveCall` checks the day before and the day after against all assigned dates, including overrides. Hard rejection.

**Two complete weekends off — `IMPLEMENTED`**
A weekend is keyed to its Friday; Fri/Sat/Sun all map to it, so any weekend-day assignment consumes that weekend — correctly conservative, and correctly includes Friday night. Required count is `min(2, ceil(completeWeekends / 2))`, which yields 2 for a standard 28-day block. Only weekends whose Fri, Sat and Sun all fall inside the block count, so partial weekends at block edges are unprotected.

**No consecutive home-call weekends — `IMPLEMENTED`**
`hasConsecutiveHomeCallWeekend` checks ±7 days from the candidate's weekend key. Applied only when the call type resolves to home — with default settings, that means seniors only.

**Vacation — `PARTIALLY IMPLEMENTED`**
Correct for enrolled residents. Fails for service residents merged in without an enrollment row, who carry an empty vacation list. The post-call-before-vacation rule (`violatesPostCallBeforeVacation`) is correctly implemented, with the same enrollment caveat.

**Program call-type settings — `IMPLEMENTED`**
Both toggles exist in Program Settings, default junior-on / senior-off, restricted to `edit_program_settings`, persisted on `Program`, and covered by a passing E2E test. **Their entire effect is to select which maximum table applies to each role.**

**Manual overrides — `INCORRECT`**
Preserved across regeneration: YES. Counted in the resident's load: YES. Produce warnings at generation time: PARTLY — only for vacation, post-call-before-vacation, and consecutive call; not for exceeding maximums or weekend rules. **Bypass all constraints at write time: YES** — `POST /api/assignments` performs no rule checking at all.

**Academic-day avoidance — `IMPLEMENTED`**
Days flagged with a label matching `/academic/i` are skipped when `avoidAcademicDays` is on. Note this depends on flag *text*, so renaming the flag disables the rule.

### Deliberately deferred PARO concepts

Absent, and the absence looks intentional rather than accidental — none has partial scaffolding: schedule release timing, shift-work rules, multi-month averaging, emergency coverage, and formal exception approval. The project documentation independently confirms the intent, stating the generator "does not use a solver" and "does not silently relax PARO constraints." `DEFERRED BY DESIGN`

---

## 11. Calendar Workflow

`Calendar.jsx` loads the block, fetches attending entries, assignments, residents, roster and flags in parallel, normalises everything to `YYYY-MM-DD` keys, builds one `dayDataMap`, and renders both a desktop grid and a mobile row list from it. Clicking a day sets a date key; the modal reads from the same map.

**The single-source-of-truth fix from Phase 5 is intact.** Cells and the modal both derive from `dayDataMap`, and `normalizeDateKey` prefers the leading date substring of an ISO string over re-parsing it as a local `Date`. The class of bug where the modal showed "Unassigned" for a day the grid showed as assigned is genuinely fixed.

### Historical failure classes — current state

| Failure class | State | Note |
|---|---|---|
| Date / dateKey inconsistency | FIXED | Single normaliser, string-prefix based. |
| UTC timezone drift | FIXED | Backend emits UTC-midnight ISO; frontend reads the prefix. Round-trip is stable. |
| Modal shows Unassigned despite grid assignment | FIXED | Shared `dayDataMap`. Covered by E2E. |
| Stale local modal state | FIXED | Selects are keyed `senior-${dayKey}`, forcing remount per day. |
| Missing resident fallback option | FIXED | If an assigned resident is absent from the dropdown list, a synthetic option is injected so the assignment is not silently lost. |
| Viewer opening editable modal | FIXED | Gated on `canEditSchedule`; E2E asserts the selects have count 0 for a Viewer. |
| Assignment Save doing nothing | FIXED | E2E covers save → reopen → reload persistence. |
| Manual override overwritten by generation | FIXED | Pre-clear deletes only `isOverride: false` rows. |
| Duplicate CallDays / AttendingEntries | MITIGATED | Find-then-create everywhere, plus a diagnostics endpoint. No database constraint. None present in current data. |
| Attending mismatch | FIXED | Modal and cell read the same `attendingMap`. |
| Visible mojibake | **STILL PRESENT** | See below. |
| **Same resident in both roles** | **BROKEN** | New finding — see below. |
| **Holidays never render** | **BROKEN** | New finding — see below. |

> ### The dead warning
>
> `DayModal` declares `const warning = null;` at component scope and renders `{warning && ...}` — permanently false. Inside `handleSave` a *differently scoped* `warning` is computed for the same-resident-in-both-roles case and passed to `onSave`, which destructures only `{seniorId, juniorId, senior, junior}` and discards it. The warning can never appear.
>
> What actually happens if you do it: the save posts twice for the same resident on the same day. `POST /api/assignments` looks up an existing row by `(callDayId, residentId)` and finds the one just written, so the second post **updates its role from senior to junior**. The result is one assignment, junior, and the senior slot silently empties — while local UI state still shows both filled until reload.

> ### Holidays are invisible
>
> Line 1378 of `Calendar.jsx` hardcodes `isHoliday: false` into every day. Both `DayCell` and `DayRow` contain complete holiday styling — red tint, border, uppercase label, glow class — that can never execute. Meanwhile the scheduler *does* skip holidays. So a Chief Resident sees unexplained empty days with no indication why. The public schedule page renders holidays correctly from the snapshot, so the two views disagree. There is also no UI anywhere to create a `PublicHoliday`, and the table has zero rows.

> ### Mojibake survived the fix
>
> Commit `894e192` cleaned visible separators, but `routes/programs.js` still contains double-encoded emoji in the Dashboard activity feed. Captured from a live API response during this audit:
>
> ```json
> {"description":"Call assigned to Liam Osei","icon":"ðŸ“‹","color":"#2C5F8A"}
> ```
>
> Those render as literal garbage next to every activity item. The E2E mojibake check cannot catch it for two reasons: it only runs on `/calendar`, never `/dashboard`; and its pattern list (`Ã¢`, `Ãƒ`, `Ã‚`, `ï¿½`, `Â`) does not include the sequences that double-encoded emoji produce. Five source files also carry UTF-8 BOMs, a symptom of the same encoding damage.

---

## 12. Program & Block Settings

### Program Settings — healthy

Two call-type toggles, correctly gated to `edit_program_settings`, persisted on `Program`, surfaced through `/programs/mine` into context, and covered by two passing E2E tests (admin can edit, viewer cannot). This is the newest code in the project and the best-tested feature in it.

**Verified present:** Junior in-house call · Senior in-house call. Defaults: junior on, senior off.

### Block Settings — half of it is theatre

| Setting | Read by scheduler? | Effect |
|---|:--:|---|
| `avoidAcademicDays` | YES | Skips days flagged with an "academic" label. |
| `allowAttendingOnlyDays` | YES | When on, the senior slot is left unfilled. |
| `maxCallsMedStudent` | YES | Caps med-student assignments. |
| `maxCallsPerResident` | **NO** | **Nothing.** Editable in two places. Superseded by PARO tables but never removed. |
| `allowWeekendConsecutive` | **NO** | **Nothing.** Labelled "Allow weekend consecutive calls." |
| `limitWeekendCalls` | **NO** | **Nothing.** Labelled "Limit residents to one weekend block." |

These three are not merely dead columns — they are **presented to the user as working controls in two separate places**: the dedicated `/blocks/:n/settings` page and a collapsible rules panel inside the Calendar. Both save successfully and return 200. A Chief Resident tightening "Max calls per resident" to reduce someone's burden will see the setting persist and the schedule ignore it.

The duplication itself is also debt: two independent UIs edit the same six fields with separate default constants and separate save handlers.

---

## 13. Publishing & Sharing

Publishing is one of the better-built parts of the system. `POST /api/schedule/publish` assembles a snapshot of block metadata, attending entries and call days with residents, then in a single transaction marks the block published, mints a `publicToken` if absent, and writes a `ScheduleVersion` row. Re-publishing reuses the existing token, so shared links stay valid across versions.

| Aspect | State | Detail |
|---|---|---|
| ScheduleVersion snapshots | WORKS | Immutable JSON, records `publishedBy` and `publishedAt`. Appended, never overwritten. |
| Public token | WORKS | `crypto.randomUUID()` — 122 bits of entropy, unique-indexed, stable across republishes. |
| Version history UI | WORKS | Program Settings lists versions with publisher name and assigned-day count, and can open a snapshot. |
| Unpublished behaviour | WORKS | `/api/public/:token` 404s unless the block is published *and* a version exists. The public page shows a friendly unavailable state. |
| Unpublishing | **MISSING** | There is no way to retract a published schedule. Once published, the link works forever — no route sets `isPublished` back to false or rotates the token. |
| Version history privacy | **LEAKS** | `/api/schedule/history` returns raw `snapshotJson` to any in-program Viewer. See §7 and §17. |

### The public schedule

Genuinely well built. `/schedule/:token` requires no authentication and fetches through `publicScheduleShape.js`, which reconstructs every object from scratch rather than deleting fields from the original — an allowlist, not a denylist, which is the right way round. Resident objects are reduced to `{name}`; IDs, emails, override flags, override reasons and raw snapshot content never enter the response. Day flags are fetched live because they are treated as editorial annotations rather than part of the frozen schedule.

---

## 14. Excel / PDF / Export

> **To answer the question directly: there is no PDF generation.** The routes are named `/export/pdf` and the UI says "Print / PDF," but both endpoints return `text/html` with `Content-Disposition: inline`. This is **print-styled HTML intended for the browser's own Save-as-PDF**. No PDF library is installed and none is imported. The naming is misleading but the implementation is a reasonable, dependency-free choice.

### The four export paths, and which data each one uses

| Export | Auth | Source of truth | Includes notes? |
|---|---|---|---|
| `GET /api/schedule/export/excel` | `export_draft_schedule` | **LIVE DATA** | Yes |
| `GET /api/schedule/export/pdf` | `export_draft_schedule` | **LIVE DATA** | Yes |
| `GET /api/public/:token/export/excel` | none | **PUBLISHED SNAPSHOT** | No |
| `GET /api/public/:token/export/pdf` | none | **PUBLISHED SNAPSHOT** | No |

**The inconsistency is real.** Protected exports read live block data; public exports read the latest immutable snapshot. So after a Chief Resident edits a published schedule without republishing, the Excel they download and the Excel a resident downloads from the public link **show different schedules**, with no marking on either to indicate draft versus published state. Neither file carries a "draft" watermark or a published-at stamp in the protected case.

Mechanically the exports are sound: one shared `buildScheduleRows` feeds both formats so they cannot drift, ExcelJS produces a real workbook with column widths and conditional highlighting of unassigned rows, and the printable HTML escapes all interpolated values. Both are covered by passing smoke checks — though those checks exercise the shaping functions with fixtures, not the routes.

---

## 15. UI/UX & Responsiveness

### Usability

Once set up, the core loop is fast: open Calendar → Auto-generate → review summary → click a day → change a dropdown → Save. That is roughly four clicks to a generated schedule and three to amend a day, which is genuinely better than Excel.

The friction is everywhere *around* that loop:

- **Vacation entry is the bottleneck.** Vacation lives on `BlockEnrollment`, so it must be entered per resident *per block*. For a 10-resident program across 13 blocks that is 130 separate edits, with no copy-forward, no bulk entry, and no import.
- **Rules live in two places** — the Block Settings page and a Calendar panel — with no indication that they are the same settings.
- **The generation summary reports without advising.** "No PARO-eligible senior available (consecutive-call: 3, home-call-cap: 2)" tells you the constraint counts but not which resident, or what to change.
- **Nothing tells you a schedule has drifted from what was published.** No dirty indicator, no diff.

### Information architecture

Sensible overall: Dashboard for stats, Residents for roster, Attending for coverage, Calendar for the schedule, Block Settings for rules, Program Settings for program-level configuration and version history. Advanced rules are correctly collapsed by default in the Calendar. The main problem is duplication rather than misplacement.

### Responsive design

| Surface | Mobile | Detail |
|---|---|---|
| Calendar | GOOD | Separate `DayRow` list replaces the 7-column grid. |
| Public schedule | GOOD | `matchMedia`-driven grid/list switch. The surface most likely to be opened on a phone, correctly prioritised. |
| Layout / Sidebar | GOOD | Sidebar collapses to an overlay below `md`. |
| Block pills, Dashboard | OK | Horizontal scroll and stacking. |
| Residents | **LIKELY BREAKS** | No breakpoints at all. Multi-column panels and inline vacation-range rows with fixed inline widths. |
| Attending Schedule | **LIKELY BREAKS** | 1106 lines, no breakpoints; a wide day-by-attending matrix in a single `overflow-x` container. |
| Block Settings, Program Settings, Setup, Register | UNTESTED | No breakpoints. Mostly narrow forms, so probably survive, but unverified. |

Only 5 of 20 components use any Tailwind breakpoint, and all of them use only `md:`. There is no tablet-specific treatment anywhere — tablets get the desktop layout.

### Accessibility

Thin, and the gaps are the standard high-impact ones. Across the whole frontend: 5 `aria-label` attributes in 2 files, 1 `role`, 3 `htmlFor` bindings against 34 `<label>` elements, zero `tabIndex`, zero `alt` attributes.

- **No modal handles Escape** — zero keydown handlers exist in the codebase. No focus trap, no focus restore, no `role="dialog"`, no `aria-modal`.
- **Most labels are not programmatically associated** with their inputs; they are styled `<label>` elements sitting above fields.
- **Focus states rely on browser defaults**; many controls set inline `border:none`.
- **Colour carries meaning alone** in calendar chips (green senior, amber junior, red attending).
- Positives: day cells are real `<button>` elements, so the grid is keyboard-reachable, and the login password toggle is a proper labelled button with an E2E test.

### Visual consistency

Two distinct design generations coexist. `Register.jsx` uses a plain indigo-on-grey style with a JS `styles` object; the authenticated app uses a considered navy/slate system with Tailwind. Terminology also drifts: "Auto-generate" vs "Generate", "Block rules" vs "Block settings", "Attending" vs "Attending Schedule". Styling is predominantly inline objects rather than classes, which is why duplication is so easy to introduce.

---

## 16. Frontend Performance

**The original root cause is still fixed.** The regression was a full-page `.animated-bg` with `background-size: 400% 400%` and an 18-second infinite gradient animation behind every authenticated page, compounded by infinite box-shadow animations on every calendar cell, blurred modal backdrops, and Framer `layout` on repeated resident rows.

Verified today: `index.css` contains three keyframe animations, all legitimate (`shimmer` for skeletons, `checkPop`, `shake`), and the only `infinite` animation is a loading spinner. Modal backdrops explicitly set `backdropFilter: 'none'`. Calendar cells use short, property-scoped transitions.

### Does the guard actually catch dangerous patterns?

`perf:guard` passes with one known warning. It is a genuine, thoughtful line-based scanner covering infinite animations outside loading contexts, keyframes animating `box-shadow`, `transition: all` / `transition-all`, backdrop blur in any form including the JSX-object spelling, and Framer `layout` on repeated elements — escalating to failure in a hardcoded list of "core" files.

Its blind spots are worth knowing:

- **The headline check is name-based.** The `.animated-bg` rule only fires on that exact class name. Reimport the same gradient under a different class and the guard is silent — against the very regression it exists to prevent.
- **"Core" is a hardcoded file list.** A new heavy page, or `PublicSchedule`, gets warnings instead of failures.
- It cannot see re-render cost, context-update breadth, or large repeated `motion` trees — only static text patterns.

### The 500 kB warning

The build emits one 619 kB chunk (180 kB gzipped) with no code splitting. **This does not matter yet and should not be optimised now.** 180 kB gzipped is unremarkable for a React app of this scope, every route is reached immediately after login, and the app is used on hospital desktops rather than cold mobile connections. The existing documentation reaches the same conclusion and it is the right one. Revisit only if real users report slow first loads.

The one honest remaining item is the guard's own warning: an animated box-shadow at `Calendar.jsx:1174` used for a publish-success pulse. Low frequency, correctly triaged as a warning.

---

## 17. Security & Privacy

> ### Demonstrated cross-program breach
>
> During this audit, a Viewer authenticated in the "QA Vascular Surgery" program called `GET /api/programs/stats` with a block ID belonging to a *different* program and received HTTP 200 with real data:
>
> ```json
> residents: 6
> callDistribution: [
>   {"residentName":"Dr. Jane newman","callCount":7},
>   {"residentName":"Amina Patel","callCount":7},
>   {"residentName":"Ethan Brooks","callCount":7},
>   {"residentName":"Dr. Hamoud Hajim","callCount":6},
>   {"residentName":"Dr. Almukhtar Almomatten","callCount":6},
>   {"residentName":"Noah Williams","callCount":5}
> ]
> ```
>
> `router.use(auth)` at the top of the file establishes only that *someone* is logged in; the handler never calls `requireBlockPermission`. The same request against `/api/assignments` and `/api/attending` correctly returned 403, which confirms the gap is specific to this one route rather than systemic. `CONFIRMED — P0`

### Findings by area

| Area | State | Detail |
|---|---|---|
| Password hashing | OK | bcrypt cost 10. No password policy of any kind — a single character is accepted. |
| JWT | WEAK | HS256, 7-day expiry, no refresh, no revocation, no `iss`/`aud`. Secret is 36 chars from `.env` (correctly gitignored). `process.env.JWT_SECRET` is never validated at boot — if unset, `jwt.sign` throws at request time. |
| Token storage | WEAK | `localStorage`, readable by any injected script. No 401 interceptor, so expiry degrades silently. |
| Login enumeration | OK | Both failure modes return the same "Invalid credentials". |
| Rate limiting | **NONE** | No throttling on login, registration, or any endpoint. Password brute force is unimpeded. |
| Program isolation | **BROKEN** | Mostly enforced, with four holes — see the IDOR list below. |
| Privilege escalation | BY DESIGN | Any registered user can create an organization (hardcoded `active`) and a program, becoming Program Admin. No approval gate exists. |
| Unauthenticated writes | **YES** | `POST /api/auth/request-access` creates an `Organization` row with no authentication and no rate limit — an open database-write endpoint. |
| publicToken | OK | UUID v4, unique, unguessable. Correctly a capability URL — but it can never be revoked. |
| Public privacy shaping | GOOD | Allowlist reconstruction. Verified by a passing check that asserts no forbidden key survives. |
| Error handling | LEAKY | The global handler returns `err.message` to the client — Prisma errors can expose schema details. Most routes correctly return generic messages. |
| Logging | NOISY | Every request path is logged. `attending.js` logs full request bodies. No credentials or tokens are logged. |
| CORS | DEV ONLY | Four hardcoded localhost origins. Correctly restrictive — but there is no production origin, so deployment requires a code change. |
| SQL / Prisma safety | OK | Parameterised throughout. No raw SQL in application code. |
| QA credentials | OK | Seed refuses to run when `NODE_ENV=production`, uses `QA_ONLY` naming and a `.local` domain, and never deletes unrelated data. |
| Production guards | **ABSENT** | No helmet, no HTTPS enforcement, no body-size limit, no request ID, no graceful shutdown, no env validation at boot. |

### The four IDOR holes

1. **`GET /api/programs/stats`** — no permission check at all. Demonstrated above. `CONFIRMED`
2. **`POST /api/attending/copy`** — permission is checked on the *target* block only. A user can copy attending data *out of* a block in another program into their own, reading data they cannot otherwise see. `CODE-CONFIRMED`
3. **`POST /api/attending-template/:programId/apply/:blockId`** — permission is checked on `blockId`, but the body accepts `extraBlockIds[]` which are written to with no check at all. A cross-program *write*. `CODE-CONFIRMED`
4. **Resident/block program mismatch** — `POST /api/assignments`, `POST /api/residents`, and `POST /api/residents/:id/enroll` never verify that the resident and the block belong to the same program. `CODE-CONFIRMED`

### What would be required before production use

**No compliance claim is made or implied here.** Residency call schedules are workforce data rather than patient records, but they identify named clinicians and their whereabouts, and institutional review will treat them as sensitive. Before any real program's data goes in, at minimum:

- Close every IDOR listed above.
- Add rate limiting and a password policy.
- Move tokens out of `localStorage`, or add short expiry with refresh.
- Enforce HTTPS and set real CORS origins.
- Add security headers and a body-size limit.
- Add an audit trail for who changed which assignment and when — currently unrecoverable; `CallAssignment` has `createdAt` but no actor.
- Define data retention and deletion policy.
- Add token revocation for published links.
- Obtain institutional sign-off.

That list is a starting point, not a certification.

---

## 18. Automated Testing & QA

Every check in the repository passes. That fact is much less reassuring than it looks.

| Test | What It Protects | Real DB? | Browser? | Weaknesses |
|---|---|:--:|:--:|---|
| `roles:smoke` | Role normalisation and the permission table | No | No | Pure unit test of a lookup table. **Tests zero routes.** Every authorization gap in §17 is invisible to it. |
| `roles:audit` | Role distribution in live data | Yes | No | Read-only reporting tool, not a test — it never fails. Correctly prints no PII. Reports clean data. |
| `paro:smoke` | PARO helper functions | No | No | **Never calls `generateSchedule`.** The helper assertions are good. The five "scheduler contract" assertions are `source.includes('...')` string greps — they pass if a log message exists and break if you reword one, regardless of behaviour. |
| `phase5:smoke` | Override preservation, clear semantics, generation summary | No | No | Mocks diverge from production: the fake returns a med student with `isServiceResident: true`, which the real query would exclude. Its med-student assertion passes because the junior slot was already filled, not because the cap worked. Four assertions grep source files. |
| `phase5:db` | Persistence across real Prisma reads | Yes | No | The strongest backend check — creates and cleans up its own isolated org. **Not run in this audit** (writes to the database). |
| `phase6:public-privacy` | Public shaping excludes private keys | No | No | Good design: feeds a deliberately dirty snapshot and asserts no forbidden key survives. Tests the *function*, not the routes — which is why the `/schedule/history` leak went unnoticed. |
| `phase6:excel` / `phase6:printable` | Workbook and HTML generation, headers, no private values | No | No | Fixture-driven. Never touches the export routes or their authorization. |
| `phase6:smoke` | Runs the three above | No | No | Aggregator only. |
| `perf:guard` | Repaint-heavy CSS/JSX patterns | n/a | No | Genuinely useful. Name-based on the key rule; hardcoded "core" file list. See §16. |
| `lint` / `build` | Syntax, hooks rules, bundling | n/a | No | Both clean. Lint is not type-aware. |
| `e2e` (Playwright) | Login, calendar modal, persistence, viewer restrictions, program settings | Yes | Yes | **By far the most valuable suite.** Five real Chromium tests including a direct API call asserting a Viewer gets 403. Weaknesses: it seeds and mutates the database; mojibake is checked only on `/calendar` and its pattern list misses double-encoded emoji; no coverage of generation, publishing, export, residents, or attending. |

> **The pattern worth internalising:** roughly a dozen assertions across three suites are `fs.readFileSync(...).includes('some string')`. They assert that source code *contains text*. They will pass after a refactor that completely changes behaviour, and fail after a harmless rename. They are the reason the PARO suite reported green while `maxCallsPerResident` quietly stopped working.

### What was run, and what was not

**Run and passing:** `paro:smoke`, `phase5:smoke`, `phase6:smoke` (all three sub-checks), `roles:smoke`, `roles:audit`, `prisma validate`, `perf:guard`, `lint`, `build`. Plus live read-only queries for schema, indexes, duplicates and row counts, and read-only authenticated API probes.

**Deliberately skipped:** `phase5:db` and `e2e` — both write to the database (E2E runs `dev:seed-qa` and then mutates a seeded assignment), and this audit was required to leave the project unmodified. Playwright's Chromium *is* installed, so both are one command away. `dev:seed-qa` was likewise not run.

---

## 19. Documentation Accuracy

The documentation is unusually well written for a personal project — specific, structured, honest about known warnings. It is also, in several places, describing a system that no longer exists.

| Document | Purpose | Still Accurate? | Major Stale Sections |
|---|---|---|---|
| `MEDROTA_PROGRESS_REVIEW.md` | Milestone status | MOSTLY | "PARO scheduler rules are implemented" is true but oversells: the blended-call rule cannot bind and days-on-service ignores most time-away. Lists no known defects, so it reads as healthier than the code is. |
| `SCHEDULING_RULES_PARO.md` | Scheduler rule reference | MOSTLY | Accurately documents what the code does — including the `home + 3×in-house` blended formula, which **differs from the rule as stated in the audit brief**. Omits that the rule can never bind. Omits that three Block Settings were orphaned by the same refactor. |
| `PHASE5_QA_CHECKLIST.md` | Phase 5 closeout | **STALE** | States `maxCallsPerResident` "is exercised" by the smoke check. The scheduler stopped reading that field in the PARO refactor; the smoke check sets it in a mock and never asserts on it. Marked "closed" on evidence that no longer holds. |
| `PHASE6_QA_CHECKLIST.md` | Phase 6 closeout, privacy boundary | **CONTRADICTED** | Its privacy boundary explicitly forbids exposing "override flags/reasons" and "raw `snapshotJson`". `GET /api/schedule/history` serves exactly those to in-program Viewers. True for `/api/public/*`, false as a system-wide statement. |
| `LOCAL_QA.md` | QA credentials and manual checklist | MOSTLY | Credentials and seed behaviour verified correct. States a Program Admin can "delete program" — **no such route exists.** Manual checklist step 3 asks the tester to confirm no mojibake on the calendar; mojibake is on the Dashboard instead. |
| `FRONTEND_PERFORMANCE_NOTES.md` | Regression post-mortem, banned patterns | **ACCURATE** | The best document in the project. Root cause, banned/allowed patterns with examples, and a working guard. Its judgment to defer code splitting is correct. Only gap: does not mention that the guard's key check is class-name-based and therefore evadable. |
| `PRE_PHASE6_DIRTY_TRACKED.patch` | — | ORPHAN | An 89 kB uncommitted-work patch left at repo root, superseded by the commits that followed. Pure noise. |
| `frontend/README.md` | — | BOILERPLATE | Untouched Vite template. **There is no root README** — no setup instructions, no architecture overview, no explanation of what MedRota is. |

> **The systematic bias:** every document was written at the moment a phase closed, by someone who had just verified it. None was revisited when a later refactor invalidated it. The PARO rewrite — the very last work done — silently falsified claims in two earlier documents, and the documents written alongside it describe the new engine without noting what the old one did that the new one no longer does.

---

## 20. Bugs / Defects Found

Numbered for reference from the roadmap. Severity is by consequence, not effort.

### D1 — Cross-program data leak via program stats · `CONFIRMED LIVE` · CRITICAL

`GET /api/programs/stats` authenticates but never authorises. Any logged-in user with any block ID reads that block's resident names, per-resident call counts, and recent activity.

`backend/routes/programs.js:83` — handler has no `requireBlockPermission` call.

### D2 — Three block settings are inert but still editable · `CONFIRMED` · CRITICAL

`maxCallsPerResident`, `allowWeekendConsecutive` and `limitWeekendCalls` are read by nothing. The PARO refactor deleted their consumer and left the columns, API and two UI surfaces intact. Users are shown working controls that silently do nothing.

Orphaned by `48f499f` — still exposed in `BlockSettings.jsx` and `Calendar.jsx:988`.

### D3 — Same resident in both roles destroys the senior assignment · `CONFIRMED` · CRITICAL

Selecting one resident for both slots posts twice; the second post matches the row just created by `(callDayId, residentId)` and updates its role to junior. The senior assignment vanishes. The guard written for this case is dead code — a shadowed `warning` is computed, passed to `onSave`, and discarded, while the JSX reads an outer `const warning = null`.

`Calendar.jsx:547` (dead const) · `:549` (shadowed) · `:1412` (discards it) · `assignments.js:89`.

### D4 — Manual assignments bypass every PARO rule · `CONFIRMED` · CRITICAL

`POST /api/assignments` validates nothing beyond presence of fields. No vacation check, no consecutive-call check, no maximums, no `roleOnDay` validation. Every calendar save writes `isOverride: true`, so it also permanently survives regeneration and is never re-validated.

### D5 — Attending copy reads from an unauthorised source block · `CODE-CONFIRMED` · CRITICAL

`POST /api/attending/copy` checks permission on the target block only, then reads all entries from any `sourceBlockId` supplied. Cross-program read. `backend/routes/attending.js:117`.

### D6 — Template apply writes to unchecked extra blocks · `CODE-CONFIRMED` · CRITICAL

`extraBlockIds[]` from the request body are written to without any permission check. Cross-program write. `backend/routes/attendingTemplate.js:206`.

### D7 — Residents and blocks are never checked to share a program · `CODE-CONFIRMED` · CRITICAL

Assignment, resident creation and enrollment all accept a `residentId` and `blockId` from different programs. Corrupts program isolation at the data layer.

### D8 — No authentication guard on frontend routes · `CONFIRMED` · CRITICAL

`App.jsx` has no redirect for unauthenticated users. Visiting any path renders the authenticated shell; the catch-all sends unknown paths to `/dashboard`. Backend data is protected, so this is a UX and trust failure rather than a breach — a logged-out visitor sees a broken app instead of a login screen.

### D9 — Unauthenticated organization creation · `CONFIRMED` · CRITICAL

`POST /api/auth/request-access` writes an `Organization` row with no auth and no rate limit. Nothing ever reads the `pending` status it sets, so the rows are pure landfill.

### D10 — Vacation ignored for non-enrolled service residents · `CONFIRMED` · HIGH

The scheduler merges in all active service residents with `vacationDates: []`. Because vacation lives on `BlockEnrollment`, a resident on leave without an enrollment row for that block is fully schedulable during their leave. `backend/services/scheduler.js:234`.

### D11 — Holidays never render in the calendar · `CONFIRMED` · HIGH

`isHoliday: false` is hardcoded into every day object, making all holiday styling in both `DayCell` and `DayRow` unreachable. The scheduler skips holidays, so days go blank with no explanation. No UI exists to create a holiday; the table has zero rows. `Calendar.jsx:1378`.

### D12 — Raw published snapshot served to in-program viewers · `CONFIRMED` · HIGH

`GET /api/schedule/history` uses `requireBlockView` and returns unshaped `snapshotJson` including resident IDs, assignment IDs, `isOverride` and `overrideReason`. Contradicts the documented privacy boundary.

### D13 — Visible mojibake in the dashboard activity feed · `CONFIRMED` · HIGH

Double-encoded emoji in `routes/programs.js` render as literal garbage beside every activity item. Five source files also carry UTF-8 BOMs. `backend/routes/programs.js:154,162` → `Dashboard.jsx:367`.

### D14 — Blended-call rule uses different weights and cannot bind · `NEEDS PRODUCT DECISION` · HIGH

Implemented as `home + 3×in-house <= 30`; the brief states `3×home + 4×in-house <= 30`. Independently, because call type is fixed per resident, no one accumulates both kinds, so the limit is unreachable either way.

### D15 — No database constraints or foreign-key indexes · `CONFIRMED` · HIGH

Verified live: only primary keys and four unique indexes exist. Nothing prevents duplicate call days, enrollments or memberships; every foreign-key lookup is a sequential scan.

### D16 — `delete_program` is granted but has no route · `CONFIRMED` · MEDIUM

Present in both permission tables, asserted in `roles:smoke`, documented in `LOCAL_QA.md` as a Program Admin capability. No `DELETE /api/programs/:id` exists.

### D17 — Invite links hardcoded to localhost · `CONFIRMED` · MEDIUM

`res.json({ inviteLink: 'http://localhost:5173/join/' + token })`. Every invite generated anywhere but a dev machine is unusable. `backend/routes/programs.js:397`.

### D18 — Onboarding dead-ends without an invite · `CONFIRMED` · MEDIUM

Setup offers only "create organization." A user whose program already exists must create a duplicate. The four onboarding fields collected at registration are never read by anything.

### D19 — Program Admin can orphan a program by self-demotion · `CODE-CONFIRMED` · MEDIUM

The last-admin guard exists only on the leave-program path. `PUT /programs/:id/members/:userId` lets the sole admin set their own role to Viewer, leaving the program with no one who can manage it.

### D20 — Block generation can drift a day across spring DST · `LIKELY` · LOW

`buildBlocks` advances with local-time `setDate(+28)` from a UTC-midnight anchor. Crossing into daylight time shifts the stored instant enough to change the derived date key, so late-year blocks can start one day off. Depends on server timezone; not reproducible on a UTC host. `backend/routes/programs.js:12`.

### D21 — Token expiry degrades silently · `CONFIRMED` · LOW

No axios 401 interceptor. When the 7-day JWT expires the UI stays rendered while every request fails, with no redirect to login and no message.

### D22 — Calendar save is not atomic · `CONFIRMED` · LOW

`handleSaveAssignment` issues deletes then creates as separate requests after optimistically updating local state. A failure between them loses assignments while the UI has already shown the new value; the error toast does not roll back.

### D23 — `usedFallback` warning is now permanent noise · `CONFIRMED` · LOW

Once meaning "fewer than two residents enrolled," it now evaluates true whenever any service resident lacks an enrollment row — the normal case. The Calendar still surfaces a warning banner for it.

### D24 — Academic-day rule depends on flag text · `CONFIRMED` · LOW

The scheduler matches flag labels against `/academic/i`. Renaming a flag from "Academic day" to "Teaching day" silently disables the rule for those days, with no feedback.

---

## 21. Technical Debt

Notably, the codebase contains **zero** `TODO`, `FIXME`, `HACK`, or `XXX` markers. The debt here is not annotated — it is structural, which makes it harder to find and is why the orphaned settings survived a refactor.

| Debt | Detail |
|---|---|
| **Four copies of date normalisation** | `startOfLogicalDay` is duplicated verbatim in `assignments.js`, `attending.js` and `attendingTemplate.js`; `paroRules.js` has a fourth implementation; the frontend has a fifth in `Calendar.jsx` and a sixth in `blockUtils.js`. They are not all equivalent — `blockUtils.getFlagForDate` round-trips through a local `Date`, the exact pattern the Phase 5 fix eliminated elsewhere. |
| **Duplicated permission tables** | `lib/roles.js` and `constants/roles.js` are hand-maintained mirrors. Currently identical; nothing enforces that. |
| **Duplicated block-settings UI** | Two independent editors for the same six fields, with separate defaults and save handlers. |
| **Dead code** | `clearSchedule()` is imported by `routes/schedule.js` and never called — the route reimplements it inline. `addDaysToDateKey` is imported into the scheduler unused. Holiday styling in two components is unreachable. The `warning` block in `DayModal` is unreachable. |
| **Hardcoded legacy data** | `blockUtils.BLOCK_RANGES` hardcodes thirteen 2026 date ranges as a fallback when a block has no dates. These do not match what the backend generates (July-anchored), so the fallback produces a different calendar than the real one. |
| **Hardcoded values in live paths** | The localhost invite link (D17); four localhost CORS origins; `Layout.jsx` defaults `activeBlock` to `3`. |
| **Orphaned artefact** | `PRE_PHASE6_DIRTY_TRACKED.patch` — 89 kB of superseded diff at repo root. |
| **Console logging as observability** | 48 `console.log` and 58 `console.error` calls, including a global request logger and full request-body dumps in `attending.js`. No log levels, no structure, no redaction policy. |
| **Monolithic component** | `Calendar.jsx` at 1809 lines carries grid, mobile list, day modal, attending editor, flag editor, settings panel, generate, clear, publish, and export. |
| **Sequential N+1 queries** | `attendingTemplate` apply loops days × templates issuing one `findFirst` per pair; `attending/copy` issues one per entry; `schedule/history` fetches the publisher user once per version. |
| **Silent error swallowing** | `Calendar.jsx`'s block-data fetch catches errors into an empty block with a comment preserving "silent failure behavior" — a failed load is indistinguishable from an empty block. |
| **Encoding damage** | Five files with UTF-8 BOMs and double-encoded characters throughout comment separators, plus the two user-visible cases in D13. |
| **Unused assets** | `frontend/src/assets/` still holds the Vite/React starter SVGs and a `hero.png`; `frontend/README.md` is the untouched template. |

---

## 22. Production Readiness Scores

| Dimension | Score | Rationale |
|---|:--:|---|
| Product completeness | **6/10** | The whole loop exists end to end. Missing: residents as users, schedule validation as an action, holiday management, unpublish, call swaps. |
| Scheduler correctness | **4/10** | Rules it enforces, it enforces correctly. But vacation is ignored for non-enrolled residents, three settings are inert, manual edits bypass everything, and no test exercises the generator end to end. |
| PARO rule implementation | **5/10** | Both maximum tables, consecutive call, weekends off, home-call weekends and vacation rules are genuinely implemented. Blended call is wrong and inert; days-on-service is incomplete; overrides are unvalidated. |
| Authentication / security | **3/10** | bcrypt and JWT basics are right. No rate limiting, no password policy, no revocation, tokens in localStorage, an unauthenticated write endpoint, no production hardening of any kind. |
| Authorization | **4/10** | The permission model is excellent and consistently applied — on most routes. Four isolation holes including one demonstrated live breach, and zero automated coverage of enforcement. |
| Data integrity | **3/10** | No unique constraints, no FK indexes, no cascades, free-form enums, racy find-then-create, cross-program references possible, manual multi-step deletes outside transactions. |
| UX | **5/10** | The core scheduling loop is genuinely good. Vacation entry is punishing, rules are duplicated across two screens, warnings are not actionable, and onboarding can dead-end. |
| Mobile responsiveness | **4/10** | The two surfaces that matter most — Calendar and public schedule — have real mobile layouts. Residents and Attending have none. No tablet treatment anywhere. |
| Performance | **7/10** | The regression was properly root-caused, fixed, documented and guarded. Deducted for the evadable guard, missing FK indexes, and N+1 loops in template apply and copy. |
| Automated testing | **4/10** | Real browser E2E and a real-DB persistence check are genuine assets. Undermined by a dozen source-grep assertions, divergent mocks, an assertion passing for the wrong reason, and no authorization coverage. |
| Deployment readiness | **2/10** | No Dockerfile, no CI, no deploy config, no migration strategy, no health monitoring, no env validation. Hardcoded localhost in CORS and invite links. 41 commits unpushed. |
| Documentation | **5/10** | Well written and specific — and materially stale in two documents, contradicted by code in a third. No root README at all. |

### Classification: **Functional MVP**

Above a prototype — the whole workflow runs, data persists, roles work, and there is real automated coverage. Well below private beta, because private beta implies you can hand it to a second user without supervision, and the demonstrated cross-program leak plus the silently-inert settings mean you cannot.

The honest description is: *a working single-tenant tool whose output a knowledgeable owner must still verify by eye.*

---

## 23. What Should Be Deferred

Each of these is attractive, and each would be a mistake to start now.

| Work | Why to postpone |
|---|---|
| **Code splitting / bundle optimisation** | 180 kB gzipped is fine, every route loads right after login, and users are on hospital desktops. The warning is advisory. Your own performance notes already reached this conclusion — trust it. |
| **Server-generated PDFs** | The printable HTML works and browsers export it perfectly well. Adding Puppeteer or a PDF library means a headless-browser dependency and a deploy footprint, to replace something already functional. |
| **Animation and visual polish** | Animation caused the one serious performance incident in this project's history. There is no current complaint. Leave it. |
| **Call swaps and shift-trading** | Requires residents to be users, notifications, an approval workflow, and an audit trail — none of which exist. It is a whole second product. |
| **Email notifications** | Needs a mail provider, templates, delivery monitoring, and unsubscribe handling. Also depends on residents being users. |
| **Advanced analytics / fairness dashboards** | The generation summary already reports per-resident load. Richer analytics on top of a scheduler whose settings are partly inert would present false precision. |
| **Alternate call models** (night float, 24h, split) | The current two-role senior/junior model is not yet fully correct. Generalising it now multiplies the surface area of every existing bug. |
| **A constraint solver** | Tempting, because greedy chronological assignment demonstrably leaves days unassigned. But the inputs are not trustworthy yet — vacation is silently dropped for some residents. **Fix the inputs before improving the algorithm**, or you will get confidently-wrong schedules instead of visibly-incomplete ones. |
| **Multi-program / multi-institution support** | Program isolation is currently broken. Adding tenants before fixing isolation multiplies the breach. |
| **Rewriting `Calendar.jsx`** | It is 1809 lines and it works, with the only meaningful E2E coverage in the project pointed at it. Splitting it is worthwhile eventually — after the correctness fixes land, not instead of them. |

---

## 24. P0/P1/P2/P3 Recovery Roadmap

### P0 — Must fix before trusting MedRota

#### P0-1 · Push 41 commits to origin

- **Problem:** every commit since 2026-05-06 exists only on this machine.
- **Why it matters:** a disk failure destroys the entire PARO engine, roles redesign, Phase 6 and all E2E work. This is the highest-value action in this document and it takes seconds.
- **Solution:** `git push origin main`
- **Files affected:** none
- **Difficulty:** Small · **Risk:** Low

#### P0-2 · Close the four authorization holes (D1, D5, D6, D7)

- **Problem:** one demonstrated cross-program read, one cross-program attending read, one cross-program write, and unvalidated resident/block pairing.
- **Why it matters:** named clinicians' schedules leak between institutions; a single wrong ID corrupts isolation.
- **Solution:** add `requireBlockPermission` to `/programs/stats`; check the *source* block in attending copy; validate every entry in `extraBlockIds`; add a shared helper asserting resident and block share a program, and call it from assignment, resident creation and enrollment.
- **Files affected:** `routes/programs.js`, `routes/attending.js`, `routes/attendingTemplate.js`, `routes/assignments.js`, `routes/residents.js`
- **Difficulty:** Small · **Risk:** Low

#### P0-3 · Resolve the three inert block settings (D2)

- **Problem:** users are shown working controls that do nothing.
- **Why it matters:** a Chief Resident who caps someone's calls and sees it saved will believe the schedule respects it. This is the most likely way MedRota produces a schedule someone acts on and later regrets.
- **Solution:** decide per setting — either reconnect it to the scheduler or remove it from both UIs and deprecate the column. `maxCallsPerResident` is worth reconnecting as a stricter-than-PARO ceiling; the two weekend flags are probably now redundant with the PARO weekend rules.
- **Files affected:** `services/scheduler.js`, `routes/blocks.js`, `pages/BlockSettings.jsx`, `pages/Calendar.jsx`, `schema.prisma`
- **Difficulty:** Medium · **Risk:** Medium (changes generated output)

#### P0-4 · Fix the same-resident double-assignment data loss (D3)

- **Problem:** assigning one resident to both slots silently deletes the senior assignment.
- **Why it matters:** silent data loss during the app's most-used interaction.
- **Solution:** reject the case in the modal before saving using the warning that already exists but is unreachable; additionally make `POST /api/assignments` match on `(callDayId, residentId, roleOnDay)` or reject a duplicate resident on a day.
- **Files affected:** `pages/Calendar.jsx`, `routes/assignments.js`
- **Difficulty:** Small · **Risk:** Low

#### P0-5 · Stop dropping vacation for non-enrolled residents (D10)

- **Problem:** service residents merged in without a `BlockEnrollment` arrive with no vacation and can be scheduled during leave.
- **Why it matters:** this is the failure mode that puts a real person on call while they are away — the exact thing MedRota exists to prevent.
- **Solution:** when merging a service resident, look up any enrollment for that resident in the block first; failing that, auto-create enrollments when a resident is added, so vacation always has a home. Longer term, move vacation to the profile with date ranges.
- **Files affected:** `services/scheduler.js`, `routes/residents.js`
- **Difficulty:** Medium · **Risk:** Medium

#### P0-6 · Validate manual assignments and surface violations (D4)

- **Problem:** manual edits bypass every rule and are never re-checked.
- **Why it matters:** the calendar is where most real schedules are finalised, so the compliance engine is bypassed exactly where it matters most.
- **Solution:** run the `paroRules` checks on `POST /api/assignments` and return violations as warnings rather than hard failures — overrides must remain possible, but never invisible. Add a "validate this block" endpoint the calendar can call on demand.
- **Files affected:** `routes/assignments.js`, `services/paroRules.js`, `pages/Calendar.jsx`
- **Difficulty:** Medium · **Risk:** Low

---

### P1 — Needed for a reliable MVP

#### P1-1 · Add database constraints and indexes (D15)

- **Problem:** no uniqueness, no FK indexes.
- **Why it matters:** the duplicate-day bugs fixed in June are prevented by convention only and can recur under concurrency.
- **Solution:** unique indexes on `CallDay(blockId,date)`, `BlockEnrollment(blockId,residentId)`, `ProgramMember(programId,userId)`; plain indexes on every FK; convert find-then-create to `upsert`. Check for existing duplicates before applying.
- **Files affected:** new migration, `schema.prisma`, several routes
- **Difficulty:** Medium · **Risk:** Medium

#### P1-2 · Make holidays real end to end (D11)

- **Problem:** holidays are modelled and respected by the scheduler but invisible in the calendar, with no way to create one.
- **Why it matters:** unexplained blank days destroy trust in the generator.
- **Solution:** fetch holidays into the calendar and populate `isHoliday` honestly; add holiday management to Program or Block Settings.
- **Files affected:** `pages/Calendar.jsx`, a holidays route, settings UI
- **Difficulty:** Medium · **Risk:** Low

#### P1-3 · Add a frontend auth guard and 401 handling (D8, D21)

- **Problem:** logged-out users render the app shell; expired tokens fail silently.
- **Solution:** a route wrapper redirecting to `/login`, plus an axios response interceptor that clears the token and redirects on 401.
- **Files affected:** `App.jsx`, `api/axios.js`
- **Difficulty:** Small · **Risk:** Low

#### P1-4 · Shape the schedule history response (D12)

- **Problem:** raw `snapshotJson` with IDs and override reasons is served to in-program Viewers.
- **Solution:** return metadata only by default; require `view_draft_schedule` for full snapshot content, or reuse the public shaper for lower roles.
- **Files affected:** `routes/schedule.js`
- **Difficulty:** Small · **Risk:** Low

#### P1-5 · Replace source-grep assertions with behavioural tests

- **Problem:** a dozen assertions check that source files contain strings.
- **Why it matters:** this is precisely why the orphaned settings passed CI.
- **Solution:** add real generator tests against an in-memory or throwaway database asserting outcomes — nobody exceeds their maximum, nobody works consecutive days, nobody is scheduled on vacation, everyone keeps two weekends. Add authorization tests hitting each route with each role. Delete every `includes()` assertion.
- **Files affected:** `backend/scripts/*`
- **Difficulty:** Large · **Risk:** Low

#### P1-6 · Fix mojibake and normalise file encoding (D13)

- **Solution:** replace the two double-encoded icon strings, strip BOMs from the five affected files, repair comment separators, and extend the E2E mojibake check to the Dashboard with patterns covering double-encoded emoji.
- **Difficulty:** Small · **Risk:** Low

#### P1-7 · Make invite links and CORS environment-driven (D17)

- **Solution:** an `APP_BASE_URL` env var for invite links; CORS origins from env with the localhost list as the dev default; validate required env vars at boot and exit loudly if absent.
- **Difficulty:** Small · **Risk:** Low

#### P1-8 · Add rate limiting and a password policy

- **Problem:** unlimited login attempts; one-character passwords accepted; an unauthenticated org-creation endpoint.
- **Solution:** `express-rate-limit` on auth routes and globally; a minimum-length rule; either authenticate `request-access` or remove it, since nothing reads its output.
- **Difficulty:** Small · **Risk:** Low

#### P1-9 · Resolve `delete_program` and the self-demotion gap (D16, D19)

- **Solution:** either implement the route with a confirmation and cascade, or remove the permission from both tables, the smoke test and the docs. Separately, block a sole Program Admin from demoting themselves.
- **Difficulty:** Small · **Risk:** Low

---

### P2 — Important product improvements

| Item | Problem / Solution | Difficulty | Risk |
|---|---|---|---|
| **P2-1 · Fix onboarding** (D18) | Add a "join an existing program" path to Setup; log the user in directly after registration; either use the four onboarding fields or stop collecting them. | Medium | Low |
| **P2-2 · Make vacation entry bearable** | Copy-forward from the previous block, bulk entry, or profile-level vacation ranges that apply across blocks. Currently the single biggest time sink in real use. | Medium | Medium |
| **P2-3 · Make generation warnings actionable** | Name the residents blocked and the binding constraint, link each warning to its day, and drop the now-meaningless `usedFallback` banner (D23). | Medium | Low |
| **P2-4 · Consolidate duplicated logic** | One shared date module for the backend, one for the frontend; one block-settings editor; a single source for the permission table shared by both sides. | Medium | Medium |
| **P2-5 · Responsive and accessibility pass** | Breakpoints for Residents and Attending; Escape-to-close, focus trap and `role="dialog"` on modals; `htmlFor` on every label; visible focus states. | Medium | Low |
| **P2-6 · Mark draft versus published in exports** | Protected exports read live data while public exports read the snapshot. Label them, and show a "changed since publish" indicator on the Calendar. | Small | Low |
| **P2-7 · Write a root README and reconcile the docs** | No root README exists. Add setup, architecture and rules; correct the stale claims in the Phase 5, Phase 6 and Local QA documents; delete the orphaned patch file. | Small | Low |

---

### P3 — Later enhancements

Unpublish and token rotation · audit trail of who changed which assignment · residents as read-only users with a personal schedule view · import residents from CSV · multi-program membership (`/programs/mine` currently returns an arbitrary first membership) · block-level academic-day flags decoupled from label text (D24) · DST-safe block generation (D20) · Docker and CI.

---

## 25. Recommended MVP Definition

The smallest coherent MedRota is **close to what already exists**, minus the half-built parts and plus the correctness fixes. The temptation is to add; the right move is to finish and subtract.

### In scope

| Capability | Rationale |
|---|---|
| Email + password authentication | Exists. Needs rate limiting and a password rule. |
| Single organization and program setup | Exists. Multi-tenancy is explicitly out. |
| Four roles with invite-based joining | Exists and is the healthiest subsystem. |
| Academic year with 13 blocks | Exists. |
| Resident roster with senior/junior and med students | Exists. |
| Vacation per resident | Exists but must actually reach the scheduler (P0-5) and be less painful to enter (P2-2). |
| Attending schedule with weekly template | Exists. Genuinely differentiating — call scheduling around attending coverage is the real job. |
| Program call-type settings | Exists, newest and best-tested feature. |
| PARO-aware auto-generation | Exists. The core value proposition. |
| Manual adjustment with override preservation | Exists. Must warn on violations (P0-6). |
| **On-demand schedule validation** | **The one genuinely new thing the MVP needs.** A "check this schedule" action answering "is what I have right now compliant?" — the question the product exists to answer and currently cannot. |
| Publish with snapshot and public link | Exists and is well built. |
| Excel and printable exports | Exist. Label draft versus published. |
| Responsive viewing on Calendar and public schedule | Exists. Others can wait. |
| Holiday display | Half exists; finishing it is small and removes a trust-destroying mystery. |

### Explicitly out of the MVP

Residents as users · call swaps · notifications of any kind · multi-program or multi-institution support · approval workflows · analytics beyond the generation summary · alternate call models · a constraint solver · server-generated PDFs · mobile layouts for Residents and Attending · and the four unused onboarding metadata fields, which should be removed rather than left collecting data nothing reads.

> **Framed as a single sentence:** the MedRota MVP is a tool that lets one Chief Resident, for one program, produce a PARO-compliant 28-day call schedule they can trust, adjust by hand with visible warnings, and publish as a link their colleagues can open on a phone.

---

## 26. MedRota in Plain English

### 1. What MedRota is

It is a website that builds the on-call schedule for a group of doctors in training. Every four weeks, someone has to decide which resident is on call each night. Right now most programs do this in Excel, by hand, and it takes hours. MedRota does the first draft automatically and lets you fix it by hand afterwards.

### 2. Who it is for

The person building the schedule — usually a Chief Resident or a program administrator. Everyone else is either someone who *views* the finished schedule, or just a name in the system. Residents themselves do not have accounts; they see the schedule through a shareable link.

### 3. What a Chief Resident does with it, start to finish

You sign up and create your program. The system automatically lays out the year as thirteen four-week blocks. You add your residents, marking each as senior or junior, and enter their vacation dates. You fill in which attending doctor is covering each day, which you can copy from the previous block or set up as a repeating weekly pattern. You choose a few rules. Then you open the calendar for a block and press one button, and MedRota fills in the whole month, trying not to break the rules about how much call anyone can do. You look it over, click any day you want to change, and pick different people from a dropdown. When you are happy, you press Publish, and you get a web link you can send to everyone. They can also download it as a spreadsheet or print it.

### 4. What currently works

- Signing up, logging in, and setting up a program.
- Adding residents and attendings, and building the attending coverage schedule.
- Automatic schedule generation that respects most of the official call limits.
- Editing any day by hand, and those edits stick even if you regenerate.
- Publishing, and the public link, which is well built and safely hides private information.
- Spreadsheet and printable exports.
- The four permission levels, which correctly stop a view-only person from changing anything.
- The calendar on a phone.

### 5. What currently does not work

- **Three of the settings on the rules screen do nothing at all.** You can set a maximum number of calls per resident, save it, see it saved — and the scheduler ignores it completely.
- **Some residents' vacations get ignored.** Depending on how a resident was added, the scheduler may not see their time off and can put them on call while they are away.
- **If you pick the same person for both slots on a day, one of them silently disappears.** There is a warning written for this, but a coding mistake means it can never appear on screen.
- **Hand edits are never checked against any rule.** The rules only apply when the computer generates the schedule. Anything you change afterwards is accepted without question, and nothing tells you if the finished schedule broke a limit.
- **There is no way to ask "is this schedule OK?"** You only find out during generation.
- **Holidays never show up on the calendar**, even though the scheduler skips them — so days go blank with no explanation.
- **Someone in one program can see another program's residents and call counts.** Confirmed during this audit.
- Some pages look broken on a phone, invite links only work on your own computer, and there is a small patch of garbled text on the dashboard.

### 6. How close it is to being useful in real life

**It is already useful to you, today, with care.** If you were scheduling your own program and checking the result yourself before sending it out, this would genuinely save you hours. What it is not ready for is being trusted without that check, or handed to a second program. The gap between "useful to its author" and "safe for someone else" is maybe two to three weeks of focused work — the P0 list.

### 7. The biggest risk

**That you trust it more than it deserves.** Every automated check passes. The documentation says the scheduling rules are implemented. The settings screen saves successfully. All of that is true and none of it means the schedule is correct. The specific danger: you set a call limit, MedRota ignores it, the schedule looks reasonable, and a resident works more call than they should have. Nothing in the system would tell you.

A close second, and far easier to fix: **all your work since May exists only on this one computer.** Forty-one commits have never been pushed. A dead hard drive erases the entire scheduling engine.

### 8. The next three things that should be done

1. **Push your code.** One command, protects six weeks of work. Do it before reading further.
2. **Deal with the three fake settings.** Either make them work or take them off the screen. Right now the app is lying to its user, and that is worse than not having the feature.
3. **Make vacations always reach the scheduler, and warn on hand edits.** These are the two ways MedRota can put a real person on call when it should not — the exact failure the whole product exists to prevent.

---

## 27. Questions That Require Product-Owner Decisions

These cannot be resolved by reading code. Each changes what gets built.

| Question | Why it matters |
|---|---|
| **Which blended-call formula is correct?** The code and your own rules document both say `home + 3×in-house <= 30`. The audit brief says `3×home + 4×in-house <= 30`. | Different weights, different limits. Also worth deciding whether the rule should exist at all — as built it cannot ever bind, because each resident only ever does one type of call. |
| **Should a resident be able to do both home and in-house call?** | Call type is currently derived purely from senior/junior plus a program toggle. If a real resident can do both, the model needs per-assignment call type, and the blended rule becomes meaningful. |
| **Keep or remove `maxCallsPerResident`?** | Keeping it means a program-specific ceiling stricter than PARO. Removing it means PARO is the only authority. Both are defensible; the current state — present but inert — is not. |
| **Should the two weekend settings return?** | The PARO rewrite replaced them with weekends-off and consecutive-home-weekend rules. Decide whether anything was lost or they are genuinely redundant. |
| **What should happen when a manual override breaks a rule?** | Block it, warn and allow, or allow and flag on the published schedule? The docs list this as undecided and it is the central question for P0-6. |
| **Should vacation live on the resident or the block enrollment?** | Per-block is why vacation gets dropped and why data entry is painful. Per-resident date ranges would fix both but is a schema change. |
| **Do residents ever get accounts?** | The single biggest fork in the product. It gates swaps, notifications, personal views, and preference collection — and roughly doubles the scope. |
| **Is MedRota for one program or many?** | The schema supports many; the app supports one; `/programs/mine` returns an arbitrary first membership. Multi-program is a real project, not a fix. |
| **Should self-service program creation stay open?** | Anyone who registers can create an organization and become its admin. Fine for a personal tool, wrong for anything institutional. The dormant `request-access` endpoint suggests you once intended approval. |
| **Should a published schedule be retractable?** | There is currently no unpublish and no token rotation. If a link leaks or a schedule is published in error, there is no remedy. |
| **How are academic days meant to be marked?** | The scheduler matches flag *labels* against the word "academic". Renaming a flag silently disables the rule. A real flag type would fix it but changes the model. |
| **Who is the actual first user?** | If it is you, the P0 list is enough. If it is a colleague at another program, everything in §17 becomes blocking first. |

---

*End of audit. No project source files were modified during this audit; the working tree was verified clean before and after.*
