# MedRota

MedRota is a single-program residency call-scheduling MVP. It helps a Chief Resident maintain a roster and block availability, generate a PARO-aware draft, make documented exceptions, validate the stored schedule, publish an immutable snapshot, and share or export it.

MedRota provides scheduling assistance; it does not certify legal, contractual, PARO, privacy, or regulatory compliance. It is not PARO certified, PHIPA compliant, HIPAA compliant or production ready. A program must validate current institutional and jurisdictional requirements before real-world use.

Start with **[PRIVATE_BETA_READINESS.md](PRIVATE_BETA_READINESS.md)** for exactly what is and is not supported, what has been verified, and the known risks. **[DEPLOYMENT.md](DEPLOYMENT.md)** covers running it.

## Architecture

- `backend/`: Express 5 API, JWT authentication, permission checks, Prisma 7, PostgreSQL, scheduler/validator, publishing, Excel, and printable HTML.
- `frontend/`: React 19 and Vite application with authenticated program routes plus public `/schedule/:token` routes.
- `backend/prisma/`: schema and additive migrations. Never use a database reset against valued data.

## Local setup

Prerequisites: Node.js, npm, and a local PostgreSQL database.

Install dependencies only when setting up a new checkout:

```bash
cd backend
npm install
cd ../frontend
npm install
```

Copy `backend/.env.example` to `backend/.env` and fill it in. Every variable is documented there. At minimum:

```text
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/medrota?schema=public
JWT_SECRET=replace-with-a-long-local-secret
PORT=3000
```

The server refuses to start without `DATABASE_URL` and `JWT_SECRET`.

Apply existing migrations without resetting data, then start both applications:

```bash
cd backend
npx prisma migrate deploy
npm run dev
```

```bash
cd frontend
npm run dev
```

## Roles

Canonical program roles are `chief_resident`, `program_admin`, `program_director`, and `viewer`. Backend permission checks are authoritative. Chief Residents build schedules; Program Admins and Program Directors can also manage membership and program settings; Viewers have published/read-only access. Program deletion is not part of this MVP.

## Chief Resident workflow

1. **Residents** — add the roster once, then use *Set block availability* to enroll everyone for a block in one click, or copy the previous block's configuration forward. Vacation is entered as date ranges.
2. **Attending Schedule** — build attending coverage from the roster or a weekly template.
3. **Calendar** — the readiness panel above *Generate* shows how many residents have block availability, how many vacation periods are entered, and whether attending coverage is complete, with each gap linking to the fix.
4. **Auto-generate**, then adjust individual days. A violating edit needs explicit confirmation and a reason.
5. **Validate** — every violation says who, what date, what rule, why it matters, what to do about it, and whether it was an intentional override. Unfilled slots list which residents were unavailable and why.
6. **Publish** — validation runs first; an unreviewed non-compliant schedule is never published silently. Share the public link, or unpublish or rotate it later.

## Scheduling behavior

- Auto-generation preserves and counts manual overrides, and is idempotent.
- Residents without explicit `BlockEnrollment` availability are excluded with actionable warnings.
- Vacation, pre-vacation post-call, consecutive call, call maximum, blended-call, weekend-off, and consecutive home-weekend rules are checked.
- Hard conflicts leave slots unassigned; the generator does not silently relax constraints.
- A violating manual edit requires backend-confirmed violations, explicit confirmation, and a non-empty reason.
- `GET /api/schedule/validate?blockId=...` validates the currently stored draft without mutating it, and explains each unfilled slot.
- Candidate tie-breaking rotates by day so no roster position is permanently favoured.

See `SCHEDULING_RULES_PARO.md` for exact implemented rules and limitations, and `SCHEDULER_ACCEPTANCE_AND_FAIRNESS.md` for measured acceptance and fairness results.

## Publishing and exports

Publishing creates an immutable `ScheduleVersion` snapshot and a random public token. Public schedule, Excel, and printable routes use the latest published snapshot and a privacy-shaped response. Authenticated Excel and Print/PDF exports use the current live draft and are labeled `Draft schedule`. “PDF” is printable HTML intended for the browser's Save as PDF workflow, not server-generated PDF bytes.

Publishing validates the stored schedule first. Documented manual overrides are intentional exceptions and never block; any other violation stops the publish and is shown, and an authorized user can then publish with an explicit acknowledgement.

A published schedule can be **unpublished**, which stops the public link resolving while keeping version history and the draft untouched, or given a **new public link**, which invalidates the previous one. Both are confirmed and audited.

## Audit trail

Scheduling and administrative changes are recorded in an append-only `AuditEvent` table: who, what changed, and when. Passwords, hashes, tokens and request bodies are never stored. Program Admins and Directors see the full history in Program Settings; Chief Residents see scheduling history for a block on the Calendar; Viewers see none.

## QA and validation

The local QA seed is development-only and deterministic:

```bash
cd backend
npm run dev:seed-qa
```

Core backend checks:

```bash
npm run roles:audit
npm run roles:smoke
npm run authz:smoke
npm run phase5:smoke
npm run phase5:db
npm run phase6:smoke
npm run paro:smoke
npm run scheduler:integration
npm run scheduler:acceptance
npm run schedule:validate-smoke
npm run data:integrity-smoke
npm run availability:smoke
npm run publish:safety-smoke
npm run publish:revocation-smoke
npm run audit:smoke
npm run deploy:smoke
npx prisma validate --schema prisma/schema.prisma
```

Reporting tools, both read-only:

```bash
npm run data:integrity-audit     # scheduling data integrity; prints no resident names by default
npm run scheduler:fairness       # call distribution and roster-order bias
```

Frontend checks:

```bash
cd frontend
npm run perf:guard
npm run lint
npm run build
npm run e2e
```

Install Chromium once if needed with `npx playwright install chromium`. See `LOCAL_QA.md` for QA identities and the Windows local-server reuse procedure.

Continuous integration runs the same checks on every push and pull request; see `.github/workflows/ci.yml`.

## Program configuration

MedRota keeps two separate program identity fields: **Program display name** is the local name shown throughout the product, while **Primary specialty** is the program's medical specialty/category. Existing `Program.name` and `Program.specialty` data remain unchanged; the update clarifies their labels rather than migrating values.

Program Settings is organised into sections — General, Clinical Structure, Attendings, Scheduling, Access & Permissions, and History — navigated by a side-nav on desktop and a scrolling tab strip on narrow screens. The active section is reflected in a `?tab=` query parameter, so a refresh or a return to the page keeps it.

Two of those sections hold optional program-defined registries: **Clinical services** and **Attending activities**. Neither is populated from a hard-coded specialty tree. Activity types drive weekly attending-pattern selectors, while stored activity text remains on historical schedules after an activity is renamed or deactivated. The persistent attending roster also supports optional email, phone, and office/location; contact details are excluded from public schedule responses.

Deactivating a roster entry, an activity type or a clinical service takes it out of the default list and out of the selectors used to build new schedules, without deleting it or the history that references it. Each list shows how many active records it holds and, only when there are any, a `Show inactive (n)` disclosure that reveals the deactivated records with a Restore action.

The canonical roles remain Program Admin, Program Director, Chief Resident, and Viewer. Admins and Directors always resolve to full program-management access, and Viewers always remain read-only. Admins and Directors may configure a bounded canonical set of Chief Resident operational permissions. `manage_scheduling_rules` is included for the future rule builder, but this release does not add that builder.

## Current limitations

- MVP scope is one active program per user experience, although backend resources are program-isolated.
- Generation is greedy, not optimal. Roster order can still shift a small number of calls between individuals.
- Only vacation is modeled as a reliable days-on-service deduction.
- Academic days are recognized by a centralized case-insensitive `academic` label convention on flags.
- Multi-month averaging, shift-work rules, emergency coverage, formal exception approval, swaps, notifications, and server-generated PDFs are deferred.
- The Vite build reports a main-chunk warning above 500 kB; optimize only after measurement or a deployment requirement.
