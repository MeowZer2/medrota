# MedRota Progress Review

## Current Project Status

Reliable single-program private-beta candidate, pending real-program rule review
and a first supervised deployment. The P0 recovery sprint closed the audited
program-isolation, transactional calendar-save, silent override, missing
availability, blended-call, misleading settings, weak data-integrity and
frontend auth gaps. The integration and readiness sprint that followed resolved
the legacy data those constraints were waiting on, built acceptance and fairness
harnesses, and added the audit trail, revocation controls, responsive and
accessibility baselines, and deployment preparation.

This is not a claim of PARO, privacy or production compliance. See
`PRIVATE_BETA_READINESS.md` for the full statement of scope, verification and
risk.

## Confirmed Working Behavior

* Canonical roles: `chief_resident`, `program_admin`, `program_director`,
  `viewer`; backend permissions are authoritative and tested by direct API call.
* Cross-program stats, attending copy/template, resident/block, membership,
  audit and schedule-history paths enforce resource ownership and permissions.
* Day assignment updates are transactional and reject duplicate residents or
  invalid roles without destroying prior assignments.
* Violating manual edits require a fresh backend check, explicit confirmation
  and a non-empty reason; recorded overrides are preserved and counted during
  regeneration.
* Auto-generation excludes residents with missing block availability, preserves
  overrides, honours supported local caps, leaves unfillable slots unassigned,
  and is **idempotent**.
* The blended formula is `(home * 3) + (in-house * 4) <= 30`.
* Validation reports stable machine-readable codes **and** a plain-language
  rule, why it matters, what to do, and whether it was an intentional override.
  Unfilled slots list each rejected candidate and the rule that rejected them.
* Publishing validates first: documented overrides never block, anything else
  stops the publish until an authorised user acknowledges it.
* Publishing creates immutable versions; a published schedule can be unpublished
  or given a new public link, both confirmed and audited.
* An append-only `AuditEvent` trail records scheduling and administrative
  mutations, with secrets and tokens stripped and role-scoped visibility.
* Block availability can be set in bulk or copied forward, and a readiness panel
  reports what is missing **before** generation.
* Registration asks only for name, email and password, signs the user in, and
  takes its role from the invitation.

## Supported Settings

* Program: junior and senior in-house-call toggles.
* Block: `avoidAcademicDays`, `allowAttendingOnlyDays`, `maxCallsMedStudent`,
  and positive `maxCallsPerResident` as a stricter local ceiling.
* Deprecated database-only columns: `allowWeekendConsecutive`,
  `limitWeekendCalls` on `BlockSettings`; `category`, `clinicalIdentity`,
  `desiredRole`, `homeSpecialty` on `User`.

## Behavioral Protection

Seventeen backend suites and 39 Playwright tests. The full matrix is in
`PRIVATE_BETA_READINESS.md` §7. The ones that earn their keep:

* `authz:smoke` — real HTTP and database isolation, role, auth, invite,
  registration, transactional assignment, override and history privacy.
* `scheduler:acceptance` — five realistic anonymized scenarios asking whether the
  output is acceptable, not merely whether helpers work.
* `scheduler:integration` — generator and database behaviour including
  idempotency.
* `publish:safety-smoke` / `publish:revocation-smoke` — the publish gate, and
  unpublish and link rotation with the token never reaching the audit trail.
* `audit:smoke` — recording, redaction at every depth, role visibility, and that
  a rolled-back mutation leaves no audit row.
* `data:integrity-smoke` — role-slot uniqueness and the repair classification
  rules.
* `responsive.spec.js` / `accessibility.spec.js` — no page scrolls sideways at
  four viewports, every dialog is a labelled modal that closes on Escape, and
  the major workflows are keyboard-operable.

## Resolved Since the Recovery Sprint

* **Legacy duplicate role slots.** All five groups were one signature: a medical
  student appended to a junior slot that already held a junior, by a trailing
  second pass of the old generator. Repaired transactionally with the removed
  rows archived, and `UNIQUE(callDayId, roleOnDay)` is now enforced behind a
  guard that stops any deployment still carrying duplicates.
  See `LEGACY_DATA_REPAIR.md`.
* **Generator idempotency.** `generateSchedule` counted only overrides as
  filling a slot, so a second call wrote another resident into a filled slot —
  the same corruption Phase 1 had to repair. Found by the acceptance harness.
* **Systematic roster-order bias.** Ties were broken on raw roster index, so the
  same position received extra call in every ordering. Tie-breaking now rotates
  by day within each role pool; coverage rose from 43 to 47 of 48 slots and the
  early-entry advantage fell from −0.775 to −0.135.
  See `SCHEDULER_ACCEPTANCE_AND_FAIRNESS.md`.
* **Attending Schedule horizontal overflow** at phone and tablet widths.
* **The calendar day editor had no dialog role at all**, plus two focus-restore
  bugs found while fixing it.
* **Public links could never be revoked.**
* **No audit trail.**
* **Unused registration metadata**, including a self-declared `desiredRole`.

## Known Warnings and Remaining Risks

* Greedy generation remains order-sensitive: roster order can still move up to 2
  calls between individuals. Removing this needs a solver, deliberately out of
  scope.
* The PARO interpretation has not been reviewed by PARO, a program director, or
  anyone with authority to confirm it.
* No session revocation and no password reset. A leaked token is valid until it
  expires; a locked-out user needs an operator with database access.
* 18 legacy assignments have no block availability record, and one legacy call
  day sits one day outside its block. Both are reported by
  `npm run data:integrity-audit` and deliberately not auto-repaired, because
  either fix would silently change a real schedule.
* No real program has used MedRota. No backup restore has been drilled against
  real data. No penetration test or independent accessibility audit.
* The Vite main bundle is ~625 kB minified (~182 kB gzipped) and trips the
  500 kB warning; no measured problem.
* On Windows, Playwright-owned server teardown can hang after tests pass;
  `LOCAL_QA.md` documents the verified server-reuse run.
* Only vacation is a reliable days-on-service deduction. Academic flags use a
  label convention; other time away, multi-month averaging, shift work,
  emergency clauses and formal approvals remain unsupported.
* "Print / PDF" is printable HTML for browser Save-as-PDF.

## Next Priorities

1. Run a real anonymized program block through the generator and validator with
   a Chief Resident, and reconcile the PARO interpretation against the current
   agreement.
2. Configure backups and **complete one restore drill** before any real schedule
   is entered.
3. Deploy to a single supervised private-beta environment with TLS, managed
   secrets and monitoring, keeping the program's previous method as a fallback.
4. Add session revocation and a password-reset path, the two gaps most likely to
   need an operator during a beta.
5. Review the generated call distribution with the program and decide whether
   the residual greedy variance is acceptable or justifies a solver.
