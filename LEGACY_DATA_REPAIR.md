# Legacy Duplicate Role-Slot Repair

Record of the one-time repair that made `UNIQUE(callDayId, roleOnDay)` safe to
enforce. Resident names are deliberately omitted; rows are identified by role.

## What was found

The P0 recovery migration reported **5 duplicate `(callDayId, roleOnDay)` groups
covering 10 rows** and intentionally did not add the role-slot uniqueness
constraint until they were understood.

All 5 groups shared one signature:

| Property | Value |
|---|---|
| Program | 1 program, 1 block (Block 3, 2026-08-26 to 2026-09-22) |
| Role | `junior` in every case |
| Dates | 2026-08-25, 08-27, 08-29, 08-31, 09-02 |
| Overrides | none — every row was `isOverride = false` with no reason |
| Published | block was **not** published; **0** `ScheduleVersion` snapshots |
| Snapshot dependency | none, so no shared link or export could change |

## Why one row in each pair was clearly stale

Ordering every assignment in the block by `createdAt` showed a single sequential
generator run walking the dates in order and writing senior-then-junior per day,
from `…42.493Z` to `…42.540Z`. **After that run finished**, five more rows were
appended in a 2 ms window (`…42.541Z` – `…42.543Z`) — all for the *same person*,
and that person is a **medical student** (`isMedStudent = true`,
`pgyLevel = "Medical Student"`).

That is the legacy form of the scheduler's second pass. The current scheduler
guards it explicitly (`services/scheduler.js`):

```js
if (!info.hasSenior || info.hasJunior) continue;   // med student only when junior coverage is empty
```

The five surplus rows are exactly the case this guard now prevents: a medical
student appended to a day that already had a junior resident. The rows could not
be created by today's code.

A second consequence made the duplicates actively dangerous rather than merely
untidy: the calendar builds a date-keyed map where the junior slot is
last-write-wins, so a Chief Resident only ever saw **one** of the two rows, with
no indication the other existed, and a day save would silently drop the hidden
one.

## Rule applied

`med-student-surplus`, implemented in `backend/services/dataIntegrity.js`:

> In a duplicate `(callDayId, 'junior')` group where no row is a manual override,
> exactly one row belongs to a medical student, and exactly one belongs to a
> junior resident eligible for the slot, the medical-student row is a legacy
> second-pass duplicate and the junior-resident row is authoritative.

Three other deterministic rules exist and were not needed here, in precedence
order: `override-precedence` (a documented manual override beats a generated
row), `ineligible-surplus` (a resident who could not fill the slot today), and
`published-snapshot-corroborated` (the latest snapshot names exactly one of the
residents). Anything else is classified `ambiguous` and is never touched — most
importantly, **two conflicting manual overrides in one slot are always left for
the owner to decide.**

## What was done

```text
before   78 CallAssignment rows, 5 duplicate groups
after    73 CallAssignment rows, 0 duplicate groups
```

* All 5 removed rows were archived in full to
  `backend/data-repair-archive/duplicate-role-slots-<timestamp>.json` before
  deletion. That directory is gitignored because it contains resident names.
* Deletion ran in one transaction that re-read the target rows inside the
  transaction and asserted each repaired group ended with exactly one row,
  rolling back otherwise.
* No senior slot, no manual override, and no published snapshot was touched.

## Tools

```bash
npm run data:integrity-audit                # read-only, no names printed
npm run data:integrity-audit -- --names     # include resident names
npm run data:integrity-audit -- --json      # machine-readable
npm run data:integrity-audit -- --strict    # exit 1 when findings exist

npm run data:integrity-repair               # plan only, never writes
MEDROTA_CONFIRM_REPAIR=yes npm run data:integrity-repair   # apply

npm run data:integrity-smoke                # behavioral regression tests
```

The audit also reports cross-program assignments, residents ineligible for their
assigned slot, the same resident in both slots, assignments without block
availability, call days outside their block range, and published blocks with no
snapshot.

## Constraint added

`prisma/migrations/20260820000000_unique_call_assignment_role_slot`

The migration begins with a `DO $$` guard that counts remaining duplicates and
raises an actionable message naming the audit and repair commands, so a database
that still carries unresolved duplicates fails with an explanation instead of a
bare unique-violation. Verified on a scratch database: with a duplicate present
the guard fires and nothing is created; after repair the same migration applies
and the index rejects the duplicate insert.

`UNIQUE(callDayId, residentId)` remains in place, so one resident still cannot
occupy both slots on a day. The two constraints are compatible and both are
covered by `npm run data:integrity-smoke`.

## Known legacy findings left in place

These are reported by the audit and deliberately **not** auto-repaired, because
fixing them would mean deleting or moving real schedule rows:

| Finding | Count | Why it is left alone |
|---|---|---|
| Assignments without block availability | 18 | Written before explicit enrollment was required. Deleting them would erase a real schedule; Phase 4's readiness check prevents new occurrences. |
| Call day outside its block range | 1 | 2026-08-25 sits one day before Block 3 starts, a legacy date-basis artifact. Moving it would silently change who is on call. |
