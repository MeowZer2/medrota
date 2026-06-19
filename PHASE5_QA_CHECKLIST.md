# Phase 5 Scheduling QA

Status: passed regression audit after commit `4230e68`.

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

Manual persistence spot-checks:

- Create a manual assignment, reload, and confirm `isOverride` remains persisted.
- Run auto-generate and confirm the manual override remains.
- Clear generated schedule and confirm manual overrides remain.
- Save block settings, restart backend, reload the block, and confirm settings persist.
- Publish a schedule, restart backend, reload the block, and confirm published status persists.
- Call `GET /api/schedule/diagnostics?blockId=<blockId>` on a test block with known duplicates and confirm duplicate groups are reported without mutations.

Phase 5 is ready to close if these spot-checks pass against a local test database.
