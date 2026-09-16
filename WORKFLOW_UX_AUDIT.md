# MedRota workflow audit — before implementation

Baseline: `3e19fa0` (`main`). Audit performed September 16, 2026. This document records the findings and batch decision **before product code changes**. Implementation and validation results belong in `WORKFLOW_UX_RESULTS.md`.

## Evidence and scope

Reviewed README, private-beta/local-QA/performance documentation, schema, application routes and context, all principal pages, permission resolution, readiness, generation/validation/publication routes, and browser workflow suites. Used real Chromium against the local Express/PostgreSQL/Vite application with the deterministic QA program. Captured desktop (1440px) and phone (375px) dark-theme screens, settings sections, availability/day/validation/publishing dialogs, and the weekly-pattern editor. Existing browser suites additionally exercise light theme, keyboard operation, settings, enrollment, invitations, overrides, publication and public viewing. Local captures and logs live in `.audit/` (not committed).

These are expert task walkthroughs, not a study with practicing Chief Residents. Interaction counts below count navigation separately from data-entry actions; they are reproducible paths, not invented user timing statistics. A successful test proves behavior, not that the workflow is understandable.

## A. Ten worst workflow problems

| Rank | Problem and concrete evidence | Why it hurts | Frequency / severity | Proposed solution |
|---|---|---|---|---|
| 1 | **The same block has contradictory dates.** In the local browser, Block 2's header and selector say June 28–July 11; the calendar cells correctly cover June 29–July 12. The attending editor renders the shifted range too. Stored UTC-midnight dates are interpreted as local instants. | A scheduler can edit the wrong day or believe the last day is outside the block. This is a trust failure, not cosmetic formatting. | Every visit in timezones west of UTC / critical | Treat block boundaries as date-only values throughout the working surfaces. Test in America/New_York and across a DST change. |
| 2 | **Block context is ambient state.** `/attending` has no block identity. Reloading a global page resets to the default block. `/blocks/1` identifies a number within whichever academic year happens to be selected; invalid numbered routes silently fall back to the current block. | A bookmark is not a reliable scheduling address. The user must keep checking and remembering the block/year. | Every multi-block preparation job / critical | Share a block shell, carry the immutable block ID in links, resolve it across years, and fail visibly on mismatches. Keep existing numbered URLs usable. |
| 3 | **“Ready” has several meanings.** Block Overview and Block Residents infer readiness from missing/unresolved residents. The server also requires a confirmed senior and junior. Attending coverage warnings are absent on Overview. Validation says “Schedule is compliant” with 24 unfilled slots in the seeded schedule. | The interface invites premature generation and encourages an incorrect inference that rule-compliant means complete. | Every generation/publication / high | Use the existing readiness response consistently; distinguish preparation, coverage warnings, assignment completeness and validation. Never promise a filled schedule. |
| 4 | **The block page is a roster detour, not a workspace.** It has two versions of “Manage block residents,” a schedule button, and rules; no attending action, complete preparation checklist, or direct resident fix. After availability, users go backward or use global navigation. | Users learn the app's screens instead of following the scheduling job. Phone users reopen the menu to escape dead ends. | Every block / high | An actionable overview plus stable local navigation; open availability for the named resident directly from the overview; continue to attendings and schedule without returning through the hub. |
| 5 | **The dashboard mistakes metrics for decisions.** “Days in block,” average calls and a generic warning count dominate. A June block is labelled Current/Active in September. The progress bar says 100% complete because time elapsed, despite unfilled calls. “Auto-generate” is not an obvious preparation entry point. | The landing page obscures unfinished work and gives misleading completion cues. | Every login / high | An attention queue for current/upcoming blocks, preparation gaps, uncovered calls and unpublished changes. Link each problem to a fix. Defer the full dashboard redesign to a separate batch. |
| 6 | **Attending setup has two competing homes.** Settings owns contacts and activity definitions; the attending page separately adds a name and edits a global weekly pattern above a block day list. Apply, Reset and Clear compete at the top. Readiness counts any entry; On-call Summary counts `isCallDay`. | New users cannot tell which change affects all blocks, which changes one day, or why two coverage summaries disagree. | New attending, each block, coverage changes / high | Keep reusable roster/activities/patterns together, explain their scope, and separate block coverage. In this batch, add scoped block navigation and accurately label the existing readiness measure. Do not change its domain definition. |
| 7 | **Routine absence entry is needlessly repetitive.** A vacation week requires selecting and adding each date. “Configure” opens a modal mixing vacation, other unavailability, academic recurrence and local call maximum. | Seven days of leave costs fourteen field/add actions before confirmation. Common work is buried beside advanced rules. | Each resident/block; ad hoc changes / high | Direct resident availability actions now; range entry and a contextual day/resident editor next. Keep explicit availability confirmation. |
| 8 | **Finding one person scales poorly.** Neither the directory nor the block's two resident pools has a search. Off-service creation is convenient from a block, but checking whether that person already exists requires scanning. Available residents precede participating residents on phones. Every row exposes call-limit arithmetic. | Time is spent finding a record, duplicate identity becomes tempting, and the working roster is pushed down the page. | Every off-service arrival or schedule change / medium-high | Search both pools together, show the working roster first on phones, and progressively disclose workload calculations. Reuse directory records and existing enrollment APIs. |
| 9 | **Mobile “no overflow” is insufficient.** At 375px the overview's fixed minimum grid columns clip the call count inside an overflow-hidden card. A test of document width still passes. Large readiness prose pushes the calendar below the first screen. | Information can disappear without a horizontal scrollbar. Phone operation is technically possible but slow. | Every phone use / high | Responsive roster rows, wrapping local navigation, and tests that measure action/row bounds and perform the task at each width. |
| 10 | **Publication state is too coarse.** The editor retains a Published badge after draft edits. A user must understand immutable snapshots to know that the public link still shows the previous version. Dated validation cards already open the relevant day, but that day editor cannot change the resident's availability. | The common “change one call and notify the team” job requires memory and confidence the UI does not supply. | Every published amendment / high | Explain live draft versus public snapshot immediately; retain re-publication, history and existing validation-to-day actions. Follow with actual draft-versus-published difference detection and contextual availability editing. |

## Three worst overall UX decisions

1. A block's identity depends on global selection and inconsistent date interpretation.
2. The app organizes operational work around destinations and data entities rather than a block's preparation-to-publication job.
3. Completion language outruns what is actually measured: time elapsed, resident preparation, rule compliance and publication are presented as broader success than they prove.

## Scenario findings

**A — New program.** Registration avoids irrelevant identity questions and signs the user in automatically. The create-program flow collects organization, specialty and start date, but calls the creation of empty blocks “Generate schedule” and celebrates “You're all set!” before any people or coverage exist. Settings can configure identity, contacts, registries, call types and permissions; there is no guided handoff from those forms to a first schedule. New-program setup requires multiple independent destinations. Keep the useful automatic block creation, replace the misleading promise in a later onboarding batch.

**B — Next block.** Open block → manage residents → open/confirm each resident → return to block → open calendar → discover attending gaps → global attending page → re-find the block/calendar → generate → inspect gaps → manual edit → validate → publish. The existing readiness API is useful; the surrounding navigation prevents it becoming the workflow's spine. Vacation and academic edits share one modal, which should be retained. The seeded sparse roster appropriately leaves calls unfilled rather than relaxing rules.

**C — Small change.** There is no resident search or availability action in the day dialog. The Chief must leave the calendar, find the block roster, open availability, enter the date, return to the correct day, replace the assignment, validate and re-publish. The day editor itself is efficient once reached. A direct overview resident action removes one detour, but calendar-to-availability integration remains the next major improvement.

**D — Off-service arrival.** The durable directory plus explicit per-block participation is the right model. “New rotating resident” creates and enrolls from one dialog, and existing residents can be added without duplicating identity. The difficulty is finding an existing resident and seeing whether they are confirmed for scheduling. Search and direct availability are appropriate; a second resident model is not.

**E — New attending.** Adding the name in Attending Schedule does not offer contact information or activity creation. Settings supports those fields, then the user returns to the weekly pattern and applies it to a block. The “persists across all blocks” hint helps but does not explain this end-to-end job. Daily edit auto-save uses a small colored dot; field naming and saved/error text need further work.

**F — Published amendment.** Documented overrides, publish validation, confirmation, public-link revocation and immutable history are substantial safeguards. They should survive unchanged. The Published badge describes the existence of a snapshot, not equality between that snapshot and the current editor. The interface must say that plainly until a real change comparison is implemented.

## B. Consolidate or demote

- Fold block participation and availability into one **Residents & availability** working destination. Do not create an additional Availability page duplicating the existing editor.
- Fold readiness into the block Overview; a separate readiness destination is unnecessary for this batch.
- Put the existing attending editor inside block navigation. Retain the global shortcut for compatibility and existing workflows.
- Demote call-limit arithmetic behind a disclosure; retain every value and override.
- Keep block rules available as an advanced destination, with an obvious return path.
- Eventually consolidate attending roster creation into one complete editor and make reusable weekly patterns a clearly program-scoped subview.
- Eventually demote generic dashboard metrics and the global block selector on Resident Directory. Do not delete scheduling, exporting, publishing, history or permission capabilities.

## C. Preserve what works

- Durable resident identities, automatic eligible in-service participation and explicit rotating enrollment.
- One modal for a resident's vacation/academic/unavailable information; explicit confirmation before scheduling.
- Day editor prefilled with current assignments; persistence on save/reload; keyboard-operated controls.
- Backend-enforced documented overrides, constraints, and explicit publication acknowledgement.
- Unfilled-slot explanations, dated diagnostic links to the day editor, and progressive disclosure of long diagnostic lists.
- Public snapshots exclude private contacts, preserve history and support revocation.
- Program Settings section-specific saves, unsaved-change protection, inline registry edits, inactive/restore flows and permission enforcement.
- Shared theme tokens and existing contrast/performance checks.

## D. Recommended information architecture

```text
Program
├─ Dashboard: attention across current/upcoming blocks
├─ Scheduling / Blocks
│  └─ Block [date range + publication context]
│     ├─ Overview: readiness, next action, working roster
│     ├─ Residents & availability
│     ├─ Attendings: dates and coverage for this block
│     ├─ Schedule: generate, adjust, validate, publish, history
│     └─ Block rules (advanced)
├─ People
│  ├─ Resident Directory: reusable identity/training/contact records
│  └─ Attendings: reusable roster, activities, weekly patterns
└─ Program administration
   ├─ Settings: identity, specialty, call configuration
   ├─ Members & permissions
   └─ History (restricted)
```

A Block Workspace is superior for ordinary scheduling. A full global navigation rebuild is unnecessary to prove it. Introduce the cohesive block shell and actionable Overview, reuse the existing working pages/APIs, retain global entry routes and avoid a new state store or data model.

## E. Ideal Chief Resident workflow

1. Open the upcoming block once; confirm its dates and draft/publication state.
2. See the highest-priority preparation issue immediately.
3. Search/add the rotating resident from the existing directory; confirm absences and academic time in context.
4. Move directly to this block's attendings, apply the established pattern and fix missing dates.
5. Return to Overview only if desired; otherwise continue directly to Schedule.
6. Generate knowing which preparation warnings remain. Inspect unfilled-slot explanations; do not assume readiness guarantees a complete roster.
7. Edit calls, review rule violations and retain documented exceptions.
8. Publish the reviewed snapshot. Later draft changes require re-publication to update the public schedule.

## Selected batch and measurement contract

**Implement one block-centered preparation workspace:** shared stable header/navigation; exact block identity in links; actionable Overview using existing composition/readiness; direct per-resident availability; searchable block pools; scoped attending route; consistent date-only display; responsive rows and truthful readiness/publication copy.

The measured path starts on an open block with one resident needing confirmation and missing attending entries. Compare the same work: configure that resident, apply the existing attending template, reach calendar ready to generate. Exclude the initial block selection and data-entry clicks when counting page transitions.

Baseline fastest discoverable path: **Manage block residents → Configure → Confirm → back to Block → Open schedule & generate → Open the attending schedule → block in sidebar → Open schedule & generate.** Six page transitions, one backward/hub return after availability plus another after attendings, and two roster-list searches (overview and management). Desktop navigation adds six clicks outside the actual form/template interaction. On phones each sidebar trip adds a menu-opening action. A refresh of global attending loses the selected block.

Target: **Confirm [named resident] from Overview → confirm in the reused availability editor → Attendings → apply template → Schedule.** Two page transitions: availability is edited in place on Overview. No hub/backward return is required, no repeated block choice and no second resident hunt. When already on the resident page, go directly to Attendings then Schedule. Keep the block shell mounted during these section changes.

The point is not two versus six links in isolation. The Overview must identify missing preparation, carry the correct block/year through refresh and direct links, and make the next action obvious. Tests must save availability, verify persistence/scheduler eligibility, apply coverage, and reach generation; merely asserting navigation labels is insufficient.

## Deferred, ranked

1. Calendar-centered absence/change resolution, building on the existing validation-to-day actions.
2. Draft/public snapshot change comparison with explicit unpublished-change indication.
3. Actionable dashboard with truthful current/upcoming and completeness semantics.
4. Unified attending setup, scope explanation, accessible auto-save feedback, and clarified on-call versus any-entry coverage.
5. Vacation range entry, directory search and clean first-program handoff.
6. Remaining setup/accessibility, long membership lists, and diagnostics wording.

No scheduler rules, schema, publication semantics or backend authorization changes are part of this batch.
