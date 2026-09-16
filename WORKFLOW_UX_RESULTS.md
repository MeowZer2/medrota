# MedRota workflow redesign: product report

September 16, 2026. Baseline: `3e19fa0`. The [pre-implementation audit](WORKFLOW_UX_AUDIT.md) contains the original findings, scenario walkthroughs, severity/frequency ratings, and batch decision. This report describes the delivered change and local validation. The completion message records the final revision, push, and GitHub Actions result for the exact pushed revision.

The central problem was structural: preparing one block required navigating separate data-management screens while remembering the selected block. The delivered workspace makes that preparation a continuous job. It also fixes contradictory block dates and unreliable block links. It does not resolve every scheduling UX problem identified in the audit.

## 1. Ten worst workflow problems

| Rank | Finding | Result of this batch |
|---|---|---|
| 1 | Block boundaries shifted backward one day in timezones west of UTC; calendar dates and attending dates disagreed. | Fixed date-only parsing and display on the working surfaces. Verified June 29–July 12 in America/New_York, including the final attending date and DST handling. |
| 2 | Block identity lived in ambient selection; global attending URLs lost context on reload and block numbers were ambiguous across years. | Stable block IDs travel with workspace links. Resolution checks both number and ID across years. Invalid/mismatched links fail visibly. |
| 3 | “Ready,” “compliant,” and “complete” implied more than their underlying measurements proved. | Overview and resident preparation now use the existing authoritative readiness response, including confirmed senior/junior requirements. Copy distinguishes readiness from a filled schedule and labels any-entry attending coverage. Broader calendar/dashboard wording remains. |
| 4 | Block Overview was a roster detour with duplicate management links and no forward preparation path. | Replaced with an actionable overview, in-place resident availability, and persistent local navigation. |
| 5 | Dashboard metrics obscured unfinished work; elapsed time read as completion, and Auto-generate had no click handler. | The dead action now opens “Prepare block.” The misleading time-based progress and current/active selection need a dedicated dashboard update. |
| 6 | Attending roster, contacts, activities, patterns, and block coverage had competing homes and ambiguous scope. | Added block-scoped Attendings navigation and retained existing operations. Consolidating reusable attending setup is deferred. |
| 7 | Entering a vacation week required repetitive per-date actions, and routine availability was buried beside advanced rules. | Availability opens directly for the named resident on Overview. Vacation range entry and calendar-context editing remain. |
| 8 | Finding a resident required scanning unsorted work across separate pools; mobile showed available residents before the working roster. | Search both block pools, show the working roster first on phones, and disclose detailed workload arithmetic on demand. The global directory still needs search. |
| 9 | Mobile overview content clipped inside cards even when document-width checks passed. | Responsive rows and wrapping navigation; tests now measure row/action bounds as well as page overflow and complete the actual task at four widths. |
| 10 | Published badges did not show whether the current draft differed from the public snapshot. | Shared context explains that the editor is a working draft and public links show a published snapshot. Actual draft-versus-snapshot comparison is deferred. |

## 2. Three worst overall UX decisions

1. Making users remember block identity while showing inconsistent dates. These are scheduling trust failures.
2. Organizing the primary journey around database entities and destinations instead of preparing, reviewing, and publishing a block.
3. Using success language for partial measurements: elapsed time, confirmed residents, rule compliance, or the existence of a snapshot.

The old block overview was fundamentally poor as a scheduling home. Its primary job was sending users elsewhere. The separate global attending destination should eventually cease being the main route for editing an individual block; reusable people and pattern administration can remain program-scoped.

## 3. Existing workflows worth preserving

- Durable resident identity with explicit rotating enrollment and automatic eligible in-service participation.
- Creating and enrolling a rotating resident in one existing dialog.
- A single resident availability editor with explicit confirmation.
- Prefilled day assignment editing, documented overrides, and persistence after reload.
- Dated validation links into the day editor and explanations for unfilled slots.
- Explicit publishing acknowledgement, immutable public snapshots, private-contact exclusion, history, and link revocation.
- Section-specific settings saves, unsaved-change protection, registry deactivate/restore, and backend permission enforcement.

## 4. Navigation and information architecture

Delivered block structure:

```text
Block [academic year, number, exact dates, publication context]
  Overview                  preparation status, next action, searchable roster
  Residents & availability  participation, availability, advanced workload details
  Attendings                existing pattern and coverage operations for this block
  Schedule                  generate, edit, validate, publish, history
  Block rules               advanced configuration through a secondary action
```

The shared shell stays mounted when moving between these sections. Changing blocks resets section-local editing/search state. Links preserve the section and include the immutable block ID; existing numbered links and the global attending route remain usable.

The broader recommended architecture remains: an attention-focused Dashboard; Scheduling/Blocks; reusable People administration; and Program administration. This batch implements the block workspace, not the entire global reorganization.

## 5. Ideal Chief Resident workflow

Open the upcoming block once, verify dates, resolve the named preparation issues, add rotating residents from existing records, confirm absences/academic time, apply and adjust attending coverage, then continue to Schedule. Generate with an accurate understanding of remaining warnings, review unfilled calls, make manual assignments or documented exceptions, validate, and publish the reviewed snapshot. Later draft amendments require re-publication to update the public schedule.

## 6–7. Chosen redesign and why

One coherent batch: a shared block workspace with actionable Overview and direct availability editing. It touches the highest-frequency preparation job and repairs critical identity/date defects while reusing existing models, forms, readiness, and scheduling operations. It removes repeated navigation without introducing a second scheduling system or changing eligibility rules.

The work deliberately stops short of a global dashboard, onboarding, or publication redesign. Each has a separate user job and requires its own behavioral decisions and validation.

## 8–9. Exact before and after

Measured job: start on an open block, confirm one resident's availability, apply the existing attending template to that block, and reach a state where generation is enabled. Initial block selection and data-entry interactions are excluded from the page-transition count.

**Before, replayed against the baseline:**

1. Open Manage block residents: `/blocks/2/residents`.
2. Find the resident, open Configure, edit and confirm.
3. Return to Block: `/blocks/2`.
4. Open schedule & generate: `/blocks/2/calendar`.
5. Follow the missing-attending action: `/attending`.
6. Apply the weekly pattern for this block.
7. Return through the block in the sidebar: `/blocks/2`.
8. Open schedule & generate again: `/blocks/2/calendar`.

**After, exercised end to end with persisted data:**

1. Overview names the resident needing preparation. Open that resident's availability in place, add vacation/academic time, and confirm.
2. Select Attendings in the shared block navigation and apply the template to this block.
3. Select Schedule. Verify all 14 dates have attending entries, resident requirements are satisfied, readiness has no blockers, and generation is enabled.

| Measure | Before | After |
|---|---:|---:|
| Page transitions after opening the block | 6 | 2 |
| Required backward/hub returns | 2 | 0 |
| Availability editor access from Overview | Manage residents → Configure | Availability for the named resident |
| Resident-list searches for this path | Overview then management | Overview only |
| Block identity survives a direct attending link/reload | No | Yes |
| Availability open/confirm clicks, no edits | 3 | 2 |
| One vacation date, including field entry/Add/Confirm | 5 interactions | 4 interactions |

This is a **67% reduction in page transitions for the measured discoverable path**, not a claim of 67% less total work or task time. The baseline replay exercised navigation and opened the editors without saving/applying records; the new regression saves and verifies real changes. Form interaction counts otherwise remain comparable. A knowledgeable user could choose a different old shortcut path. No user timing study was performed.

Single-day assignment editing remains approximately three actions (open day, select, save); generation from a ready block remains two (Schedule, Auto-generate); publishing retains its existing two-step action/confirmation. These domain workflows were preserved.

## 10. Pages and components changed

| Area | Files and purpose |
|---|---|
| Shared block context | `App.jsx`, new `BlockWorkspace.jsx`, `blockNavigation.js`, `useWorkingBlock.js`: nested routes, persistent shell, exact block resolution, focus and block switching. |
| Preparation | `BlockPage.jsx`, `BlockResidents.jsx`, `ReadinessPanel.jsx`, extracted `BlockResidentAvailabilityModal.jsx`: actionable overview, shared existing editor, authoritative readiness, loading/error/retry states, searches and workload disclosure. |
| Existing working pages | `Calendar.jsx`, `AttendingSchedule.jsx`, `BlockSettings.jsx`: reuse the block shell and stable links; keep existing editing/generation/publishing handlers. |
| Entry points and dates | `blockUtils.js`, `BlockSelector.jsx`, `Sidebar.jsx`, `Dashboard.jsx`, `Residents.jsx`, `Layout.jsx`: date-only handling, canonical links, working Prepare block action, accurate program label on phones. |
| Styling | New `styles/workspace.css`, imported by `index.css`: theme tokens, responsive local navigation and roster layouts. |
| Verification/docs | New `e2e/block-workspace.spec.js`; updated accessibility, contrast, responsive, theme and resident-workflow specs; `README.md`, `LOCAL_QA.md`, audit/results documents; `.audit/` ignored for local evidence. |

All source paths in this table are under `frontend/src/` unless they start with `e2e/` (under `frontend/`) or name a root document.

## 11. Consolidation and primary-workflow removals

Availability is a shared resident editor, not a new standalone page. Readiness is embedded in Overview and reused on working pages. Block attending work is reachable inside the same workspace. Duplicate block selectors/headers are suppressed inside that workspace. Detailed call-limit arithmetic and block rules are secondary disclosures/actions. The dead dashboard Auto-generate action was replaced with a working preparation entry point.

No generation, validation, override, export, history, publication, revocation, registry, or scheduling capability was removed.

## 12–13. Backend, schema, and permissions

No backend implementation, schema, migration, model, or scheduling-rule changes. The UI continues to use ResidentProfile, BlockEnrollment, AttendingRoster, existing schedule/readiness APIs, audit behavior, and published snapshots. PARO, days-on-service, PGY/role mapping, eligibility, manual overrides, template behavior, validation and publication rules are unchanged.

The workspace gates editing/navigation with existing capabilities. Availability actions require resident-management permission; attending operations require attending-schedule management. Calendar validation now checks `validate_schedule` instead of the broader draft-view capability. Limited Chiefs and viewers are covered by regression tests. Backend enforcement is unchanged and authorization suites pass. Invalid or mismatched block IDs do not fall back to another block.

## 14. Accessibility results

Keyboard navigation, dialog focus return, names/labels, native block selection and section-change focus are covered. Local navigation uses real links and `aria-current="page"`, rather than pretending routed pages are an ARIA tab widget. Existing editable controls remain keyboard operable. The reused availability modal retains the established dialog behavior.

Theme guard passes **132 contrast pairs in both themes**, and rendered contrast, accessibility and theme suites pass with the new surfaces included. This is automated and focused manual verification, not a certification of every possible state of the application.

## 15. Responsive results

The complete preparation scenario passes at **375, 768, 1024 and 1440px** in America/New_York. Tests check page overflow plus roster, action and calendar-day bounds; this catches the original hidden clipping problem. Phone navigation wraps into a compact grid and the participating roster appears before the available pool. Dark-theme captures at all four widths and a light-theme pass were visually inspected. The final browser tour recorded no uncaught page errors.

The first Linux CI run exposed 3px of calendar overflow at 768px with populated attending entries. A longer surname reproduced the problem locally with 43px of overflow. Day cells now wrap unbroken names within their column, and tablets use the existing readable day list until 1024px rather than squeezing seven columns beside the sidebar. The strengthened workflow regression waits for persisted attending text after reload and checks each day button for internal clipping. The zero-page-overflow assertion was retained unchanged.

## 16. Performance result

- Performance guard passes. No new dependency, heavy animation, blur, or continuous transition was introduced.
- The workspace shell survives section navigation; block-specific local state resets only when changing block.
- Production JS gzip: **194.65 → 196.66 kB**, an increase of **2.01 kB (1.03%)**.
- Production CSS gzip: **10.57 → 11.24 kB**, an increase of **0.67 kB**.
- Both bundle measurements use the same installed toolchain, with baseline source in an isolated local archive.
- The existing large-main-chunk build warning and finite Calendar box-shadow animation warning remain. Neither guard failed. No runtime-speed benchmark or Web Vitals improvement is claimed.

## 17–18. Tests and local validation

Added **10 block-workspace tests**: real preparation at all four widths; searching and keyboard/context behavior; viewer and invalid-link behavior; duplicate-year block resolution and date/DST handling; readiness failure/retry; changing blocks and browser Back; and limited-Chief permission visibility.

The preparation regression saves vacation and academic availability, verifies confirmation/persistence, applies attending coverage, checks all dates including the last day, reaches server-confirmed generation readiness, and asserts exactly two section transitions. It restores its resident/coverage changes and cleans its owned fixtures. Existing responsive, theme, contrast and accessibility suites now include the workspace. Existing resident navigation assertions were updated to verify the stable block ID as well as the route.

| Check | Result |
|---|---|
| Baseline full Playwright | 69 passed (2.9 minutes) |
| Final full Playwright | **79 passed (3.4 minutes)** |
| Backend behavioral commands | **22 passed** |
| Prisma validate | Passed |
| Prisma migration status | 13 migrations; schema up to date |
| Theme guard | Passed, both themes |
| Accessibility/rendered contrast/responsive/theme browser tests | Passed within the full suite |
| Performance guard | Passed, existing warning noted above |
| ESLint | Passed |
| Production build | Passed, existing chunk warning noted above |
| `git diff --check` | Passed |

Backend commands: `roles:audit`, `roles:smoke`, `authz:smoke`, `phase5:smoke`, `phase5:db`, `phase6:smoke`, `paro:smoke`, `scheduler:integration`, `scheduler:acceptance`, `schedule:validate-smoke`, `data:integrity-audit`, `data:integrity-smoke`, `availability:smoke`, `resident:workflow-smoke`, `program-config:smoke`, `registry:lifecycle-smoke`, `settings:save-smoke`, `qa:isolation-smoke`, `publish:safety-smoke`, `publish:revocation-smoke`, `audit:smoke`, and `deploy:smoke`.

The separate `scheduler:fairness` diagnostic also completed successfully. It reports the existing greedy generator's residual roster-order sensitivity (up to two calls between individuals in that fixture); this workflow batch does not alter the generator.

The isolated program/account created to inspect onboarding was removed after verifying ownership. The pre-existing untracked `START_MEDROTA_TEST.bat` was left untouched and excluded from commits. Local audit captures/logs remain ignored under `.audit/`.

## 19–21. Commits, push, and CI

- `e00a809` — Document the workflow audit and block workspace decision.
- `ffbcb63` — Center block preparation on an actionable shared workspace.
- `b8e3bfa` — Record workflow results and validation evidence.
- A focused follow-up fixes the calendar wrapping defect found by Linux CI and strengthens its regression; its hash appears in the completion message.

The first normal, non-force push to `main` succeeded at `b8e3bfa`. Its [CI run](https://github.com/MeowZer2/medrota/actions/runs/35071068250) passed Backend and Frontend but failed one of 79 browser tests on tablet calendar overflow. That failure is addressed by the focused follow-up above. Final push confirmation and all three GitHub Actions results are verified against the final pushed SHA and recorded in the completion message with the run link. Local test success alone is not treated as CI success.

## 22. Remaining workflow problems, ranked

1. **Calendar-centered change resolution.** A new absence still sends the Chief away from the day being repaired. Add direct contextual availability editing and an obvious return to reassignment, validation and re-publication.
2. **Unpublished-change detection.** Explanation of snapshots is useful, but the UI still needs an actual comparison so Published cannot be mistaken for “public schedule matches this editor.”
3. **Dashboard truthfulness and priorities.** Replace elapsed-time completion and stale current/active labels with dated current/upcoming blocks and an actionable attention queue.
4. **Attending setup fragmentation.** Unify roster/contact/activity setup, clearly separate reusable patterns from block edits, improve saved/error feedback, and clarify on-call versus any-entry coverage measures.
5. **Repetitive vacation entry and resident discovery.** Add date ranges and search to the global directory while preserving explicit confirmation and durable identity.
6. **First-program handoff.** Creating empty blocks should not be labelled schedule generation or imply setup is complete. Guide users into people, coverage and their first working block.
7. **Remaining long-form diagnostics and administration.** Tighten compliance-versus-completeness wording and improve long membership/settings lists after the primary scheduling jobs are addressed.

## 23. Recommended next update

Implement **“resolve a resident absence from the schedule”** as the next bounded workflow: open the affected day, edit the resident's availability using the shared editor, return to that day, replace the affected call, validate, and re-publish through existing safeguards. Include vacation range entry if it fits that same job. Measure navigation and verify permissions, preserved manual assignments, audit events and snapshot behavior. Publication difference detection deserves its own explicit design if it cannot fit without expanding this batch.

That next update has not been started.
