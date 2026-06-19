# Phase 5 Scheduling QA

Status: closed after mock-backed regression audit and real local DB persistence check.

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
- Duplicate diagnostics route wiring exists.
- Publish success UI is wired to `publishedAt` and `versionId`.

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

Phase 5 is closed and ready for Phase 6 planning.

Frontend motion performance note:

- Calendar lag root cause: each day cell used Framer Motion mount, stagger, hover translate, tap scale, and animated box-shadow across the full calendar grid.
- Primary fix: `383e353 Improve frontend motion performance`.
- Follow-up pass: remaining dashboard/resident page motion was shortened, repeated resident row mount animations were removed, and modal backdrops/shadows were lightened.
- Remaining risk: some low-frequency admin/setup/public pages still use decorative Framer Motion transitions, but the main scheduling interactions now avoid the heavy repeated animation patterns.
