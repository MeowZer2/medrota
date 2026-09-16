# MedRota

MedRota is a single-program residency call-scheduling MVP. It helps a Chief Resident maintain a Resident Directory, compose each block roster, confirm availability, generate a PARO-aware draft, make documented exceptions, validate the stored schedule, publish an immutable snapshot, and share or export it.

MedRota provides scheduling assistance; it does not certify legal, contractual, PARO, privacy, or regulatory compliance. It is not PARO certified, PHIPA compliant, HIPAA compliant or production ready. A program must validate current institutional and jurisdictional requirements before real-world use.

Start with **[PRIVATE_BETA_READINESS.md](PRIVATE_BETA_READINESS.md)** for exactly what is and is not supported, what has been verified, and the known risks. **[DEPLOYMENT.md](DEPLOYMENT.md)** covers running it.

## Architecture

- `backend/`: Express 5 API, JWT authentication, permission checks, Prisma 7, PostgreSQL, scheduler/validator, publishing, Excel, and printable HTML.
- `frontend/`: React 19 and Vite application with authenticated program routes plus public `/schedule/:token` routes.
- `backend/prisma/`: schema and additive migrations. Never use a database reset against valued data.

## Local setup

Prerequisites: Node.js, npm, and a local PostgreSQL database.

Install dependencies only when setting up a new checkout:

```bash
cd backend
npm install
cd ../frontend
npm install
```

Copy `backend/.env.example` to `backend/.env` and fill it in. Every variable is documented there. At minimum:

```text
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/medrota?schema=public
JWT_SECRET=replace-with-a-long-local-secret
PORT=3000
```

The server refuses to start without `DATABASE_URL` and `JWT_SECRET`.

Apply existing migrations without resetting data, then start both applications:

```bash
cd backend
npx prisma migrate deploy
npm run dev
```

```bash
cd frontend
npm run dev
```

## Roles

Canonical program roles are `chief_resident`, `program_admin`, `program_director`, and `viewer`. Backend permission checks are authoritative. Chief Residents build schedules; Program Admins and Program Directors can also manage membership and program settings; Viewers have published/read-only access. Program deletion is not part of this MVP.

## Chief Resident workflow

1. **Resident Directory** — maintain program-level identity, classification, optional contact information and training dates. In-service residents are reusable across the program; off-service residents and medical students remain directory records without being copied.
2. **Open a Block** — its Overview identifies the next preparation task. Search *Residents this block* and confirm availability, vacation, unavailable days and academic time directly from a resident's row. Use *Residents & availability* to add reusable rotating residents. Eligible in-service residents appear automatically; off-service residents and medical students are added only to selected blocks.
3. **Attendings** — use the block workspace navigation to build coverage from the roster or a weekly template without selecting the block again.
4. **Schedule** — continue within the same workspace. Overview and Calendar reuse the server's readiness check. Counts describe confirmed availability, vacation periods and days with attending entries; an entry does not necessarily mean on-call coverage, and readiness does not guarantee that generation can fill every call.
5. **Auto-generate**, then adjust individual days. A violating edit needs explicit confirmation and a reason.
6. **Validate** — every violation says who, what date, what rule, why it matters, what to do about it, and whether it was an intentional override. Unfilled slots list which residents were unavailable and why.
7. **Publish** — validation runs first; an unreviewed non-compliant schedule is never published silently. Share the public link, or unpublish or rotate it later.

## Scheduling behavior

- Auto-generation preserves and counts manual overrides, and is idempotent.
- Eligible active in-service residents receive an automatic, unconfirmed `BlockEnrollment`; off-service residents and medical students require explicit enrollment. Unconfirmed availability is excluded with actionable warnings.
- Program start and expected completion dates calculate PGY against the block academic year, with off-cycle anniversary handling. Legacy manual PGY and `residentRole` remain the fallback, and a program-defined junior-PGY set drives automatic junior/senior classification unless a resident has an override.
- Structured recurring academic time supports every weekday and AM, PM or Full day. Full days are hard avoids when academic-day avoidance is enabled; half days produce a review warning because call remains a whole-day model.
- Days on service deducts vacation and other unavailable dates. Workload summaries use the same in-house/home-call PARO helpers and local ceilings as generation and validation.
- Vacation, pre-vacation post-call, consecutive call, call maximum, blended-call, weekend-off, and consecutive home-weekend rules are checked.
- Hard conflicts leave slots unassigned; the generator does not silently relax constraints.
- A violating manual edit requires backend-confirmed violations, explicit confirmation, and a non-empty reason.
- `GET /api/schedule/validate?blockId=...` validates the currently stored draft without mutating it, and explains each unfilled slot.
- Candidate tie-breaking rotates by day so no roster position is permanently favoured.

See `SCHEDULING_RULES_PARO.md` for exact implemented rules and limitations, and `SCHEDULER_ACCEPTANCE_AND_FAIRNESS.md` for measured acceptance and fairness results.

## Publishing and exports

Publishing creates an immutable `ScheduleVersion` snapshot and a random public token. Public schedule, Excel, and printable routes use the latest published snapshot and a privacy-shaped response. Authenticated Excel and Print/PDF exports use the current live draft and are labeled `Draft schedule`. “PDF” is printable HTML intended for the browser's Save as PDF workflow, not server-generated PDF bytes.

Publishing validates the stored schedule first. Documented manual overrides are intentional exceptions and never block; any other violation stops the publish and is shown, and an authorized user can then publish with an explicit acknowledgement.

A published schedule can be **unpublished**, which stops the public link resolving while keeping version history and the draft untouched, or given a **new public link**, which invalidates the previous one. Both are confirmed and audited.

## Theming

MedRota ships a light and a dark theme. The control is in the sidebar (and the
phone header): **Light**, **Match system**, or **Dark**. The choice is stored in
`localStorage` under `medrota-theme`, applies to the login screen as well as the
app, and follows the OS while it is set to *Match system*.

Every colour in the frontend resolves through a design token in
[`frontend/src/styles/theme.css`](frontend/src/styles/theme.css). Nothing else
may hard-code one. That is a structural requirement rather than a style
preference: most of this app is styled with inline `style={{ … }}` objects, and
an inline style cannot be reached by a `.dark .card { … }` override — which is
exactly why an earlier attempt at dark mode ended up applied to some surfaces
and not others. Inline styles *can* read custom properties, so tokens are the
only mechanism that reaches the whole product at once.

The file has two blocks: `:root` (light) and `:root[data-theme="dark"]`, plus a
deliberate `@media print` palette so an exported schedule prints as ink on paper
regardless of the theme on screen. There is no `prefers-color-scheme` block —
`frontend/src/context/ThemeContext.jsx` resolves the stored preference to an
explicit `data-theme` attribute before the first paint (a small inline script in
`index.html` does this pre-hydration, so there is no flash), which keeps the
palette in exactly two places.

Working on the frontend:

- use a token, never a literal — `var(--surface-1)`, not `#fff` or `white`;
- match the token to the property. `--ink-*` and `*-ink` are text, `--surface-*`
  / `--border-*` / `*-soft` are fills. `#1A3A5C` is `--ink-1` as a `color` and
  `--brand` as a `background`, and those two diverge in dark;
- text drawn on a solid fill takes that fill's `--on-*` token;
- for Tailwind, use the token-backed utilities (`bg-surface-1`, `text-on-solid`,
  `border-hairline`) declared in the `@theme` block in `frontend/src/index.css`.
  Literal utilities such as `bg-white` cannot be themed.

Both themes are held to WCAG 2.1 AA — 4.5:1 for normal text, 3:1 for large text
and for the boundary that identifies a control. There are no theme-specific
exemptions: the light ramp was re-spaced so it meets the same bar as dark, rather
than being graded on a curve against it.

Two guards enforce this, and both run in CI:

```bash
cd frontend
npm run theme:guard        # both checks
npm run theme:tokens       # no colour literals; tokens used in the right role
npm run theme:contrast     # WCAG AA across both themes, and dark never worse than light
```

`theme:tokens` also rejects named CSS colours and undefined tokens. A colour that
genuinely must be a literal — a value persisted as user data, such as the day-flag
presets — is opted out explicitly between `theme-guard-allow-start` /
`theme-guard-allow-end` comments with a stated reason.

Two Playwright specs cover what a token check cannot see:

- `e2e/theme.spec.js` loads every authenticated page and the calendar day dialog
  in dark and fails on any large light fill or unreadable text.
- `e2e/contrast.spec.js` measures what the browser actually paints — every text
  node against the background it is really composited onto, and every form
  control boundary against the surface around it — in both themes, failing on
  anything below AA. The light theme rendered about 280 failing text nodes before
  this existed; that count is zero now, and this is what holds it there.

Two notes on the ink ramp, since both look like mistakes otherwise. AA on a
near-white ground leaves only the band between roughly 40% and 47% lightness for
"quieter than body copy", so `--ink-4` and `--ink-5` sit closer together than
they used to; hierarchy below body copy is carried by size, weight and case as
much as by colour. And `--ink-6` and `--ink-disabled` are gone: neither could be
made legible while staying distinct from `--ink-5`, and `--ink-disabled` was not
describing disabled controls at all — it styled "Unassigned", "No entries" and
other text that carries meaning. Disabled controls are dimmed with `opacity`,
which is untouched.

## Audit trail

Scheduling and administrative changes are recorded in an append-only `AuditEvent` table: who, what changed, and when. Passwords, hashes, tokens and request bodies are never stored. Program Admins and Directors see the full history in Program Settings; Chief Residents see scheduling history for a block on the Calendar; Viewers see none.

## QA and validation

The local QA seed is development-only and deterministic:

```bash
cd backend
npm run dev:seed-qa
```

Core backend checks:

```bash
npm run roles:audit
npm run roles:smoke
npm run authz:smoke
npm run phase5:smoke
npm run phase5:db
npm run phase6:smoke
npm run paro:smoke
npm run scheduler:integration
npm run scheduler:acceptance
npm run schedule:validate-smoke
npm run data:integrity-smoke
npm run availability:smoke
npm run resident:workflow-smoke
npm run publish:safety-smoke
npm run publish:revocation-smoke
npm run audit:smoke
npm run deploy:smoke
npx prisma validate --schema prisma/schema.prisma
```

Reporting tools, both read-only:

```bash
npm run data:integrity-audit     # scheduling data integrity; prints no resident names by default
npm run scheduler:fairness       # call distribution and roster-order bias
```

Frontend checks:

```bash
cd frontend
npm run perf:guard
npm run lint
npm run build
npm run e2e
```

Install Chromium once if needed with `npx playwright install chromium`. See `LOCAL_QA.md` for QA identities and the Windows local-server reuse procedure.

Continuous integration runs the same checks on every push and pull request; see `.github/workflows/ci.yml`.

## Program configuration

MedRota keeps two separate program identity fields: **Program display name** is the local name shown throughout the product, while **Primary specialty** is the program's medical specialty/category. Existing `Program.name` and `Program.specialty` data remain unchanged; the update clarifies their labels rather than migrating values.

Program Settings is organised into sections — General, Clinical Structure, Attendings, Scheduling, Access & Permissions, and History — navigated by a side-nav on desktop and a scrolling tab strip on narrow screens. The active section is reflected in a `?tab=` query parameter, so a refresh or a return to the page keeps it.

Section navigation uses `replace`, not `push`. Clicking through six sections should not build a history stack the user has to unwind to leave the page, and Back from Settings goes back to the page they came from. The section still survives a refresh, a bookmark and a shared link, because it lives in the URL either way. The one case that does add an entry is leaving a section with unsaved edits, where the warning below parks a history entry to catch the Back press.

Each section saves itself. General persists the program name and specialty; Scheduling persists the call-type flags. `PUT /api/programs/:id` applies exactly the fields a payload carries, so one section can never write another section’s values — including values typed into it and never saved.

A section with unsaved edits warns before those edits are lost: changing section, following a sidebar link, pressing Back, or reloading or closing the tab. The warning reads “You have unsaved changes. Discard them?”, appears only when something actually differs from what is stored, and stops appearing once the section is saved.

Two of those sections hold optional program-defined registries: **Clinical services** and **Attending activities**. Neither is populated from a hard-coded specialty tree. Activity types drive weekly attending-pattern selectors, while stored activity text remains on historical schedules after an activity is renamed or deactivated. The persistent attending roster also supports optional email, phone, and office/location; contact details are excluded from public schedule responses.

Registry rows edit in place. A changed name shows Save and Cancel together; Escape restores the stored value; a blank name cannot be saved; and a rejected save (a duplicate name, for instance) keeps the row in edit state with the typed text intact rather than discarding it. Attending roster rows edit name, email, phone and office/location behind an Edit control on the row.

Deactivating a roster entry, an activity type or a clinical service takes it out of the default list and out of the selectors used to build new schedules, without deleting it or the history that references it. Each list shows how many active records it holds and, only when there are any, a `Show inactive (n)` disclosure that reveals the deactivated records with a Restore action. Deactivated records are a review-and-restore list rather than a working one, so they are sorted by name, ten are rendered at a time behind a `Show all` control, and a filter appears once there is more than one page of them. Active rosters are never paged.

The canonical roles remain Program Admin, Program Director, Chief Resident, and Viewer. Admins and Directors always resolve to full program-management access, and Viewers always remain read-only. Admins and Directors may configure a bounded canonical set of Chief Resident operational permissions. `manage_scheduling_rules` is included for the future rule builder, but this release does not add that builder.

## Resident and block model

The block workspace keeps a shared header and navigation across Overview, Residents & availability, Attendings and Schedule. New links include the block's stable ID (`/blocks/2/attending?blockId=...`) so a refresh or link opened in another session identifies the same block across academic years. Existing numbered URLs remain supported in the selected academic year. Invalid or mismatched block links show an error instead of silently opening a different block. Block boundaries are displayed as calendar dates, without a timezone shift.

The workspace distinguishes the editable draft from an existing published snapshot: changes reach the public schedule only after re-publication. This explanation does not imply that a draft/snapshot difference comparison has been implemented. Block rules and workload calculations remain available behind disclosures. See [WORKFLOW_UX_AUDIT.md](WORKFLOW_UX_AUDIT.md) for the pre-implementation audit and [WORKFLOW_UX_RESULTS.md](WORKFLOW_UX_RESULTS.md) for the measured workflow and validation results.

`ResidentProfile` is the durable program directory record; `BlockEnrollment` is participation and availability for one block. Adding someone to a block never creates another person. In-service residents are automatically attached only to blocks overlapping their active training window. Changing dates or deactivating a resident updates safe future automatic participation, while historical enrollments, assignments and published snapshots remain readable and are never silently rewritten.

Off-service residents can store a free-text home program/specialty and be reused in later blocks. Medical students follow the same explicit block-enrollment rule and use one canonical **Medical Student** badge. Optional resident email and phone are private authenticated-directory fields and are excluded from public schedules.

Resident names are shaped centrally for schedules and exports: a unique surname is `Dr. Smith`, duplicate surnames use first initials, and duplicate initials expand to full names with a non-private fallback if still needed. Removing an off-service resident or medical student from a block is refused while assignments remain. Resident creation, profile/training changes, enrollment changes and block availability changes are permission checked and written to the append-only audit trail without contact values.

## Current limitations

- MVP scope is one active program per user experience, although backend resources are program-isolated.
- Generation is greedy, not optimal. Roster order can still shift a small number of calls between individuals.
- Vacation and explicit other-unavailable dates reduce days on service; recurring academic time does not, because half-day impact has no defined call rule.
- Half-day academic time is warning/preference information only while call is modeled at whole-day granularity.
- Multi-month averaging, shift-work rules, emergency coverage, formal exception approval, swaps, notifications, and server-generated PDFs are deferred.
- The Vite build reports a main-chunk warning above 500 kB; optimize only after measurement or a deployment requirement.
