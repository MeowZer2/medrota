# MedRota Private-Beta Readiness

An honest account of what MedRota does, what it does not do, what has been
verified and how, and what could still go wrong. Written for whoever has to
decide whether to put a real program's call schedule into it.

**MedRota is not certified, accredited or independently assessed against any
standard.** It is not PARO certified, not PHIPA compliant, not HIPAA compliant
and not production ready. It provides scheduling assistance. A program must
confirm its own institutional and jurisdictional requirements before real use.

---

## 1. Supported scope

MedRota is a **single-program residency call-scheduling MVP for Chief
Residents**. One program's schedule, one block at a time.

| Capability | State |
|---|---|
| Program Resident Directory plus explicit per-block roster | Supported |
| In-service auto-participation within training dates; reusable off-service/student records | Supported |
| Calculated PGY and configurable junior/senior mapping with legacy fallback | Supported |
| Per-block vacation, other unavailable dates and recurring academic time | Supported |
| Days-on-service and authoritative call-limit summary | Supported |
| Bulk "set block availability" and copy-forward from an earlier block | Supported |
| Attending coverage per day, from a roster or a weekly template | Supported |
| PARO-aware auto-generation of resident call | Supported |
| Manual assignment with confirmed, documented overrides | Supported |
| Validation of the stored schedule with plain-language explanations | Supported |
| Pre-generation readiness check | Supported |
| Publish an immutable snapshot behind a random public link | Supported |
| Unpublish and rotate the public link | Supported |
| Excel and printable-HTML export, draft and published | Supported |
| Append-only audit trail of scheduling and administrative changes | Supported |
| Four roles: Chief Resident, Program Admin, Program Director, Viewer | Supported |

## 2. Explicitly unsupported

Not partially built — absent, and it will be obvious.

* **Multiple concurrent programs per user.** The backend isolates programs and
  enforces it, but the interface assumes one.
* **Any optimizing solver.** Generation is greedy; see §5.
* **Shift work, night float, multi-month averaging, emergency-coverage
  clauses.** None are modeled.
* **Partial-day call semantics.** Full-day recurring academic time can be a hard
  avoid, but AM/PM entries are warnings because resident call is modeled at
  whole-day granularity. MedRota does not invent a clinical half-day rule.
* **Swaps, requests, or a formal exception-approval workflow.** An override is
  recorded by whoever makes it; nobody countersigns.
* **Notifications.** No email, no reminders. Invite links are generated in the
  UI and shared by hand.
* **Server-generated PDF.** "Print / PDF" is printable HTML for the browser's
  Save-as-PDF.
* **Program deletion**, resident merge, or bulk import.
* **Password reset, email verification, MFA, or session revocation.**
* **Undo, or restoring a previous published version into the draft.**

## 3. Real-world validation status

**No real program has used MedRota, and no real schedule has been checked
against it by a Chief Resident.** That is the single largest gap.

What has been done instead is an acceptance harness that builds realistic
anonymized rosters and asks whether the output resembles something acceptable.
See `SCHEDULER_ACCEPTANCE_AND_FAIRNESS.md`.

| Scenario | Result |
|---|---|
| Normal 28-day block, 4 seniors + 4 juniors, vacations, weekly academic day, holiday | 45/48 slots filled, fully compliant |
| Under-staffed roster with overlapping vacation | Gaps left, **zero** rule violations, every gap explained |
| Deliberate manual exception via the real API | Confirmation required, reason enforced, override survives regeneration |
| All three junior/senior in-house call combinations | Call type, weighting and ceilings all follow the setting |
| Resident with no block availability | Excluded, named in an actionable warning, schedulable once availability exists |

A finding worth stating plainly: **4 seniors and 4 juniors cannot fully cover a
28-day block.** Three slots stay open, blocked by the consecutive-home-call-
weekend rule and the two-weekends-off requirement. That is the rules working,
not a defect, but a program with that roster size will need a larger senior pool
or a documented exception.

**The PARO interpretation encoded here has not been reviewed by PARO, by a
program director, or by anyone with authority to confirm it.** The numeric
tables and rules in `SCHEDULING_RULES_PARO.md` are a good-faith reading. Confirm
them against your current agreement before relying on them.

## 4. Security assumptions

What is in place:

* bcrypt password hashing, 10-character minimum.
* HS256 JWT, 7-day expiry, verified per request; the server refuses to boot
  without `JWT_SECRET`.
* Role permissions enforced **server-side** on every mutating route. The UI
  hides controls, but the API is the authority, and tests assert this by making
  the request directly.
* Program isolation on every resource path, covered by `authz:smoke`.
* Rate limiting on login and registration.
* Helmet security headers with a restrictive CSP, and a 256kb JSON body limit.
* Public schedule responses are built by an allowlist that reconstructs each
  object, so resident IDs, emails, override flags and reasons cannot leak.
* Public tokens are unguessable, and can now be revoked and rotated.
* The audit trail strips passwords, hashes, JWTs, authorization headers and both
  public and invite tokens before writing.

What is assumed, and is **your** responsibility:

* **TLS is terminated in front of MedRota.** It does not terminate TLS.
* The database is on a private network with a least-privilege user.
* Secrets come from a real secret store, not a checked-in file.
* The host is patched and access-controlled.

Known weaknesses, accepted for a private beta:

* Tokens live in `localStorage`, readable by any injected script. A successful
  XSS is a session compromise. The CSP mitigates the API side only.
* **No session revocation.** A leaked token is valid until it expires. Changing
  `JWT_SECRET` is the only way to invalidate everything, and it signs everyone
  out.
* No password reset. A locked-out user needs an operator with database access.
* No MFA, no email verification, no penetration test, no dependency-vulnerability
  gate in CI.
* Rate limiting is in-process, so it resets on restart and is per-instance.

## 5. Known risks

### P1

**Greedy generation is order-sensitive.** Changing only the roster order can
move up to 2 calls between individuals. The systematic advantage to whoever the
database returned first has been removed (correlation −0.775 → −0.135), but the
residual is inherent to greedy assignment and would need a solver to eliminate.
A Chief Resident should review the distribution, not assume it is optimal.

**PARO rules are unreviewed.** See §3.

**No session revocation.** See §4.

### P2

**No backup is configured by default.** There is no in-product export-everything
or undo. `DEPLOYMENT.md` documents pg_dump and restore; set it up before real
data is entered.

**18 legacy assignments have no block availability record.** Written before
availability became mandatory. They are reported by
`npm run data:integrity-audit` and deliberately not auto-repaired, because
deleting them would erase a real schedule. New occurrences are prevented.

**One legacy call day sits outside its block range** (2026-08-25, one day before
Block 3 starts), a date-basis artifact. Reported, not silently moved, because
moving it would change who is on call.

**Single-instance assumptions.** In-process rate limiting and no distributed
locking. Run one API instance.

### P3

* Frontend main bundle is ~625 kB minified (~182 kB gzipped) and trips Vite's
  500 kB warning. No measured problem; splitting is unjustified without one.
* On Windows, Playwright-owned server teardown can hang after tests pass. See
  `LOCAL_QA.md`.
* Audit metadata is capped at 4 kB; a very large change records a truncation
  marker instead of full detail.
* Deprecated `User` columns (`category`, `clinicalIdentity`, `desiredRole`,
  `homeSpecialty`) are retained but never written. They can be dropped once no
  environment needs the historical values.

## 6. Backup requirements

**Mandatory before the beta starts.** MedRota has no built-in backup and no
undo. The audit trail records what changed; it cannot restore anything.

1. Nightly `pg_dump --format=custom`, stored encrypted and off the database
   host. Dumps contain resident names, emails and the full schedule.
2. **Restore at least one dump into a scratch database and verify row counts
   before the beta begins.** An untested backup is not a backup.
3. Take a fresh dump immediately before any deployment containing a migration.
4. Decide a retention period and apply it yourself; nothing is automated.

Full commands in `DEPLOYMENT.md`.

## 7. Test matrix

| Suite | Command | Covers |
|---|---|---|
| Role mapping | `npm run roles:audit`, `npm run roles:smoke` | Canonical roles, legacy mapping, permission sets |
| Authorization | `npm run authz:smoke` | Program isolation, invite authority, registration, transactional day save, history privacy |
| Scheduler unit | `npm run paro:smoke`, `npm run phase5:smoke` | PARO helpers, generation basics |
| Scheduler DB | `npm run phase5:db`, `npm run scheduler:integration` | Real generation, caps, overrides, idempotency |
| Scheduler acceptance | `npm run scheduler:acceptance` | Five realistic scenarios, anonymized, isolated |
| Fairness | `npm run scheduler:fairness` | Distribution and roster-order bias |
| Validation | `npm run schedule:validate-smoke` | Stored-schedule violation codes |
| Publish safety | `npm run publish:safety-smoke` | Actionable violations, publish gate, unfilled-slot reasons |
| Publish revocation | `npm run publish:revocation-smoke` | Unpublish, link rotation, token never audited |
| Availability | `npm run availability:smoke` | Bulk enroll, copy-forward, readiness, authorization |
| Resident/block workflow | `npm run resident:workflow-smoke` | Auto-participation windows, reusable rotating residents, PGY/role mapping, names, academic time, workload, safe removal, permissions and audit |
| Data integrity | `npm run data:integrity-audit`, `npm run data:integrity-smoke` | Role-slot uniqueness, repair classification |
| Audit trail | `npm run audit:smoke` | Recording, redaction, role visibility |
| Privacy and exports | `npm run phase6:smoke` | Public shape, Excel, printable |
| Deployment | `npm run deploy:smoke` | Headers, body limits, health, shutdown wiring |
| Frontend | `npm run perf:guard`, `npm run lint`, `npm run build` | Performance patterns, lint, build |
| Program configuration | `npm run program-config:smoke` | Clinical services, activity lifecycle, history preservation, dynamic Chief authorization, fixed role hierarchy |
| Program settings saving | `npm run settings:save-smoke` | Section-scoped program saves, registry and roster field updates, blank-name refusal |
| QA test isolation | `npm run qa:isolation-smoke` | Two consecutive QA seed/test cycles leave the QA registries at their baseline |
| Browser | `npm run e2e` | 64 Playwright tests: calendar, resident directory/block composition, PGY, academic time, workload, safe removal, overrides, validation, audit, publishing, permissions, responsive and accessibility |

**What the tests do not cover:** real clinician data, a real program's rule
interpretation, concurrent multi-user editing, load or soak, browsers other than
Chromium, and assistive technology beyond keyboard and accessible-name checks.

## 8. Program configuration safety

Program display name identifies the local residency program; Primary specialty remains its medical category. Clinical services and attending activity types are optional program-level registries, not global specialty defaults. Deactivation is non-destructive and historical attending labels remain stored and readable.

Program Admin and Program Director always receive the full canonical program permission set. Only those roles can change the Chief Resident's bounded operational permission configuration. Viewer permissions are fixed to published, read-only access; permission payloads cannot promote a Viewer. The future rules capability is represented by `manage_scheduling_rules`, with no rule engine included in this release.

Resident identity is durable at program scope. Block enrollment is a separate,
unique relationship and never duplicates the person record. Contact fields are
optional and are excluded from public schedule shapes. Historical assignments
and immutable published snapshots are retained when training dates, active state
or future automatic participation changes. Block removal is refused while the
resident has assignments.

## 9. Deployment prerequisites

1. Node.js 22+, PostgreSQL 15+ (CI uses 17).
2. TLS terminated in front of the API.
3. All six environment variables set — see `backend/.env.example`. In
   particular `APP_BASE_URL` must be the real frontend URL or every invite link
   will point at `localhost`.
4. `NODE_ENV=production`.
5. Backups configured **and one restore verified** (§6).
6. `npx prisma migrate deploy` run; never `migrate reset` or `db push`.
7. `GET /api/health/ready` returning 200.
8. One API instance (§5).
9. A named operator with database access, for the things the product cannot do:
   password resets and locked-out users.

Procedure in `DEPLOYMENT.md`.

## 10. Readiness verdict

**Ready for a supervised private beta with a program that keeps its previous
scheduling method available as a fallback.**

Suitable for: one program, one Chief Resident building real schedules, with
someone able to restore a backup, and the expectation that the PARO
interpretation and the generated distribution get reviewed by a human before
anyone relies on them.

Not suitable for: multiple programs, unsupervised use, anything treated as a
system of record, or any context where the absence of password reset, session
revocation and an independent security review is unacceptable.
