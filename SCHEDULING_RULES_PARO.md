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
- Blended call load uses `homeCalls + (3 * inHouseCalls) <= 30`.
- Consecutive call dates are disallowed.
- A call immediately before a vacation day is disallowed.
- Vacation-day assignments are disallowed for generated schedules.
- Consecutive home-call weekends are disallowed.
- Residents must retain required complete weekends off where the block contains complete Friday-Saturday-Sunday weekends.
- Academic days are skipped when the block setting says to avoid academic days.
- Manual override assignments are preserved and counted in the resident's call load.

Short blocks below the published PARO table ranges use conservative prorated caps so local QA and partial-block schedules can still generate limited assignments.

## Intentional Non-Behavior

- The generator does not use a solver.
- The generator does not silently relax PARO constraints.
- Auto-generate does not delete manual override assignments.
- Manual overrides can still exist even if they violate a rule; those rows are preserved and surfaced in warnings.

## Validation

Run from `backend`:

```bash
npm run paro:smoke
npm run phase5:smoke
```

Run from `frontend` after calendar, roles, settings, or login changes:

```bash
npm run e2e
```
