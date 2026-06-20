# MedRota Local QA

This checklist is for local development databases only. The QA seed uses clearly named `QA_ONLY` records and should not be used for production data.

## Seed Command

Run from `backend`:

```bash
npm run dev:seed-qa
```

The script refuses to run when `NODE_ENV=production`. It creates or updates its own QA organization, program, users, memberships, sample residents, attending data, assignments, and a flag without deleting unrelated data.

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

QA block: Block 1, `2026-06-15` to `2026-06-28`

## Expected Role Behavior

| Role | Expected Access |
|---|---|
| Chief Resident | Can view draft schedule, open calendar day modal, assign residents, edit attending entries, generate, clear, publish, export draft schedules, and edit block settings. Cannot manage users/program settings. |
| Program Admin | Can do scheduling work, edit program settings, manage users, create academic years, and delete program. |
| Program Director | Can do scheduling work, edit program settings, manage users, and create academic years. Cannot delete program. |
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

The Playwright config seeds QA data with `backend/npm run dev:seed-qa`, starts the backend, starts Vite, and runs Chromium headless. This is the required browser check after future UI, roles, permissions, login, or calendar modal changes.

If browsers have not been installed on the machine yet, run once from `frontend`:

```bash
npx playwright install chromium
```

Current E2E coverage includes Chief Resident login, calendar day modal resident preselects, attending visibility, assignment Save persistence, reload persistence, Viewer read-only restrictions, Viewer direct mutation API rejection, login password eye stability/toggle, and visible mojibake checks.

After running E2E manually, run the seed again if you want to restore the default QA assignment state:

```bash
cd backend
npm run dev:seed-qa
```

## Current Milestone Status

- Phase 5 scheduling smoke coverage is closed and passing.
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
