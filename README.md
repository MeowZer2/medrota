# MedRota

MedRota is a single-program residency call-scheduling MVP. It helps a Chief Resident maintain a roster and block availability, generate a PARO-aware draft, make documented exceptions, validate the stored schedule, publish an immutable snapshot, and share or export it.

MedRota provides scheduling assistance; it does not certify legal, contractual, PARO, privacy, or regulatory compliance. A program must validate current institutional and jurisdictional requirements before real-world use.

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

Create `backend/.env` with at least:

```text
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/medrota
JWT_SECRET=replace-with-a-long-local-secret
PORT=3000
```

Optional server configuration:

```text
APP_BASE_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

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

## Scheduling behavior

- Auto-generation preserves and counts manual overrides.
- Residents without explicit `BlockEnrollment` availability are excluded with actionable warnings.
- Vacation, pre-vacation post-call, consecutive call, call maximum, blended-call, weekend-off, and consecutive home-weekend rules are checked.
- Hard conflicts leave slots unassigned; the generator does not silently relax constraints.
- A violating manual edit requires backend-confirmed violations, explicit confirmation, and a non-empty reason.
- `GET /api/schedule/validate?blockId=...` validates the currently stored draft without mutating it.

See `SCHEDULING_RULES_PARO.md` for exact implemented rules and limitations.

## Publishing and exports

Publishing creates an immutable `ScheduleVersion` snapshot and a random public token. Public schedule, Excel, and printable routes use the latest published snapshot and a privacy-shaped response. Authenticated Excel and Print/PDF exports use the current live draft and are labeled `Draft schedule`. “PDF” is printable HTML intended for the browser's Save as PDF workflow, not server-generated PDF bytes.

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
npm run schedule:validate-smoke
npx prisma validate --schema prisma/schema.prisma
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

## Current limitations

- MVP scope is one active program per user experience, although backend resources are program-isolated.
- Only vacation is modeled as a reliable days-on-service deduction.
- Academic days are recognized by a centralized case-insensitive `academic` label convention on flags.
- Multi-month averaging, shift-work rules, emergency coverage, formal exception approval, swaps, notifications, and server-generated PDFs are deferred.
- The Vite build reports a main-chunk warning above 500 kB; optimize only after measurement or a deployment requirement.
