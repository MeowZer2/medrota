import { expect, test } from '@playwright/test';
import { ownedName } from './qa-records.js';

// Program Settings section navigation plus the active/inactive lifecycle of the
// attending roster and the attending activity registry.
//
// The reachability test at the bottom is the regression guard for the bug that
// motivated this work: the action button used to be laid out past the right
// edge of a card with overflow:hidden, so no pointer could reach it. Playwright's
// own click() hides that, because it scrolls a clipping container programmatically
// before clicking. Only a hit test at the button's own coordinates catches it.

const PASSWORD = 'QA_only_password_123!';
test.describe.configure({ mode: 'serial' });

async function login(page, email, target = '/settings') {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#lg-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/dashboard|\/setup/, { timeout: 20_000 });
  await page.goto(target);
}

async function api(page, path, options = {}) {
  return page.evaluate(async ({ path, options }) => {
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { path, options });
}

// Is this control actually reachable with a pointer?
//
// Scrolling first is legitimate, but only through containers a user can really
// scroll. Any ancestor whose overflow-x is hidden/clip/visible gets its
// scrollLeft reset, because a person has no way to move it. Without that reset
// both scrollIntoView() and Playwright's own click() quietly scroll an
// overflow:hidden box and report success on a control nobody can press.
const POINTER_REACHABLE = (button) => {
  button.scrollIntoView({ block: 'center', inline: 'nearest' });
  for (let node = button.parentElement; node && node !== document.documentElement; node = node.parentElement) {
    const overflowX = getComputedStyle(node).overflowX;
    if (overflowX !== 'auto' && overflowX !== 'scroll') node.scrollLeft = 0;
  }
  const rect = button.getBoundingClientRect();
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  const hit = x >= 0 && x <= window.innerWidth ? document.elementFromPoint(x, y) : null;
  return {
    reachable: Boolean(hit) && (hit === button || button.contains(hit)),
    hitTag: hit ? hit.tagName : null,
    rect: { x: Math.round(rect.x), right: Math.round(rect.right) },
    viewportWidth: window.innerWidth,
  };
};

// The QA program accumulates deactivated records across specs, so every count
// assertion is relative. Waiting on the summary line first guarantees the
// registry has loaded before the disclosure is read.
async function inactiveCount(page, noun) {
  await expect(page.getByText(new RegExp(`^\\d+ active ${noun}$`))).toBeVisible();
  const toggle = page.getByRole('button', { name: new RegExp(`^Show inactive ${noun} \\(\\d+\\)$`) });
  if (await toggle.count() === 0) return 0;
  return Number((await toggle.textContent()).match(/\((\d+)\)/)[1]);
}

test('program settings is divided into navigable sections that survive a refresh', async ({ page }) => {
  await login(page, 'qa-admin@medrota.local');
  await expect(page.getByRole('heading', { name: 'Program Settings' })).toBeVisible();

  const tablist = page.getByRole('tablist', { name: 'Program settings sections' });
  await expect(tablist).toBeVisible();

  // General is the default section and the program identity fields live there.
  await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Program display name')).toBeVisible();
  await expect(page.getByLabel('Primary specialty')).toBeVisible();

  const sections = [
    { tab: 'Clinical Structure', expect: () => page.getByRole('heading', { name: 'Clinical services' }) },
    { tab: 'Attendings', expect: () => page.getByRole('heading', { name: 'Attending roster' }) },
    { tab: 'Scheduling', expect: () => page.getByRole('checkbox', { name: /Junior in-house call/i }) },
    { tab: 'Access & Permissions', expect: () => page.getByRole('heading', { name: 'Team Members' }) },
    { tab: 'History', expect: () => page.getByRole('heading', { name: 'Published Versions' }) },
  ];

  for (const section of sections) {
    await page.getByRole('tab', { name: section.tab }).click();
    await expect(page.getByRole('tab', { name: section.tab })).toHaveAttribute('aria-selected', 'true');
    await expect(section.expect()).toBeVisible();
    // Switching sections must not leave the program identity fields rendered.
    await expect(page.getByLabel('Program display name')).toHaveCount(0);
  }

  // The active section is reflected in the URL, so a refresh keeps it.
  await page.getByRole('tab', { name: 'Attendings' }).click();
  await expect(page).toHaveURL(/[?&]tab=attendings/);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('tab', { name: 'Attendings' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Attending roster' })).toBeVisible();

  // An unknown section falls back to the first one rather than rendering nothing.
  await page.goto('/settings?tab=not-a-section');
  await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Program display name')).toBeVisible();
});

test('an attending leaves the active roster when deactivated and returns when restored', async ({ page }) => {
  const attendingName = ownedName('Lifecycle Attending');
  await login(page, 'qa-admin@medrota.local', '/settings?tab=attendings');
  await expect(page.getByRole('heading', { name: 'Attending roster' })).toBeVisible();

  await page.locator('#new-attending-attendingName').fill(attendingName);
  await page.locator('#new-attending-email').fill('lifecycle@example.invalid');
  await page.getByRole('button', { name: 'Add attending' }).click();
  await expect(page.getByText(attendingName, { exact: true })).toBeVisible();

  const beforeCount = await inactiveCount(page, 'attendings');

  await page.getByRole('button', { name: `Deactivate ${attendingName}` }).click();

  // Gone from the default view entirely, not greyed out inside it.
  await expect(page.getByText(attendingName, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Restore ${attendingName}` })).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Show inactive attendings (${beforeCount + 1})` })).toBeVisible();

  // The active summary and the disclosure describe the same registry.
  await expect(page.getByText(/^\d+ active attendings$/)).toBeVisible();

  await page.getByRole('button', { name: `Show inactive attendings (${beforeCount + 1})` }).click();
  await expect(page.getByText(attendingName, { exact: true })).toBeVisible();
  const restore = page.getByRole('button', { name: `Restore ${attendingName}` });
  await expect(restore).toBeVisible();
  await expect(restore).toBeEnabled();

  await restore.click();
  await expect(page.getByRole('button', { name: `Deactivate ${attendingName}` })).toBeVisible();
  await expect(page.getByText(attendingName, { exact: true })).toBeVisible();

  // Restored staff are selectable again on the attending schedule.
  await page.goto('/attending');
  await page.getByRole('button', { name: /Attending Roster & Weekly Pattern/i }).click();
  await expect(page.getByText(attendingName, { exact: true }).first()).toBeVisible();

  // Leave the QA program tidy.
  await page.goto('/settings?tab=attendings');
  await page.getByRole('button', { name: `Deactivate ${attendingName}` }).click();
  await expect(page.getByText(attendingName, { exact: true })).toHaveCount(0);
});

test('an attending activity leaves the active list when deactivated and returns when restored', async ({ page }) => {
  const activityName = ownedName('Lifecycle Activity');
  await login(page, 'qa-admin@medrota.local', '/settings?tab=attendings');

  await page.getByLabel('New attending activity').fill(activityName);
  await page.getByRole('button', { name: 'Add activity' }).click();
  await expect(page.getByLabel(`${activityName} name`)).toBeVisible();

  // An active activity is offered for new attending schedule entries.
  await page.goto('/attending');
  await page.getByRole('button', { name: /Attending Roster & Weekly Pattern/i }).click();
  await expect(page.locator('select').filter({ has: page.locator(`option[value="${activityName}"]`) }).first()).toBeVisible();

  await page.goto('/settings?tab=attendings');
  const beforeCount = await inactiveCount(page, 'activities');

  await page.getByRole('button', { name: `Deactivate ${activityName}` }).click();
  await expect(page.getByLabel(`${activityName} name`)).toHaveCount(0);
  await expect(page.getByText(/^\d+ active activities$/)).toBeVisible();

  const showInactive = page.getByRole('button', { name: `Show inactive activities (${beforeCount + 1})` });
  await expect(showInactive).toBeVisible();

  // A deactivated activity is no longer offered for new schedule entries.
  await page.goto('/attending');
  await page.getByRole('button', { name: /Attending Roster & Weekly Pattern/i }).click();
  await expect(page.locator(`option[value="${activityName}"]`)).toHaveCount(0);

  await page.goto('/settings?tab=attendings');
  await page.getByRole('button', { name: `Show inactive activities (${beforeCount + 1})` }).click();
  const restore = page.getByRole('button', { name: `Restore ${activityName}` });
  await expect(restore).toBeVisible();
  await expect(restore).toBeEnabled();
  await restore.click();

  await expect(page.getByRole('button', { name: `Deactivate ${activityName}` })).toBeVisible();

  // Restored activities are selectable again.
  await page.goto('/attending');
  await page.getByRole('button', { name: /Attending Roster & Weekly Pattern/i }).click();
  await expect(page.locator('select').filter({ has: page.locator(`option[value="${activityName}"]`) }).first()).toBeVisible();

  await page.goto('/settings?tab=attendings');
  await page.getByRole('button', { name: `Deactivate ${activityName}` }).click();
  await expect(page.getByLabel(`${activityName} name`)).toHaveCount(0);
});

test('a chief resident sees only the sections their permissions allow', async ({ page }) => {
  await login(page, 'qa-chief@medrota.local');
  await expect(page.getByRole('heading', { name: 'Program Settings' })).toBeVisible();

  // No manage_users and no configure_role_permissions, so no access section.
  await expect(page.getByRole('tab')).toHaveText(['General', 'Clinical Structure', 'Attendings', 'Scheduling', 'History']);
  await expect(page.getByRole('tab', { name: 'Access & Permissions' })).toHaveCount(0);

  // Program identity stays visible but read-only for a Chief Resident.
  await expect(page.getByLabel('Program display name')).toBeDisabled();

  // Naming a hidden section in the URL must not render it.
  await page.goto('/settings?tab=access');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Team Members' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Role permissions' })).toHaveCount(0);

  // The registries a Chief Resident does manage stay available.
  await page.goto('/settings?tab=attendings');
  await expect(page.getByRole('heading', { name: 'Attending roster' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Attending activities' })).toBeVisible();
});

test('a viewer cannot reach or mutate either registry', async ({ page }) => {
  await login(page, 'qa-admin@medrota.local', '/settings?tab=attendings');
  const mine = await api(page, '/programs/mine');
  const programId = mine.body.programId;
  const activities = await api(page, `/program-configuration/${programId}/attending-activities`);
  const roster = await api(page, `/attending/roster?programId=${programId}&includeInactive=true`);
  const activityId = activities.body[0]?.id;
  const rosterId = roster.body[0]?.id;
  expect(activityId, 'QA program has at least one activity type').toBeTruthy();
  expect(rosterId, 'QA program has at least one roster entry').toBeTruthy();

  await login(page, 'qa-viewer@medrota.local', '/settings');
  await expect(page.getByText('You do not have access to program configuration.')).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Deactivate/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Restore/ })).toHaveCount(0);

  expect((await api(page, `/program-configuration/${programId}/attending-activities/${activityId}`, { method: 'PUT', body: JSON.stringify({ isActive: false }) })).status).toBe(403);
  expect((await api(page, `/attending/roster/${rosterId}`, { method: 'PUT', body: JSON.stringify({ isActive: false }) })).status).toBe(403);
  expect((await api(page, `/attending/roster/${rosterId}`, { method: 'DELETE' })).status).toBe(403);
});

// Regression guard for the unclickable Restore control.
for (const width of [375, 768, 1280]) {
  test(`registry actions are reachable by pointer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    const attendingName = ownedName('Reachability Dr Alexander Montgomery');
    await login(page, 'qa-admin@medrota.local', '/settings?tab=attendings');

    await page.locator('#new-attending-attendingName').fill(attendingName);
    await page.locator('#new-attending-email').fill('a.very.long.mailbox.name@teaching-hospital.example.org');
    await page.locator('#new-attending-officeLocation').fill('Ambulatory Care Centre, Level 3');
    await page.getByRole('button', { name: 'Add attending' }).click();
    await expect(page.getByText(attendingName, { exact: true })).toBeVisible();

    const deactivateReach = await page.getByRole('button', { name: `Deactivate ${attendingName}` }).evaluate(POINTER_REACHABLE);
    expect(deactivateReach.reachable, `Deactivate is reachable at ${width}px (got ${JSON.stringify(deactivateReach)})`).toBe(true);

    await page.getByRole('button', { name: `Deactivate ${attendingName}` }).click();
    await page.getByRole('button', { name: /^Show inactive attendings/ }).click();

    const restoreReach = await page.getByRole('button', { name: `Restore ${attendingName}` }).evaluate(POINTER_REACHABLE);
    expect(restoreReach.reachable, `Restore is reachable at ${width}px (got ${JSON.stringify(restoreReach)})`).toBe(true);

    // And a real pointer press, not a synthetic one, restores the record.
    await page.getByRole('button', { name: `Restore ${attendingName}` }).click();
    await expect(page.getByRole('button', { name: `Deactivate ${attendingName}` })).toBeVisible();

    // Leave the record deactivated. The inactive group is still open, so the
    // row stays on screen under it rather than disappearing.
    await page.getByRole('button', { name: `Deactivate ${attendingName}` }).click();
    await expect(page.getByRole('button', { name: `Restore ${attendingName}` })).toBeVisible();
  });
}

// -- Inline editing -----------------------------------------------------------
//
// Renaming used to be a one-way door: a Save button appeared once the text
// changed, with no Cancel, and Escape did nothing. The only way back to the
// stored name was to remember it and retype it.

test('renaming an activity offers Save and Cancel, reverts on Escape, and refuses a blank name', async ({ page }) => {
  const activityName = ownedName('Rename Activity');
  const renamed = `${activityName} Renamed`;
  await login(page, 'qa-admin@medrota.local', '/settings?tab=attendings');

  await page.getByLabel('New attending activity').fill(activityName);
  await page.getByRole('button', { name: 'Add activity' }).click();
  const field = page.getByLabel(`${activityName} name`);
  await expect(field).toBeVisible();

  // An untouched row is not in edit state, so it offers neither control.
  await expect(page.getByRole('button', { name: `Save ${activityName}` })).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Cancel editing ${activityName}` })).toHaveCount(0);

  await field.fill(renamed);
  await expect(page.getByRole('button', { name: `Save ${activityName}` })).toBeVisible();
  await expect(page.getByRole('button', { name: `Cancel editing ${activityName}` })).toBeVisible();

  // Escape restores the stored name, from the keyboard alone.
  await field.press('Escape');
  await expect(field).toHaveValue(activityName);
  await expect(page.getByRole('button', { name: `Save ${activityName}` })).toHaveCount(0);

  // Cancel does the same for a pointer.
  await field.fill(renamed);
  await page.getByRole('button', { name: `Cancel editing ${activityName}` }).click();
  await expect(field).toHaveValue(activityName);

  // A blank name is never savable, and saying so keeps the row in edit state.
  await field.fill('   ');
  await expect(page.getByText('A name is required.')).toBeVisible();
  await expect(page.getByRole('button', { name: `Save ${activityName}` })).toBeDisabled();

  // A real rename saves and leaves edit state behind.
  await field.fill(renamed);
  await page.getByRole('button', { name: `Save ${activityName}` }).click();
  await expect(page.getByLabel(`${renamed} name`)).toBeVisible();
  await expect(page.getByRole('button', { name: `Save ${renamed}` })).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Cancel editing ${renamed}` })).toHaveCount(0);

  // A rejected rename explains itself and keeps the typed text on screen.
  const renamedField = page.getByLabel(`${renamed} name`);
  await renamedField.fill('Clinic');
  await page.getByRole('button', { name: `Save ${renamed}` }).click();
  await expect(page.getByText(/already exists in this program/)).toBeVisible();
  await expect(renamedField, 'a refused rename keeps the edit alive').toHaveValue('Clinic');
  await renamedField.press('Escape');
  await expect(renamedField).toHaveValue(renamed);

  // Tidy-up goes through the API: the error toast is still sitting over the
  // bottom-right of the page, and deactivating from the UI is covered above.
  const programId = (await api(page, '/programs/mine')).body.programId;
  const stored = (await api(page, `/program-configuration/${programId}/attending-activities`)).body.find(item => item.name === renamed);
  expect(stored, 'the renamed activity is the one that was stored').toBeTruthy();
  await api(page, `/program-configuration/${programId}/attending-activities/${stored.id}`, { method: 'PUT', body: JSON.stringify({ isActive: false }) });
});

test('an attending row edits in place, cancels on Escape, and refuses a blank name', async ({ page }) => {
  const attendingName = ownedName('Editable Attending');
  const editedName = `${attendingName} Edited`;
  await login(page, 'qa-admin@medrota.local', '/settings?tab=attendings');

  await page.locator('#new-attending-attendingName').fill(attendingName);
  await page.locator('#new-attending-phone').fill('555-0100');
  await page.getByRole('button', { name: 'Add attending' }).click();
  await expect(page.getByText(attendingName, { exact: true })).toBeVisible();

  // Escape abandons the editor without writing anything.
  await page.getByRole('button', { name: `Edit ${attendingName}` }).click();
  const editor = page.getByTestId('roster-edit');
  await editor.getByLabel('Office / location').fill('Level 9');
  await editor.getByLabel('Office / location').press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(page.getByText('Level 9')).toHaveCount(0);

  // So does Cancel.
  await page.getByRole('button', { name: `Edit ${attendingName}` }).click();
  await page.getByTestId('roster-edit').getByLabel('Phone').fill('555-0199');
  await page.getByRole('button', { name: `Cancel editing ${attendingName}` }).click();
  await expect(page.getByTestId('roster-edit')).toHaveCount(0);
  await expect(page.getByText('555-0100')).toBeVisible();

  // A blank name cannot be saved.
  await page.getByRole('button', { name: `Edit ${attendingName}` }).click();
  const reopened = page.getByTestId('roster-edit');
  await reopened.getByLabel('Name').fill('   ');
  await expect(page.getByRole('button', { name: `Save ${attendingName}` })).toBeDisabled();

  // A real edit saves the whole row and closes the editor.
  await reopened.getByLabel('Name').fill(editedName);
  await reopened.getByLabel('Phone').fill('555-0123');
  await page.getByRole('button', { name: `Save ${attendingName}` }).click();
  await expect(page.getByTestId('roster-edit')).toHaveCount(0);
  await expect(page.getByText(editedName, { exact: true })).toBeVisible();
  await expect(page.getByText('555-0123')).toBeVisible();

  await page.getByRole('button', { name: `Deactivate ${editedName}` }).click();
  await expect(page.getByText(editedName, { exact: true })).toHaveCount(0);
});

// This one runs last on purpose: it fills the inactive activity list past a
// page, which is exactly the state the other tests should not have to work in.
test('a long inactive list is sorted, capped, searchable and expandable', async ({ page }) => {
  await login(page, 'qa-admin@medrota.local', '/settings?tab=attendings');
  const programId = (await api(page, '/programs/mine')).body.programId;

  const base = ownedName('Paged Activity');
  const created = [];
  for (let index = 1; index <= 12; index += 1) {
    const name = `${base} ${String(index).padStart(2, '0')}`;
    const post = await api(page, `/program-configuration/${programId}/attending-activities`, { method: 'POST', body: JSON.stringify({ name }) });
    expect(post.status, `created ${name}`).toBe(201);
    await api(page, `/program-configuration/${programId}/attending-activities/${post.body.id}`, { method: 'PUT', body: JSON.stringify({ isActive: false }) });
    created.push({ id: post.body.id, name });
  }

  try {
    await page.goto('/settings?tab=attendings');
    const toggle = page.getByRole('button', { name: /^Show inactive activities \(\d+\)$/ });
    await expect(toggle).toBeVisible();
    const total = Number((await toggle.textContent()).match(/\((\d+)\)/)[1]);
    expect(total, 'the disclosure counts every deactivated activity').toBeGreaterThanOrEqual(12);
    await toggle.click();

    const group = page.getByTestId('inactive-activities');
    await expect(group.getByText(`Showing 10 of ${total} inactive activities`)).toBeVisible();

    // Sorted by name, so which records land on the first page is predictable.
    const shown = await group.locator('input[aria-label$=" name"]').evaluateAll(nodes => nodes.map(node => node.value));
    expect(shown, 'one page of rows is rendered').toHaveLength(10);
    expect(shown).toEqual([...shown].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));

    // The rest are reachable rather than rendered by default.
    const last = created[created.length - 1].name;
    await expect(group.getByLabel(`${last} name`)).toHaveCount(0);
    await group.getByRole('button', { name: `Show all ${total} inactive activities` }).click();
    await expect(group.getByLabel(`${last} name`)).toBeVisible();

    // Search narrows the group, and Restore still works from inside it.
    await group.getByLabel('Search inactive activities').fill(last);
    await expect(group.getByText('Showing 1 of 1 inactive activities')).toBeVisible();
    await group.getByRole('button', { name: `Restore ${last}` }).click();
    await expect(page.getByRole('button', { name: `Deactivate ${last}` })).toBeVisible();
  } finally {
    // Restore the QA registry to its pre-test shape. The global teardown then
    // deletes these records outright.
    for (const item of created) {
      await api(page, `/program-configuration/${programId}/attending-activities/${item.id}`, { method: 'PUT', body: JSON.stringify({ isActive: true }) });
    }
  }
});
