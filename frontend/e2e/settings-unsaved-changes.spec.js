import { expect, test } from '@playwright/test';

// Two behaviours that used to be wrong together in Program Settings.
//
// 1. Each section showed its own Save, but every Save sent all four program
//    fields. Whichever section you saved from published the other section's
//    on-screen values too, including ones you had typed and never saved.
// 2. Moving between sections threw unsaved edits away without a word.
//
// The rules pinned down here: a Save persists only its own section, and
// anything that would drop unsaved work asks first - with one wording, and with
// no prompt at all when nothing has changed.

const PASSWORD = 'QA_only_password_123!';
const DISCARD_PROMPT = 'You have unsaved changes. Discard them?';

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
  await page.waitForLoadState('networkidle');
}

// Collects every confirm the page raises and answers each one the same way.
// Returns the list so a test can assert on the wording, or on silence.
function watchDialogs(page, { accept }) {
  const messages = [];
  page.on('dialog', async dialog => {
    messages.push(dialog.message());
    if (accept) await dialog.accept();
    else await dialog.dismiss();
  });
  return messages;
}

async function savedProgram(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/programs/mine', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    const body = await response.json();
    return { name: body.programName, specialty: body.specialty, junior: body.juniorInHouseCall, senior: body.seniorInHouseCall };
  });
}

test('each section saves only its own fields', async ({ page }) => {
  await login(page, 'qa-admin@medrota.local');
  const original = await savedProgram(page);

  try {
    // Scheduling is edited and saved while General holds a value that was never
    // saved. The Scheduling Save must not publish it.
    const abandonedName = `${original.name} NEVER SAVED`;
    await page.getByLabel('Program display name').fill(abandonedName);

    const discardOnSwitch = watchDialogs(page, { accept: true });
    await page.getByRole('tab', { name: 'Scheduling' }).click();
    expect(discardOnSwitch).toEqual([DISCARD_PROMPT]);

    const juniorCall = page.getByLabel(/Junior in-house call/);
    const juniorBefore = await juniorCall.isChecked();
    await juniorCall.setChecked(!juniorBefore);
    const schedulingSave = page.waitForResponse(response => response.url().includes('/api/programs/') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save call configuration' }).click();
    await schedulingSave;
    await expect(page.getByText('Call configuration saved')).toBeVisible();

    const afterScheduling = await savedProgram(page);
    expect(afterScheduling.junior, 'Scheduling saved its own toggle').toBe(!juniorBefore);
    expect(afterScheduling.name, 'the abandoned General edit was never written').toBe(original.name);
    expect(afterScheduling.specialty).toBe(original.specialty);

    // And the other way round: General saves identity without touching call types.
    await page.getByRole('tab', { name: 'General' }).click();
    await page.getByLabel('Program display name').fill(`${original.name} Renamed`);
    const generalSave = page.waitForResponse(response => response.url().includes('/api/programs/') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save program details' }).click();
    await generalSave;
    await expect(page.getByText('Program details saved')).toBeVisible();

    const afterGeneral = await savedProgram(page);
    expect(afterGeneral.name).toBe(`${original.name} Renamed`);
    expect(afterGeneral.junior, 'General left the call types alone').toBe(!juniorBefore);
    expect(afterGeneral.senior).toBe(original.senior);
  } finally {
    // Restore the QA program exactly as it was found.
    await page.evaluate(async ({ original }) => {
      const token = localStorage.getItem('token');
      const mine = await (await fetch('/api/programs/mine', { headers: { Authorization: `Bearer ${token}` } })).json();
      await fetch(`/api/programs/${mine.programId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: original.name, specialty: original.specialty, juniorInHouseCall: original.junior, seniorInHouseCall: original.senior }),
      });
    }, { original });
  }
});

test('switching sections with unsaved edits asks first and honours the answer', async ({ page }) => {
  await login(page, 'qa-admin@medrota.local');
  const original = await savedProgram(page);
  const edited = `${original.name} Draft`;

  const declined = watchDialogs(page, { accept: false });
  await page.getByLabel('Program display name').fill(edited);
  await page.getByRole('tab', { name: 'Scheduling' }).click();

  expect(declined, 'the warning uses the agreed wording').toEqual([DISCARD_PROMPT]);
  await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Program display name'), 'declining keeps the edit').toHaveValue(edited);

  // Accepting moves on and throws the edit away rather than carrying it along.
  page.removeAllListeners('dialog');
  const accepted = watchDialogs(page, { accept: true });
  await page.getByRole('tab', { name: 'Scheduling' }).click();
  expect(accepted).toEqual([DISCARD_PROMPT]);
  await expect(page.getByRole('tab', { name: 'Scheduling' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('tab', { name: 'General' }).click();
  await expect(page.getByLabel('Program display name'), 'the discarded edit is gone').toHaveValue(original.name);
  expect((await savedProgram(page)).name, 'nothing was written').toBe(original.name);
});

test('an unchanged section never warns, and a saved one stops warning', async ({ page }) => {
  await login(page, 'qa-admin@medrota.local');
  const original = await savedProgram(page);
  const dialogs = watchDialogs(page, { accept: true });

  // Nothing typed: every section is reachable in silence.
  for (const tab of ['Clinical Structure', 'Attendings', 'Scheduling', 'Access & Permissions', 'History', 'General']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }
  expect(dialogs, 'no warning without a change').toEqual([]);

  // Typing the stored value back is not a change either.
  await page.getByLabel('Program display name').fill(`${original.name} temp`);
  await page.getByLabel('Program display name').fill(original.name);
  await page.getByRole('tab', { name: 'Scheduling' }).click();
  expect(dialogs, 'restoring the original value clears the dirty state').toEqual([]);

  // After a successful save the section is clean again.
  await page.getByRole('tab', { name: 'General' }).click();
  await page.getByLabel('Program display name').fill(`${original.name} Saved`);
  const save = page.waitForResponse(response => response.url().includes('/api/programs/') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save program details' }).click();
  await save;
  await expect(page.getByText('Program details saved')).toBeVisible();

  await page.getByRole('tab', { name: 'Scheduling' }).click();
  await expect(page.getByRole('tab', { name: 'Scheduling' })).toHaveAttribute('aria-selected', 'true');
  expect(dialogs, 'a saved section does not warn').toEqual([]);

  await page.getByRole('tab', { name: 'General' }).click();
  await page.getByLabel('Program display name').fill(original.name);
  const restore = page.waitForResponse(response => response.url().includes('/api/programs/') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save program details' }).click();
  await restore;
});

test('leaving the page warns: sidebar, browser Back, and the browser unload prompt', async ({ page }) => {
  await login(page, 'qa-admin@medrota.local');
  const original = await savedProgram(page);
  const edited = `${original.name} Draft`;

  // Nothing typed yet, so the browser's own unload prompt stays disarmed.
  const armedWhenClean = await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })) === false);
  expect(armedWhenClean, 'a clean page does not block unload').toBe(false);

  await page.getByLabel('Program display name').fill(edited);

  const armedWhenDirty = await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })) === false);
  expect(armedWhenDirty, 'unsaved edits arm the browser unload prompt').toBe(true);

  // In-app navigation from the sidebar asks before leaving.
  const declined = watchDialogs(page, { accept: false });
  await page.getByRole('button', { name: /^Residents$/ }).click();
  expect(declined).toEqual([DISCARD_PROMPT]);
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByLabel('Program display name')).toHaveValue(edited);

  // Browser Back asks too, and staying keeps both the page and the edit.
  await page.goBack();
  expect(declined).toEqual([DISCARD_PROMPT, DISCARD_PROMPT]);
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByLabel('Program display name')).toHaveValue(edited);

  // Accepting the same prompt discards the edit and completes the navigation.
  page.removeAllListeners('dialog');
  const accepted = watchDialogs(page, { accept: true });
  await page.goBack();
  expect(accepted).toEqual([DISCARD_PROMPT]);
  await expect(page).toHaveURL(/\/dashboard/);
  expect((await savedProgram(page)).name, 'nothing was written on the way out').toBe(original.name);
});
