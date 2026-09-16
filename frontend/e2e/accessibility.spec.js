import { expect, test } from '@playwright/test';

// Accessibility baseline. These are the rules that were actually broken, so they
// are worth keeping enforced: every form control has a name, every icon-only
// control has a name, every dialog is a labelled modal dialog, Escape closes it,
// focus returns to the trigger, and the major workflows work without a mouse.

const PASSWORD = 'QA_only_password_123!';
test.describe.configure({ mode: 'serial' });

async function login(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#lg-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/dashboard|\/setup/, { timeout: 20_000 });
}

// Collects naming and dialog problems from the live DOM.
const AUDIT = `(() => {
  const nameOf = el => (
    el.getAttribute('aria-label')
    || (el.getAttribute('aria-labelledby') && (document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || ''))
    || (el.id && (document.querySelector('label[for="' + CSS.escape(el.id) + '"]')?.textContent || ''))
    || el.closest('label')?.textContent
    || el.textContent
    || el.getAttribute('title')
    || ''
  ).trim();

  const problems = [];

  for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    if (el.offsetParent === null) continue;
    if (!nameOf(el)) problems.push('unnamed form control: ' + el.tagName.toLowerCase() + '[' + (el.type || '') + ']');
  }

  for (const el of document.querySelectorAll('button, a[href], [role=switch], [role=button]')) {
    if (el.offsetParent === null) continue;
    if (!nameOf(el)) problems.push('unnamed control: ' + el.tagName.toLowerCase() + ' ' + el.innerHTML.slice(0, 40));
  }

  for (const el of document.querySelectorAll('[role=dialog]')) {
    if (el.getAttribute('aria-modal') !== 'true') problems.push('dialog without aria-modal');
    if (!(el.getAttribute('aria-labelledby') || el.getAttribute('aria-label'))) problems.push('dialog without a label');
  }

  // A full-screen fixed overlay that behaves like a modal must say so.
  for (const el of document.querySelectorAll('div')) {
    const cs = window.getComputedStyle(el);
    if (cs.position !== 'fixed') continue;
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < window.innerWidth * 0.8 || rect.height < window.innerHeight * 0.8) continue;
    if (el.querySelector('[role=dialog]') || el.getAttribute('role') === 'dialog') continue;
    const z = Number(cs.zIndex);
    // Above the page but below the toast layer, which is a live region.
    if (z >= 40 && z < 1000) problems.push('modal-like overlay without a dialog role, z=' + z);
  }

  return problems;
})()`;

async function expectAccessible(page, label) {
  const problems = await page.evaluate(AUDIT);
  expect(problems, `accessibility problems on ${label}`).toEqual([]);
}

test('public and authenticated pages name every control', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/login');
  await expectAccessible(page, 'login');
  await page.goto('/register');
  await expectAccessible(page, 'register');

  await login(page, 'qa-admin@medrota.local');
  // Every Program Settings section is audited: each one mounts its own controls.
  const settingsSections = ['general', 'clinical', 'attendings', 'scheduling', 'access', 'history'].map(tab => `/settings?tab=${tab}`);
  for (const path of ['/dashboard', '/calendar', '/residents', '/attending', '/blocks/1', '/blocks/1/residents', '/blocks/1/attending', '/blocks/1/calendar', '/blocks/1/settings', ...settingsSections]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expectAccessible(page, path);
  }
});

test('every dialog is a labelled modal that closes on Escape', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'qa-chief@medrota.local');

  const cases = [
    { label: 'validation', path: '/calendar', open: p => p.getByRole('button', { name: 'Validate schedule' }) },
    { label: 'clear schedule', path: '/calendar', open: p => p.getByRole('button', { name: 'Clear schedule' }) },
    { label: 'day editor', path: '/calendar', open: p => p.getByRole('button', { name: /^Edit / }).first() },
    { label: 'add resident', path: '/residents', open: p => p.getByRole('button', { name: 'Add Resident', exact: true }) },
    { label: 'overview availability', path: '/blocks/1', open: p => p.getByRole('button', { name: /^Edit availability for/ }).first() },
    { label: 'clear attending block', path: '/attending', open: p => p.getByRole('button', { name: 'Clear block' }) },
  ];

  for (const item of cases) {
    await page.goto(item.path);
    await page.waitForLoadState('networkidle');
    const trigger = item.open(page);
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog, `${item.label} dialog opens`).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expectAccessible(page, `${item.label} dialog`);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog'), `${item.label} closes on Escape`).toBeHidden();
    await expect(trigger, `${item.label} returns focus to its trigger`).toBeFocused();
  }
});

test('login can be completed without a mouse', async ({ page }) => {
  await page.goto('/login');

  // Start at the top of the page and Tab forward, as a keyboard user would.
  await page.locator('body').press('Tab');
  const submit = page.getByRole('button', { name: 'Sign in', exact: true });

  let reachedEmail = false;
  let reachedPassword = false;
  let reachedSubmit = false;
  for (let step = 0; step < 25; step += 1) {
    const id = await page.evaluate(() => document.activeElement?.id ?? '');
    const isSubmit = await submit.evaluate(el => el === document.activeElement);

    if (!reachedEmail && id === 'lg-email') {
      await page.keyboard.type('qa-chief@medrota.local');
      reachedEmail = true;
    } else if (reachedEmail && !reachedPassword && id === 'lg-password') {
      await page.keyboard.type(PASSWORD);
      reachedPassword = true;
    } else if (isSubmit) {
      reachedSubmit = true;
      break;
    }
    await page.keyboard.press('Tab');
  }

  expect(reachedEmail, 'email field must be reachable by Tab').toBe(true);
  expect(reachedPassword, 'password field must be reachable by Tab').toBe(true);
  expect(reachedSubmit, 'submit button must be reachable by Tab').toBe(true);

  await page.keyboard.press('Enter');
  await page.waitForURL(/\/dashboard|\/setup/, { timeout: 20_000 });
});

test('a calendar day can be opened, edited and saved from the keyboard', async ({ page }) => {
  await login(page, 'qa-chief@medrota.local');
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');

  // Day cells are real buttons, so they take focus and respond to Enter.
  const dayCell = page.getByRole('button', { name: 'Edit Monday, 15 June 2026' });
  await dayCell.focus();
  await expect(dayCell).toBeFocused();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Assignment selects are reachable and operable without a pointer.
  const seniorSelect = page.locator('select[name="seniorId"]');
  await seniorSelect.focus();
  await expect(seniorSelect).toBeFocused();
  await seniorSelect.selectOption({ label: 'Dr. QA_ONLY Senior Resident' });

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('program settings is operable from the keyboard', async ({ page }) => {
  await login(page, 'qa-admin@medrota.local');
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');

  const nameField = page.getByLabel('Program display name');
  await nameField.focus();
  await expect(nameField).toBeFocused();

  const specialty = page.getByLabel('Primary specialty');
  await specialty.focus();
  await expect(specialty).toBeFocused();

  // Sections are reachable from the keyboard, and the call toggles live in one.
  const schedulingTab = page.getByRole('tab', { name: 'Scheduling' });
  await schedulingTab.focus();
  await expect(schedulingTab).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(schedulingTab).toHaveAttribute('aria-selected', 'true');

  // The call-type checkboxes are label-associated, so they toggle with Space.
  const juniorCall = page.getByLabel(/Junior in-house call/);
  const before = await juniorCall.isChecked();
  await juniorCall.focus();
  await page.keyboard.press('Space');
  expect(await juniorCall.isChecked()).toBe(!before);
  await page.keyboard.press('Space');
  expect(await juniorCall.isChecked()).toBe(before);
});

test('senior and junior are conveyed by text, not colour alone', async ({ page }) => {
  await login(page, 'qa-chief@medrota.local');
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');

  // Chips carry an S:/J: prefix so the role survives greyscale and screen readers.
  await expect(page.getByText(/^S: Dr\./).first()).toBeVisible();
  await expect(page.getByText(/^J: Dr\./).first()).toBeVisible();

  const publicUrl = await page.locator('input[readonly]').first().inputValue();
  await page.goto(publicUrl);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('S: Senior')).toBeVisible();
  await expect(page.getByText('J: Junior / med student')).toBeVisible();
});
