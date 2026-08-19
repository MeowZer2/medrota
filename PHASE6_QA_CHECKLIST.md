# Phase 6 Public Schedule and Export QA

Status: implemented and regression-protected. Recovery hardening added program isolation, schedule-history privacy, truthful draft/published labeling, and behavioral browser coverage.

## Roles and Privacy Boundary

- Canonical roles are `chief_resident`, `program_admin`, `program_director`, and `viewer`.
- Legacy values map as follows: `coordinator` to Program Director, `admin` to Program Admin, `builder`/`editor` to Chief Resident, and unknown to Viewer.
- Backend checks in `backend/lib/roles.js` are authoritative. Program membership management requires `manage_users`, and a sole Program Admin cannot remove or demote themselves.
- Registration profile metadata is not authority. Existing-program invite role is authoritative, and arbitrary public request-access database writes are disabled.

Public viewers may see display names, specialty, block range, published timestamp, schedule dates, attending display/activity, resident display names, holiday/flag labels, and assignment status. They must not receive internal IDs, emails, override metadata/reasons, diagnostics, raw `snapshotJson`, draft state, or publisher identity.

## Publishing and Export Behavior

- `POST /api/schedule/publish` creates an immutable `ScheduleVersion` and reuses or creates a random public token.
- `/schedule/:token` and public JSON/Excel/printable routes use the latest published snapshot through the public-safe shape.
- Authenticated Excel and printable routes use current live data and say `Draft schedule`.
- Public exports say `Published schedule` with the publication timestamp.
- PDF routes return printable HTML for browser printing/Save as PDF; they do not generate PDF bytes on the server.

## Automated Checks

Run from `backend`:

```bash
npm run phase6:public-privacy
npm run phase6:excel
npm run phase6:printable
npm run phase6:smoke
npm run authz:smoke
```

Run from `frontend`:

```bash
npm run lint
npm run build
npm run e2e
```

These checks cover public key filtering, published snapshot export, protected draft export labels, printable HTML, Viewer history privacy and mutation denial, publish/public access without authentication, and mojibake absence. See `LOCAL_QA.md` for the verified Windows Playwright server-reuse procedure.

## Manual Release Checks Still Required

- Inspect protected and public workbooks in Excel or LibreOffice.
- Inspect print preview and Save as PDF output on supported browsers.
- Verify public schedule layout on desktop and mobile and confirm invalid/unpublished tokens show the unavailable state.
- Confirm real production configuration does not use QA credentials, localhost origins, or development secrets.

## Remaining Limitations

- Browser E2E protects core workflows, not every route or responsive breakpoint.
- No server-generated PDF, public-link revocation/rotation workflow, or formal privacy/compliance certification exists.
- Publication is a snapshot; later draft edits do not change the public view until re-published. A “changes since published” badge was not added because the current schema lacks a reliable schedule-wide mutation timestamp.
