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
- Candidate selection compares total calls, then weighted call points, then a
  tie-break that **rotates by the day's position in the block** within each role
  pool, so no roster position is permanently favoured. Generation stays fully
  deterministic: the same inputs always produce the same schedule.
- Generation is idempotent. Running it again without clearing changes nothing.
- Active service residents without an explicit BlockEnrollment are excluded from generation and reported as incomplete availability.
- A positive `maxCallsPerResident` is an optional local ceiling; the effective limit is the stricter of it and the applicable PARO-derived maximum.
- `maxCallsMedStudent`, `avoidAcademicDays`, and `allowAttendingOnlyDays` remain supported. Legacy `allowWeekendConsecutive` and `limitWeekendCalls` columns are deprecated and no longer exposed or accepted as supported settings.

Short blocks below the published PARO table ranges use conservative prorated caps so local QA and partial-block schedules can still generate limited assignments.

## Intentional Non-Behavior

- The generator does not use a solver. It is greedy, and therefore not optimal:
  roster order can still shift a small number of calls between individuals. See
  `SCHEDULER_ACCEPTANCE_AND_FAIRNESS.md` for the measured effect.
- The generator does not silently relax PARO constraints.
- Auto-generate does not delete manual override assignments.
- Manual overrides can still exist even if they violate a rule; those rows are preserved and surfaced in warnings.
- A new violating manual edit is not written on the first request. It requires explicit confirmation and a non-empty stored reason.

## Stored Schedule Validation

`GET /api/schedule/validate?blockId=...` validates the current stored draft without mutation. It reports stable codes for vacation, pre-vacation post-call, consecutive call, in-house/home/blended/local maximums, complete weekends off, consecutive home weekends, duplicate slots, and missing availability. The Calendar exposes the same validator and links dated violations back to the day editor.

Alongside each code the response carries a plain-language `rule`, `why` it is a
problem and a suggested `remedy`, plus whether the violation is a documented
manual override and the reason recorded for it. The codes themselves are
unchanged and remain the machine-readable contract.

The response also includes `unfilledSlots`: for every uncovered senior or junior
slot on a day that should have been covered, the residents who were considered
and the rule that rejected each one. Those reasons come from the same
`services/eligibility.js` evaluator the generator uses, so the explanation is
the rule that actually rejected the candidate rather than a re-derivation.

Publishing runs this validation first. Documented manual overrides are
intentional exceptions and never block. Any other violation stops the publish
and is returned with its explanation; an authorised user may then publish with
an explicit acknowledgement, which is recorded in the audit trail.

Only vacation currently reduces days on service. Academic flags affect day eligibility when enabled but are not modeled as general time-away. Multi-month averaging, shift work, emergency coverage, and formal exception approval remain deferred.

## Validation

Run from `backend`:

```bash
npm run paro:smoke
npm run phase5:smoke
npm run scheduler:integration
npm run scheduler:acceptance
npm run schedule:validate-smoke
npm run publish:safety-smoke
```

Read-only fairness report:

```bash
npm run scheduler:fairness
```

Run from `frontend` after calendar, roles, settings, or login changes:

```bash
npm run e2e
```
