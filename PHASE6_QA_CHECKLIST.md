# Phase 6 Public Schedule And Export QA

Status: closed after backend privacy/export checks, frontend build checks, and DB-backed Phase 5 regression checks.

Phase 6 implemented:

- Public schedule API privacy shaping via `backend/services/publicScheduleShape.js`.
- Public read-only schedule page at `/schedule/:token`.
- Copyable public schedule link after publish.
- Protected Excel export at `GET /api/schedule/export/excel?blockId=`.
- Public Excel export at `GET /api/public/:token/export/excel`.
- Protected printable HTML export at `GET /api/schedule/export/pdf?blockId=`.
- Public printable HTML export at `GET /api/public/:token/export/pdf`.
- Public privacy, Excel, printable, and aggregate smoke checks.

Public privacy boundary:

- Public viewers may see program display name, specialty, block number, block date range, published timestamp, schedule dates, day of week, attending call name, attending activity labels, resident display names, holidays/flags, and assigned/unassigned status.
- Public viewers must not see user IDs, resident profile IDs, assignment IDs, call day IDs, block IDs, program IDs, organization IDs, emails, override flags/reasons, diagnostics, raw `snapshotJson`, unpublished/draft state, or admin-only metadata.
- Public JSON, public Excel, and public printable HTML all use the public-safe schedule shape before response/export generation.

Automated Phase 6 checks:

```powershell
cd backend
npm run phase6:public-privacy
npm run phase6:excel
npm run phase6:printable
npm run phase6:smoke
```

These checks validate:

- Public-safe shaped data excludes forbidden keys and metadata.
- Representative Excel workbook generation succeeds.
- Excel headers match the expected schedule columns.
- Public Excel cell values do not include forbidden private values.
- Representative printable HTML generation succeeds.
- Printable HTML includes expected schedule headers and rows.
- Public printable HTML excludes forbidden private values.
- Aggregate `phase6:smoke` runs the focused Phase 6 checks together.

Regression checks run during closeout:

- `cd backend && npm run phase6:public-privacy`: passed.
- `cd backend && npm run phase6:excel`: passed.
- `cd backend && npm run phase6:printable`: passed.
- `cd backend && npm run phase6:smoke`: passed.
- `cd backend && npm run phase5:smoke`: passed.
- `cd backend && npm run phase5:db`: passed.
- `cd frontend && npm run perf:guard`: passed with known warning.
- `cd frontend && npm run lint`: passed.
- `cd frontend && npm run build`: passed with known warning.

Syntax checks run during closeout:

- `cd backend && node --check routes/public.js`: passed.
- `cd backend && node --check routes/schedule.js`: passed.
- `cd backend && node --check services/publicScheduleShape.js`: passed.
- `cd backend && node --check services/excelExport.js`: passed.
- `cd backend && node --check services/printableSchedule.js`: passed.
- `cd backend && node --check scripts/phase6-public-privacy-check.js`: passed.
- `cd backend && node --check scripts/phase6-excel-check.js`: passed.
- `cd backend && node --check scripts/phase6-printable-check.js`: passed.
- `cd backend && node --check scripts/phase6-smoke.js`: passed.

Manual browser checks still recommended before release:

- Publish a schedule from the protected Calendar page and confirm the public link is visible and copyable.
- Open `/schedule/:token` in a no-auth/private browser session.
- Confirm public schedule display is correct on desktop and mobile.
- Confirm invalid public tokens show a friendly unavailable state.
- Download protected and public Excel exports and inspect in Excel or LibreOffice.
- Open protected and public printable HTML routes and inspect browser print preview.
- Confirm visible public surfaces do not show IDs, emails, override reasons, diagnostics, or raw snapshot content.

Known remaining warnings:

- `frontend && npm run perf:guard` warns about an animated box-shadow in `src/pages/Calendar.jsx`; the guard passes and this is an existing low-frequency warning.
- `frontend && npm run build` warns that the main Vite chunk is larger than 500 kB after minification.

Recommendation:

Phase 6 is closed. The core public schedule, public link, privacy shaping, Excel export, printable export, and validation coverage are in place. Remaining work should be treated as post-Phase-6 polish or release hardening, not a blocker for Phase 6 closure.
