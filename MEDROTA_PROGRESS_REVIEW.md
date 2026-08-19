# MedRota Progress Review

## Current Project Status

Recovery branch status: trustworthy single-program MVP candidate, pending real-program rule review and deployment hardening. The reliability sprint closed the audited program-isolation, transactional calendar-save, silent override, missing availability, blended-call, misleading settings, weak data-integrity, and frontend auth gaps.

This is not a claim of PARO, privacy, or production compliance.

## Confirmed Working Behavior

- Canonical roles: `chief_resident`, `program_admin`, `program_director`, `viewer`; backend permissions are authoritative.
- Cross-program stats, attending-copy/template, resident/block, membership, and schedule-history paths enforce resource ownership and permissions.
- Day assignment updates are transactional and reject duplicate residents/invalid roles without destroying prior assignments.
- Violating manual edits require a fresh backend check, explicit confirmation, and non-empty reason; recorded overrides are preserved and counted during regeneration.
- The stored draft validator reports stable rule codes and is available from the Calendar.
- Auto-generation excludes residents with missing block availability, preserves overrides, honors supported local caps, and leaves unfillable slots unassigned.
- The blended formula is `(home * 3) + (in-house * 4) <= 30`.
- Public holidays appear in the authenticated calendar and published snapshot.
- Publishing creates immutable versions; public views/exports use the latest privacy-shaped published snapshot. Protected exports use the current draft and are labeled accordingly.
- Protected frontend routes require authentication; expired/invalid sessions clear locally on 401 while public login/register/join/schedule routes remain public.
- Password minimum, auth rate limiting, disabled request-access writes, environment checks, configurable CORS/app URL, and production-safe error responses are in place.

## Supported Settings

- Program: junior and senior in-house-call toggles.
- Block: `avoidAcademicDays`, `allowAttendingOnlyDays`, `maxCallsMedStudent`, and positive `maxCallsPerResident` as a stricter local ceiling.
- Deprecated database-only columns: `allowWeekendConsecutive`, `limitWeekendCalls`.

## Behavioral Protection

- `authz:smoke`: real HTTP and database isolation, role, auth, invite, transactional assignment, override, and history privacy checks.
- `scheduler:integration`: real generator/database checks for vacation, pre-vacation, missing availability, call caps, weekends/consecutive rules, preserved overrides, and unfillable dates.
- `schedule:validate-smoke`: direct stored-schedule violation behavior.
- Phase 5 DB persistence and Phase 6 privacy/export behavior.
- Ten Playwright workflows covering auth guards, calendar persistence, overrides, validation, holidays, Viewer restrictions, settings, publishing/public access, password UI, and visible encoding damage.

Legacy assertions that only searched application source strings were removed from the Phase 5 and PARO smoke scripts.

## Known Warnings and Remaining Risks

- The Vite main bundle is about 625 kB minified and triggers the >500 kB warning. There is no current evidence that code splitting is a P0/P1 need.
- The performance guard reports the short, user-triggered Calendar publish-pulse box shadow.
- Windows Playwright-owned server teardown can hang after tests pass; `LOCAL_QA.md` documents the verified server-reuse run.
- Existing data had five duplicate `(callDayId, roleOnDay)` groups. The sprint did not delete or reinterpret those records, so no role-slot unique constraint was added. The validator reports duplicate role slots and new transactional writes prevent them.
- Only vacation is a reliable days-on-service deduction. Academic flags use a label convention; other time-away, multi-month averaging, shift work, emergency clauses, and formal approvals remain unsupported.
- “Print / PDF” is printable HTML for browser Save as PDF, not server-generated PDF.
- No production deployment, secret management platform, backup/restore drill, audit log, penetration test, accessibility audit, or real-program acceptance test has been completed.

## Next Priorities

1. Validate scheduler and validator results against anonymized real program schedules and current institutional/PARO interpretation.
2. Decide and safely remediate legacy duplicate role slots, then consider a `(callDayId, roleOnDay)` unique constraint.
3. Add deployment configuration, managed secrets, TLS/reverse-proxy policy, database backups, monitoring, and recovery drills.
4. Perform mobile, keyboard, modal-focus, and assistive-technology QA with representative users.
5. Expand onboarding/invite acceptance testing and replace the disabled request-access stub only if an approval workflow becomes an MVP requirement.
