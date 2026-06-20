# MedRota Progress Review

## Current Project Status

This milestone is stabilized after the roles/onboarding work, Phase 5 scheduling checks, Phase 6 public schedule/export work, local QA seed setup, and Playwright browser E2E coverage.

## What Works Now

- Phase 5 scheduling smoke coverage is closed and passing.
- Phase 6 is implemented:
  - Public schedule link and read-only public schedule page.
  - Public-safe schedule shaping.
  - Protected and public Excel exports.
  - Protected and public printable/PDF HTML exports.
- Roles and onboarding are implemented with canonical program roles:
  - `chief_resident`
  - `program_admin`
  - `program_director`
  - `viewer`
- Local QA users and QA data are available through `backend && npm run dev:seed-qa`.
- Calendar day modal assignment save, resident preselects, attending display, reload persistence, viewer read-only behavior, and login password visibility behavior are covered by Playwright E2E.
- Frontend performance guardrails are in place through `frontend && npm run perf:guard`.

## Protected By Automated Checks

- Backend role mapping and permissions: `npm run roles:smoke`.
- Local role distribution audit: `npm run roles:audit`.
- Phase 5 scheduling regression smoke: `npm run phase5:smoke`.
- Phase 6 public privacy, Excel, printable, and aggregate smoke checks.
- Prisma schema validation.
- Frontend performance guard, lint, and production build.
- Playwright E2E for:
  - Chief Resident login.
  - Calendar day modal open/save/reopen/reload flow.
  - Resident select preselection.
  - Attending visibility.
  - Viewer read-only restrictions.
  - Viewer direct mutation API rejection.
  - Login password eye icon stability and toggle.
  - Visible mojibake checks.

## Known Remaining Warnings

- Vite build warns that the main chunk is larger than 500 kB after minification.
- The performance guard warns about an animated Calendar box-shadow; the guard passes and the animation is currently low-frequency.

## Known Remaining Risks

- New machines need Playwright Chromium installed once:

```bash
cd frontend
npx playwright install chromium
```

- E2E coverage is focused on core calendar/roles/login regressions, not every app route.
- Manual visual QA is still useful before release, especially on real desktop/mobile browsers.

## Product Decisions Needed Before Implementation

- Final scheduling rule decisions before any assignment engine rebuild.
- Whether viewer surfaces should move to a dedicated published schedule landing path inside the authenticated app.
- Whether registration/onboarding needs more product copy, approval flow, or request-access workflow polish.
- Whether large frontend chunks should be split now or deferred until measured performance requires it.

## Suggested Next Priorities

1. Finish browser QA on a real local machine using the QA users.
2. Keep running `frontend && npm run e2e` after calendar, roles, permissions, or login changes.
3. Resolve the Vite chunk-size warning later if it becomes a measured performance issue.
4. Decide final scheduling rules before rebuilding assignment logic.
5. Continue registration/onboarding polish only after current bugs remain stable.
6. Prepare Phase 7 launch/polish after the current milestone stays green.
