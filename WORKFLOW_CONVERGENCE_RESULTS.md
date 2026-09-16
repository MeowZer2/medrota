# Workflow convergence release results

## Revision and scope

- Baseline: `be1c22d7fa50d629ddafc706639be71beed6f59b` on `main`.
- Final revision: the `main` commit containing this report (`git rev-parse HEAD` after checkout). The exact pushed SHA and GitHub Actions run are also recorded in the release handoff.
- This release changes the scheduling workflow, publication comparison, UI, QA seed and tests. It does not add a table, migration, alternate resident model, availability model, or publication-state column. Scheduler eligibility and PARO rules are unchanged.
- Earlier audit and baseline results: [WORKFLOW_UX_AUDIT.md](WORKFLOW_UX_AUDIT.md) and [WORKFLOW_UX_RESULTS.md](WORKFLOW_UX_RESULTS.md).

## Workflow measurements

These count navigation or explicit entry operations, not elapsed time. The baseline path is the workflow available at `be1c22d`; the new path was exercised in browser tests.

| Task | Before | After |
|---|---|---|
| Published absence amendment, starting on an assigned day | Leave Schedule for block resident availability and return: two section transitions; find the resident in the block list; find the affected date again. | Open assigned resident's availability inside the day, confirm, repair the same day, validate and re-publish: zero global-page detours, zero block or date re-selection. `?date=` survives refresh and workspace section navigation. |
| Enter a seven-day vacation | Seven date entries and seven Add operations, then confirmation: 15 explicit operations. | Start date, end date, Add, confirmation: four explicit operations. Both endpoints are included; stored dates remain individual date-only values. |
| Find work after login | Dashboard showed general metrics; the Chief had to open a block to find the next preparation issue. | The Dashboard names the current/upcoming (or latest earlier) block's missing confirmations, composition, attending entries, assignments, rule issues and publication changes with direct section links. The next issue is visible before navigating. |
| Published amendment state | A Published label remained after a draft edit. | Published/current → assignment or attending edit → Changes not published → re-publish → Published/current. The public link continues to serve the old immutable version until re-publication. |

## Implementation decisions

### Calendar repair and availability

The day editor uses the existing block resident availability editor. It opens for an assigned resident, returns to the same day after confirmation, reloads saved resident data, checks validator findings, and leaves the assignment in place with a visible review warning. Replacement continues through the existing manual assignment endpoint and its explicit override confirmation. The selected day lives in the URL so refresh and browser Back can restore context. Role-specific controls keep availability, assignment, attending and publication actions separate.

The availability editor expands inclusive vacation and other-unavailable ranges into the current per-date representation, deduplicates them and removes only dates in the selected range. Start/end inputs are bounded by the block. Calendar arithmetic uses UTC date-only keys, including across daylight-saving transitions. Academic recurrence and call-cap settings retain their existing controls and explicit save.

### Publication status

`GET /api/schedule/publication-status?blockId=...` compares the latest immutable `ScheduleVersion.snapshotJson` with current public schedule content, using a sorted canonical domain shape. It considers assignments and their public resident names, attending names/activities/call-day status, call-day and holiday information, and displayed block/program text. It ignores row IDs, row order, timestamps, audit data and private contact metadata. It returns `never_published`, `current`, `changes_unpublished`, or `unpublished`; the last state preserves the distinction between an unpublished link and a block that has never had a version. No duplicate persisted state can drift out of sync. Availability by itself is not in the public snapshot; an affected assignment is highlighted by the day workflow and becomes an unpublished public change when it is repaired.

The workspace, Schedule and Dashboard expose the result. A new backend smoke test checks canonical equality, material edits, unchanged metadata, and the four states. Browser tests cover assignment and attending edits, unrelated contact edits, re-publication, public output and immutable history. The QA seed now builds a publication snapshot with the same displayed resident names as the public route and restores all availability fields for its own seeded residents between runs.

### Dashboard and related workflows

The Dashboard selects blocks by actual date across academic years and gives unfinished work prominent, direct links. Older blocks with unpublished changes remain visible. Elapsed time is no longer presented as completion. If checks fail, the card asks for review instead of claiming the block is ready.

The block attending page identifies program-wide roster, contacts, activities and weekly pattern separately from daily block coverage. Applying a weekly pattern remains explicit; a daily edit affects the block. Any-entry preparation coverage is described separately from on-call coverage (`isCallDay`). Autosave now says Saving, Saved or Save failed in an announced status. Clear and reset sit under More actions.

The Resident Directory has search across names, PGY, role, service, status and home program. A same-name creation shows possible existing records and requires explicit confirmation for a separate person. The block enrollment flow offers reuse of an existing rotating resident. First-program setup calls created blocks empty, explains that no call schedule exists yet, and leads to the first block. Validation success now says there are no scheduling rule violations, which does not imply every slot is filled.

## Safety, permissions and accessibility

- The new status endpoint requires `view_draft_schedule` and uses the existing block/program authorization. Availability PUT, manual assignment, attending editing and publication keep their existing server-side permission checks.
- A Viewer sees no contextual availability edit and receives 403 for a direct availability mutation. Limited Chief permissions remain separated by capability. Publication validation, violation acknowledgement, documented overrides, audit, history and revocation remain in place.
- The day and availability dialogs retain labelled modal semantics, Escape, focus return and keyboard operation. Attending saves communicate by text and live status rather than colour alone.
- Workflow E2E interactions ran at 375, 768, 1024 and 1440 px. Visual review covered Dashboard, workspace, attending, Schedule, day and availability dialogs, dirty state and first-program handoff in light and dark themes. The mobile range fields stack while actions remain reachable. Rendered contrast and theme guards passed.

## Validation and performance

- Browser suite: 92 Playwright tests (79 prior plus 13 new), including persisted amendment, date-context navigation, range, cross-year block selection and access checks. Accessibility, rendered contrast, theme and responsive specs are part of that suite.
- Backend: 23 behavioral commands, including the new publication-status smoke, passed locally. Prisma schema validation and migration status passed with 13 applied migrations and no pending migration.
- Frontend lint, production build, theme token and contrast guards, performance guard, and `git diff --check` passed locally.
- Production JavaScript gzip: 196.66 kB before → 197.97 kB after (+1.31 kB, about 0.7%). CSS gzip: 11.24 → 11.10 kB (-0.14 kB). No dependency was added. The existing large-chunk build warning and Calendar animated box-shadow guard warning remain; no new performance guard violation was introduced. No runtime speed claim is made.
- The browser audit exposed an existing missing `PublishBlockedModal` referenced by the publish-violation path; this release supplies the review and acknowledgement dialog. A login-page audit race was fixed by waiting for the rendered form before scanning.

## Remaining limits

- Availability is an input to scheduling, not part of the public snapshot. Saving an absence alone leaves publication status current until public schedule content changes; the day editor calls out an inconsistent retained assignment immediately.
- The app remains an MVP with the product, privacy and deployment limitations in [PRIVATE_BETA_READINESS.md](PRIVATE_BETA_READINESS.md). This release does not certify scheduling or regulatory compliance.
