# MedRota Local QA

This checklist is for local development databases only. The QA seed uses clearly named `QA_ONLY` records and should not be used for production data.

## Seed Command

Run from `backend`:

```bash
npm run dev:seed-qa
```

The script refuses to run when `NODE_ENV=production`. It creates or updates its own QA organization, program, users, memberships, explicit block enrollments, sample residents, attending data, assignments, holiday, and flag. To remain deterministic, it clears only `QA_ONLY` resident assignments in the QA block before restoring the seed assignment; unrelated data is not deleted.

## Local QA Credentials

All QA users use this password:

```text
QA_only_password_123!
```

| Role | Email |
|---|---|
| Chief Resident | `qa-chief@medrota.local` |
| Program Admin | `qa-admin@medrota.local` |
| Program Director | `qa-director@medrota.local` |
| Viewer | `qa-viewer@medrota.local` |

QA organization: `MedRota QA`

QA program: `QA Vascular Surgery`

QA blocks:

| Block | Dates | State |
|---|---|---|
| Block 1 | 2026-06-15 to 2026-06-28 | Published, seeded assignments, attending, holiday and flag |
| Block 2 | 2026-06-29 to 2026-07-12 | Draft with **no resident availability**, reset on every seed run |

Block 2 exists so the availability workflow and the pre-generation readiness
check have something deterministic to act on. Its enrollments are cleared each
time the seed runs, so the availability tests can be re-run.

## Expected Role Behavior

| Role | Expected Access |
|---|---|
| Chief Resident | Can view draft schedule, open calendar day modal, assign residents, edit attending entries, generate, clear, publish, export draft schedules, and edit block settings. Cannot manage users/program settings. |
| Program Admin | Can do scheduling work, edit program settings, manage users, and create academic years. Program deletion is not implemented. |
| Program Director | Can do scheduling work, edit program settings, manage users, and create academic years. Program deletion is not implemented. |
| Viewer | Can view/export published schedules only. Cannot open editable day modal or mutate schedule data. |

## Browser Checks

1. Login as `qa-chief@medrota.local`.
2. Open the calendar for QA Block 1.
3. Confirm no visible mojibake strings such as `Ã¢`, `â`, or `Â`.
4. Confirm the day `2026-06-15` shows `QA_ONLY Senior Resident`, `QA_ONLY Junior Resident`, and `QA_ONLY Dr Avery`.
5. Click `2026-06-15` and confirm the modal opens.
6. Confirm the senior/junior selects preselect the same residents shown on the calendar cell.
7. Confirm the attending shown on the cell appears in the modal.
8. Change senior or junior to an alternate QA resident and click Save.
9. Reopen the same day and confirm the saved assignment remains.
10. Reload the page and confirm the saved assignment still appears.
11. Confirm the seeded flag appears and flag save still works.
12. Logout and login as `qa-viewer@medrota.local`.
13. Confirm the viewer can see the published QA schedule.
14. Confirm clicking a day does not open the editable modal.
15. Confirm viewer cannot see or use Save/Add/Generate/Clear/Publish controls.

## Automated Browser E2E

Run from `frontend`:

```bash
npm run e2e
```

The Playwright config runs the backend QA seed, starts the backend and Vite, and runs Chromium headless. This is the required browser check after future UI, roles, permissions, login, or calendar modal changes.

If browsers have not been installed on the machine yet, run once from `frontend`:

```bash
npx playwright install chromium
```

Current E2E coverage is 39 tests across six spec files:

| Spec | Covers |
|---|---|
| `core-calendar.spec.js` | Route guards, calendar prefill/save/reload, duplicate-resident rejection, override confirmation and reason, actionable validation detail, unfilled-slot explanations, publishing with documented overrides, holidays, Viewer restrictions and direct mutation rejection, call-type settings, password visibility, public access, mojibake checks |
| `availability.spec.js` | Readiness before generation, bulk enrollment, copy-forward, dialog keyboard behaviour, block history visible to a Chief Resident and hidden from a Viewer |
| `publishing.spec.js` | Public link rotation invalidating the old link, unpublish and republish, Viewer sees no revocation controls |
| `onboarding.spec.js` | Registration fields, auto-login, the no-invite explanation, invited registration joining at the invited role |
| `responsive.spec.js` | No horizontal scroll at 375/768/1024/1440, dialogs fit a phone, touch-target sizes |
| `accessibility.spec.js` | Named controls, labelled modal dialogs, Escape and focus restore, keyboard-only login, calendar and program settings, role conveyed by text |

The onboarding tests create accounts with unique throwaway emails. They join no
program unless the test explicitly does so, and they are inert.

On Windows, Playwright's owned `webServer` teardown may hang after tests have completed. A reliable local alternative is to start backend and frontend normally, then run:

```powershell
cd backend
npm run dev:seed-qa
# Start the backend and frontend in separate terminals, then from frontend:
$env:PLAYWRIGHT_REUSE_SERVERS='1'
npm run e2e
```

The explicit seed is required because reused servers bypass Playwright's embedded seed command. Stop the manually started local servers afterward. This runner limitation does not change test assertions or browser behavior.

Running the suite repeatedly on Windows can also exhaust ephemeral sockets, which surfaces as `net::ERR_NO_BUFFER_SPACE` on a `page.goto`. It is a host limitation, not a product failure: wait a few seconds and re-run. If it recurs, use the server-reuse procedure above.

After running E2E manually, run the seed again if you want to restore the default QA assignment state:

```bash
cd backend
npm run dev:seed-qa
```

## Current Milestone Status

- Phase 5 scheduling smoke coverage is closed and passing.
- PARO scheduler rules are implemented with program-level junior/senior in-house call settings.
- Phase 6 public link, public schedule page, Excel export, and printable/PDF export are implemented.
- Roles/onboarding are implemented with canonical roles.
- Performance guardrails are available through `frontend && npm run perf:guard`.
- Known warnings: Vite chunk-size warning above 500 kB and the Calendar animated box-shadow perf-guard warning.
- Manual visual QA on real local browsers remains recommended before release.

## Role Audit

Run from `backend`:

```bash
npm run roles:audit
```

The audit prints counts only. It does not print user names, emails, password hashes, or tokens, and it does not mutate data.

## PARO Scheduler Checks

Run from `backend`:

```bash
npm run paro:smoke
```

This checks PARO maximum tables, the `(home * 3) + (in-house * 4)` blended calculation, vacation and post-call-before-vacation rules, consecutive-call rules, and complete-weekend-off helpers. Run `npm run scheduler:integration` and `npm run schedule:validate-smoke` for behavioral generator/validator coverage.
