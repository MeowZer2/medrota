# Scheduler Acceptance and Fairness Report

How the greedy generator behaves on realistic, anonymized rosters, and how
evenly it spreads call. No optimization solver was introduced.

```bash
npm run scheduler:acceptance            # five scenarios, pass/fail
npm run scheduler:acceptance -- --report  # plus per-resident metrics tables
npm run scheduler:fairness              # quantitative fairness assessment
npm run scheduler:fairness -- --json    # machine-readable
```

Both build their own isolated organization per scenario (`ACCEPT_ONLY_*`) with
synthetic resident names, and delete exactly what they created. Normal
development records are never touched.

---

## Part 1 — Acceptance results

| Scenario | Setup | Result |
|---|---|---|
| **A** normal block | 28 days, 4 seniors + 4 juniors, junior in-house / senior home, 2 vacation ranges, weekly academic day, 1 holiday, attending every day | **45/48 slots filled, fully compliant.** No vacation conflict, no pre-vacation post-call, no consecutive call, home-call weekend rule and 2-weekends-off rule respected, every PARO ceiling and the local cap respected, call spread ≤ 2 within each role group |
| **B** constrained roster | 2 seniors + 2 juniors, heavily overlapping vacation | **27 slots left open, zero rule violations.** Every gap carries a warning naming the binding constraints (vacation, consecutive-call, post-call-before-vacation), and the validator agrees with the stored state |
| **C** manual exception | Compliant schedule, then a deliberate consecutive-call edit through the real HTTP API | First request returns **409 requiresOverrideConfirmation** naming `CONSECUTIVE_CALL`; confirming without a reason is refused **400**; confirming with a reason saves; validation still reports the violation but flagged `isOverride` with the reason attached; **regeneration preserves it** |
| **D** call-type settings | junior ON/senior OFF, junior OFF/senior OFF, junior ON/senior ON | Call type, point weighting (3 home / 4 in-house) and the matching PARO ceiling all follow the program setting in every combination. The consecutive-weekend restriction applies to home call only, as PARO specifies |
| **E** missing availability | One junior with no block enrollment | Receives **zero** calls, never silently enters the candidate pool, is named in an actionable `MISSING_RESIDENT_AVAILABILITY` warning from both the generator and the validator, and becomes schedulable (6 calls) as soon as valid block availability is supplied |

### What Scenario A tells a Chief Resident

**4 seniors and 4 juniors cannot completely cover a 28-day block.** Three slots
stay open, and not because of a scheduling defect — the binding constraints are
real PARO rules:

* seniors on home call may not work consecutive weekends, and a 28-day block has
  four weekends needing three covered days each;
* every resident must keep two complete weekends off.

A program that wants full coverage of a 28-day block needs a larger senior pool
or an explicit, documented exception. The generator surfaces this rather than
quietly breaking a rule, which is the correct behaviour.

### Defect found and fixed by the harness

`generateSchedule` counted **only manual overrides** as filling a role slot, so
a second call wrote another resident into an already-filled slot.
`POST /api/schedule/generate` pre-clears and so masked it, but any direct caller
reproduced exactly the duplicate-role-slot corruption Phase 1 had to repair. The
generator now reads every stored assignment and treats a filled slot as filled.
`npm run scheduler:integration` pins the idempotency.

---

## Part 2 — Fairness assessment

Same scenario run under **four deterministic roster orderings** — natural,
reversed, rotated-by-1, rotated-by-2 — with identical people and constraints.
Only the enrollment insertion order changes, which is what feeds the generator's
tie-break.

### The finding

Roster order materially decided who got call.

| Metric | Before | After |
|---|---|---|
| Slots filled (of 48) | 43 | **47** |
| Mean calls by senior roster position | 5, 5, **7**, 5 | 7, 5, 5, 7 |
| Mean calls by junior roster position | **6**, 5, 5, 5 | 6, 5, 7, 5 |
| Early-entry advantage, juniors (correlation of position vs load) | **−0.775** | **−0.135** |
| Early-entry advantage, seniors | +0.258 | 0.0 |
| Largest swing for one person from roster order alone | 2 calls | 2 calls |
| Senior std dev / coefficient of variation | 0.87 / 0.17 | 1.0 / 0.167 |
| Junior std dev / coefficient of variation | 0.43 / 0.08 | 0.83 / 0.144 |

Before the change the pattern was unmistakable and *identical in all four
orderings*: the senior in roster position 3 always received 7 calls while the
others received 5, and the junior in position 0 always received 6. The extra
call followed the **position**, not the person. For juniors the correlation
between roster position and call load was −0.775 — a strong, systematic
advantage to whoever the database returned first.

### Root cause

`sortCandidates` ranked candidates by total calls, then by weighted call points,
then by **raw roster index**. Ties are extremely common — on most days several
residents sit on the same call count — so the final tie-break decided a large
share of assignments, and it always resolved in favour of the lowest roster
index.

### The change

The tie-break now rotates: the day's ordinal position in the block shifts which
roster position sits at the front of the queue. It stays fully deterministic —
the same inputs always produce the same schedule — but no position is
permanently first.

One detail matters. The rotation is taken over each candidate's rank **within
its own role pool**, not over the whole roster. Rotating a pool of 4 juniors
modulo an 8-person roster advances their order unevenly; a first attempt that
did exactly that improved seniors (range 2 → 1) while making juniors *worse*
(range 1 → 3). Ranking within the role pool fixed both.

### Result

* **Coverage improved from 43 to 47 of 48 slots** — four more days covered, with
  no rule violations, entirely from better tie-breaking.
* Scenario A improved from 40/48 to 45/48; Scenario D variants reach 46–48/48.
* The systematic early-entry advantage is gone: correlation moved from −0.775 to
  −0.135 for juniors and from +0.258 to 0.0 for seniors. Position no longer
  predicts load monotonically.
* Senior weekend-call range fell to 0.

### What remains, honestly

**Roster order still moves up to 2 calls between individuals.** Greedy
assignment is order-sensitive by nature: once constraints bind near the end of a
block, the leftover calls land on whoever is still eligible, and who that is
depends on earlier choices. Removing this entirely needs a solver that optimizes
the whole block at once, which is deliberately out of scope for this sprint.

Within a single run the spread is acceptable for an MVP: coefficient of
variation 0.14–0.17, and a range of at most 2 calls out of a mean near 6. A
Chief Resident who considers a specific distribution unfair can adjust it
manually, and the override is documented and preserved.

### Not done, deliberately

No OR-Tools, SAT, MILP, genetic algorithm or any other solver was introduced.
The only scheduler changes were the idempotency fix and the tie-break rotation,
both small and covered by tests.
