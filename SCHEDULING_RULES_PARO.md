# PARO Scheduling Rules

MedRota auto-generation now treats PARO call limits as hard eligibility rules. If the available resident pool cannot satisfy a date, the scheduler leaves the role/date unassigned and returns a warning instead of forcing a fallback assignment.

## Program Call-Type Settings

Program Settings includes two toggles:

- Junior in-house call: junior resident and medical student call assignments count as in-house call for PARO maximums.
- Senior in-house call: senior resident call assignments count as in-house call for PARO maximums.

Defaults:

- Junior in-house call: on.
- Senior in-house call: off.

Only Program Admins and Program Directors can edit these settings.

## Implemented Scheduler Rules

- In-house call maximums are based on days on service:
  - 19-22 days: 5 calls.
  - 23-26 days: 6 calls.
  - 27-29 days: 7 calls.
  - 30-34 days: 8 calls.
  - 35-38 days: 9 calls.
- Home call maximums are based on days on service:
  - 17-19 days: 6 calls.
  - 20-22 days: 7 calls.
  - 23-25 days: 8 calls.
  - 26-28 days: 9 calls.
  - 29-30 days: 10 calls.
- Blended call load uses `(homeCalls * 3) + (inHouseCalls * 4) <= 30`.
- Consecutive call dates are disallowed.
- A call immediately before a vacation day is disallowed.
- Vacation-day assignments are disallowed for generated schedules.
- Consecutive home-call weekends are disallowed.
- Residents must retain required complete weekends off where the block contains complete Friday-Saturday-Sunday weekends.
- Academic days are skipped when the block setting says to avoid academic days.
- Manual override assignments are preserved and counted in the resident's call load.
- Active service residents without an explicit BlockEnrollment are excluded from generation and reported as incomplete availability.
- A positive `maxCallsPerResident` is an optional local ceiling; the effective limit is the stricter of it and the applicable PARO-derived maximum.
- `maxCallsMedStudent`, `avoidAcademicDays`, and `allowAttendingOnlyDays` remain supported. Legacy `allowWeekendConsecutive` and `limitWeekendCalls` columns are deprecated and no longer exposed or accepted as supported settings.

Short blocks below the published PARO table ranges use conservative prorated caps so local QA and partial-block schedules can still generate limited assignments.

## Intentional Non-Behavior

- The generator does not use a solver.
- The generator does not silently relax PARO constraints.
- Auto-generate does not delete manual override assignments.
- Manual overrides can still exist even if they violate a rule; those rows are preserved and surfaced in warnings.
- A new violating manual edit is not written on the first request. It requires explicit confirmation and a non-empty stored reason.

## Stored Schedule Validation

`GET /api/schedule/validate?blockId=...` validates the current stored draft without mutation. It reports stable codes for vacation, pre-vacation post-call, consecutive call, in-house/home/blended/local maximums, complete weekends off, consecutive home weekends, duplicate slots, and missing availability. The Calendar exposes the same validator and links dated violations back to the day editor.

Only vacation currently reduces days on service. Academic flags affect day eligibility when enabled but are not modeled as general time-away. Multi-month averaging, shift work, emergency coverage, and formal exception approval remain deferred.

## Validation

Run from `backend`:

```bash
npm run paro:smoke
npm run phase5:smoke
npm run scheduler:integration
npm run schedule:validate-smoke
```

Run from `frontend` after calendar, roles, settings, or login changes:

```bash
npm run e2e
```
