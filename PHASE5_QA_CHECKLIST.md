# Phase 5 Scheduling QA

Status: closed. The original mock-backed contract checks remain, with real database scheduler and validator coverage added during the reliability recovery.

Automated smoke check:

```powershell
cd backend
npm run phase5:smoke
```

This mock-backed smoke check does not touch the database. It validates:

- Manual overrides seed scheduler state and count toward call totals.
- Auto-generate does not add assignments to an override-covered day.
- Generated assignments are not marked as overrides.
- Clear schedule deletes generated assignments only and deletes only empty CallDays.
- `maxCallsPerResident`, `maxCallsMedStudent`, and academic-day avoidance are exercised.
- Generation summary includes warnings and `unassignedDates`.

The former source-string assertions for diagnostics route wiring and publish modal props were removed; they were not behavioral evidence.

Real local DB persistence check:

```powershell
cd backend
npm run phase5:db
```

This check uses the existing Prisma client and the configured local PostgreSQL database. It creates one isolated organization named with the `MedRota PHASE5_DB_` prefix, verifies Phase 5 persistence behavior with fresh database reads, and removes its own test organization when complete.

The DB-backed check validates:

- Manual override assignments persist after fresh Prisma reads.
- Auto-generate preserves manual overrides.
- Clear schedule preserves overrides and removes generated assignments.
- Block settings persist after update and reload.
- Published block state, public token, and schedule version persist.
- `maxCallsPerResident`, `maxCallsMedStudent`, and academic-day avoidance affect generation.
- Generated assignments do not duplicate residents or create multiple juniors on a day.

Latest closeout checks:

- `cd backend && npm run phase5:smoke`: passed.
- `cd backend && node --check scripts/phase5-db-persistence.js`: passed.
- `cd backend && npm run phase5:db`: passed.
- `cd backend && npm run scheduler:integration`: exercises the real generator and database.
- `cd backend && npm run schedule:validate-smoke`: exercises validator behavior directly.

Phase 5 is closed and ready for Phase 6 planning.

Frontend motion performance note:

- Calendar lag root cause: each day cell used Framer Motion mount, stagger, hover translate, tap scale, and animated box-shadow across the full calendar grid.
- Primary fix: `383e353 Improve frontend motion performance`.
- Follow-up pass: remaining dashboard/resident page motion was shortened, repeated resident row mount animations were removed, and modal backdrops/shadows were lightened.
- Remaining risk: some low-frequency admin/setup/public pages still use decorative Framer Motion transitions, but the main scheduling interactions now avoid the heavy repeated animation patterns.

Calendar day data note:

- Calendar cells and the day edit modal must derive assignments, attending entries, and flags from the same normalized `YYYY-MM-DD` day data object.
- Backend date strings should be normalized by preserving their leading date key instead of round-tripping through local `Date` parsing, which can shift UTC-midnight values by one day in non-UTC time zones.
