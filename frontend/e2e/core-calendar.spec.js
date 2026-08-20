import { expect, test } from '@playwright/test';

const PASSWORD = 'QA_only_password_123!';
test.describe.configure({ mode: 'serial' });
const MOJIBAKE_PATTERNS = ['Ã', 'Â', 'â€', 'ðŸ', 'ï¿½', '�'];

async function login(page, email, targetPath = '/calendar') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#lg-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/dashboard|\/setup/, { timeout: 20_000 });
  await page.goto(targetPath);
  if (targetPath === '/calendar') {
    await expect(page.getByRole('heading', { name: /Block 1 Calendar/i })).toBeVisible();
  }
}

async function expectNoMojibake(page) {
  const text = await page.locator('body').innerText();
  for (const pattern of MOJIBAKE_PATTERNS) {
    expect(text, `visible page text should not contain ${pattern}`).not.toContain(pattern);
  }
}

function seededDayCell(page) {
  return page
    .locator('button')
    .filter({ hasText: /QA_ONLY (Senior Resident|Alternate Senior)/ })
    .filter({ hasText: 'QA_ONLY Junior Resident' })
    .filter({ hasText: 'QA_ONLY Dr Avery' })
    .first();
}

test('logged-out protected routes redirect while login and registration remain public', async ({ page }) => {
  await page.goto('/calendar');
  await expect(page).toHaveURL(/\/login$/);
  await expectNoMojibake(page);

  await page.goto('/register');
  await expect(page).toHaveURL(/\/register$/);
  await expectNoMojibake(page);
});

test('chief resident can use the calendar day modal and persist assignment changes', async ({ page }) => {
  await login(page, 'qa-chief@medrota.local');
  await expectNoMojibake(page);

  const dayCell = seededDayCell(page);
  await expect(dayCell).toBeVisible();
  await expect(dayCell).toContainText('QA_ONLY Junior Resident');
  await expect(dayCell).toContainText('QA_ONLY Dr Avery');

  await dayCell.click();
  const seniorSelect = page.locator('select[name="seniorId"]');
  const juniorSelect = page.locator('select[name="juniorId"]');
  await expect(seniorSelect).toBeVisible();
  await expect(seniorSelect.locator('option:checked')).toHaveText('QA_ONLY Senior Resident');
  await expect(juniorSelect.locator('option:checked')).toHaveText('QA_ONLY Junior Resident');
  await expect(page.locator('.modal-panel.open').last()).toContainText('QA_ONLY Dr Avery');

  await seniorSelect.selectOption({ label: 'QA_ONLY Alternate Senior' });
  await page.getByRole('button', { name: /^Save$/ }).click();
  await expect(seniorSelect).toBeHidden();

  const updatedCell = page
    .locator('button')
    .filter({ hasText: 'QA_ONLY Alternate Senior' })
    .filter({ hasText: 'QA_ONLY Junior Resident' })
    .filter({ hasText: 'QA_ONLY Dr Avery' })
    .first();
  await expect(updatedCell).toBeVisible();

  await updatedCell.click();
  await expect(seniorSelect.locator('option:checked')).toHaveText('QA_ONLY Alternate Senior');
  await expect(juniorSelect.locator('option:checked')).toHaveText('QA_ONLY Junior Resident');
  await page.getByRole('button', { name: /^Cancel$/ }).click();

  await page.reload();
  await expect(
    page.locator('button').filter({ hasText: 'QA_ONLY Alternate Senior' }).filter({ hasText: 'QA_ONLY Junior Resident' }).first()
  ).toBeVisible();
});

test('invalid duplicate-resident day update is rejected without changing stored assignments', async ({ page }) => {
  await login(page, 'qa-chief@medrota.local');
  const result = await page.evaluate(async () => {
    const headers = {
      Authorization: `Bearer ${localStorage.getItem('token')}`,
      'Content-Type': 'application/json',
    };
    const program = await fetch('/api/programs/mine', { headers }).then(response => response.json());
    const before = await fetch(`/api/assignments?blockId=${program.currentBlock.id}`, { headers }).then(response => response.json());
    const senior = before.find(item => item.roleOnDay === 'senior');
    const response = await fetch('/api/assignments/day', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        blockId: program.currentBlock.id,
        date: '2026-06-15',
        seniorId: senior.residentId,
        juniorId: senior.residentId,
      }),
    });
    const body = await response.json();
    const after = await fetch(`/api/assignments?blockId=${program.currentBlock.id}`, { headers }).then(item => item.json());
    return {
      status: response.status,
      error: body.error,
      before: before.filter(item => item.callDay.date.startsWith('2026-06-15')).map(item => `${item.roleOnDay}:${item.residentId}`).sort(),
      after: after.filter(item => item.callDay.date.startsWith('2026-06-15')).map(item => `${item.roleOnDay}:${item.residentId}`).sort(),
    };
  });

  expect(result.status).toBe(400);
  expect(result.error).toContain('same resident');
  expect(result.after).toEqual(result.before);
});

test('violating calendar edit requires a reason and remains visible to validation', async ({ page }) => {
  await login(page, 'qa-chief@medrota.local');
  await page.getByRole('button', { name: 'Edit Tuesday, 16 June 2026' }).click();
  await page.locator('select[name="seniorId"]').selectOption({ label: 'QA_ONLY Alternate Senior' });
  await page.locator('select[name="juniorId"]').selectOption({ label: 'QA_ONLY Junior Resident' });
  await page.getByRole('button', { name: /^Save$/ }).click();

  await expect(page.getByRole('heading', { name: 'Rule violation requires an override' })).toBeVisible();
  const confirm = page.getByRole('button', { name: 'Confirm override' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Override reason').fill('QA_ONLY consecutive coverage exception');
  await confirm.click();
  await expect(page.getByText('Manual override saved with reason')).toBeVisible();

  await page.getByRole('button', { name: 'Validate schedule' }).click();
  await expect(page.getByRole('heading', { name: 'Schedule needs attention' })).toBeVisible();
  await expect(page.getByText('Documented manual override').first()).toBeVisible();
});

test('validation explains who, when, which rule, why and what to do', async ({ page }) => {
  await login(page, 'qa-chief@medrota.local');
  await page.getByRole('button', { name: 'Validate schedule' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');

  const card = dialog
    .getByTestId('violation-CONSECUTIVE_CALL')
    .filter({ hasText: 'QA_ONLY Alternate Senior' })
    .first();
  await expect(card).toBeVisible();
  // Who and when.
  await expect(card).toContainText('QA_ONLY Alternate Senior');
  await expect(card).toContainText('16 Jun');
  // Which rule and why it matters.
  await expect(card).toContainText('Consecutive call');
  await expect(card).toContainText('two days in a row');
  // Whether it was intentional, and the recorded reason.
  await expect(card).toContainText('Documented manual override');
  await expect(card).toContainText('QA_ONLY consecutive coverage exception');
  // The related date is spelled out rather than left implicit.
  await expect(card).toContainText('Also assigned 15 Jun');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('unfilled slots explain which residents were unavailable and why', async ({ page }) => {
  await login(page, 'qa-chief@medrota.local');
  await page.getByRole('button', { name: 'Validate schedule' }).click();

  const dialog = page.getByRole('dialog');
  const unfilled = dialog.getByTestId('unfilled-slots');
  await expect(unfilled).toBeVisible();
  await expect(unfilled).toContainText('Unfilled slots');

  // Progressive disclosure: the list is collapsed when it is long.
  await unfilled.locator('summary').click();

  // Pick the day right after the seeded call day: the residents on call the day
  // before must be reported as unavailable for the consecutive-call rule.
  const slot = dialog.getByTestId('unfilled-2026-06-17-junior');
  await expect(slot).toBeVisible();
  await expect(slot).toContainText('Junior unassigned');
  await expect(slot).toContainText('unavailable');
  await expect(slot).toContainText('Already on call the day before or after');
});

test('a schedule whose only violations are documented overrides still publishes', async ({ page }) => {
  await login(page, 'qa-chief@medrota.local');
  await page.getByRole('button', { name: /^Re-publish$|^Publish$/ }).click();
  await expect(page.getByRole('heading', { name: 'Publish Schedule' })).toBeVisible();
  await page.getByRole('button', { name: /^Publish$/ }).click();

  // No violation gate: the consecutive call is an accepted, documented exception.
  await expect(page.getByRole('heading', { name: 'This schedule breaks scheduling rules' })).toHaveCount(0);
  await expect(page.getByText(/Schedule published/)).toBeVisible();
});

test('seeded public holiday is visible on the authenticated calendar', async ({ page }) => {
  await login(page, 'qa-chief@medrota.local');
  await expect(page.getByText('QA_ONLY Holiday').first()).toBeVisible();
  await expectNoMojibake(page);
  await page.goto('/dashboard');
  await expectNoMojibake(page);
});

test('viewer can read published schedule but cannot edit calendar data', async ({ page }) => {
  await login(page, 'qa-viewer@medrota.local');
  await expectNoMojibake(page);

  const dayCell = page
    .locator('button')
    .filter({ hasText: /QA_ONLY (Senior Resident|Alternate Senior)/ })
    .filter({ hasText: 'QA_ONLY Junior Resident' })
    .first();
  await expect(dayCell).toBeVisible();
  await expectNoMojibake(page);

  await dayCell.click();
  await expect(page.locator('select[name="seniorId"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Save$/ })).toHaveCount(0);

  await expect(page.getByRole('button', { name: /Auto-generate/i })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Clear schedule/i })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^(Re-)?publish$/i })).toBeDisabled();

  const mutationStatus = await page.evaluate(async () => {
    const program = await fetch('/api/programs/mine', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    }).then(r => r.json());
    const assignments = await fetch(`/api/assignments?blockId=${program.currentBlock.id}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    }).then(r => r.json());
    const first = assignments[0];
    const response = await fetch('/api/assignments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        blockId: program.currentBlock.id,
        date: '2026-06-15',
        residentId: first.residentId,
        roleOnDay: first.roleOnDay,
        isOverride: true,
        overrideReason: 'viewer e2e should fail',
      }),
    });
    return response.status;
  });
  expect(mutationStatus).toBe(403);
});

test('program admin can persist program call-type settings', async ({ page }) => {
  await login(page, 'qa-admin@medrota.local', '/settings');
  await expect(page.getByRole('heading', { name: 'Program Settings' })).toBeVisible();

  // Call configuration lives in the Scheduling section of Program Settings, and
  // its Save persists that section alone.
  await page.getByRole('tab', { name: 'Scheduling' }).click();

  const juniorToggle = page.getByRole('checkbox', { name: /Junior in-house call/i });
  const seniorToggle = page.getByRole('checkbox', { name: /Senior in-house call/i });
  await expect(juniorToggle).toBeVisible();
  await expect(seniorToggle).toBeVisible();

  await juniorToggle.setChecked(false);
  await seniorToggle.setChecked(true);
  await page.getByRole('button', { name: 'Save call configuration' }).click();
  await expect(juniorToggle).not.toBeChecked();
  await expect(seniorToggle).toBeChecked();

  await page.reload();
  await expect(juniorToggle).not.toBeChecked();
  await expect(seniorToggle).toBeChecked();

  await juniorToggle.setChecked(true);
  await seniorToggle.setChecked(false);
  await page.getByRole('button', { name: 'Save call configuration' }).click();
  await expect(juniorToggle).toBeChecked();
  await expect(seniorToggle).not.toBeChecked();
});

test('viewer cannot edit program call-type settings', async ({ page }) => {
  await login(page, 'qa-viewer@medrota.local', '/settings');
  await expect(page.getByText('You do not have access to program configuration.')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Junior in-house call/i })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /Senior in-house call/i })).toHaveCount(0);
});

test('login password eye stays fixed and toggles visibility', async ({ page }) => {
  await page.goto('/login');
  const password = page.locator('#lg-password');
  const eye = page.getByRole('button', { name: 'Show password' });

  await password.fill(PASSWORD);
  await page.evaluate(() => document.fonts.ready);
  const before = await eye.boundingBox();
  await eye.hover();
  const afterHover = await eye.boundingBox();
  await eye.click();
  const afterClick = await page.getByRole('button', { name: 'Hide password' }).boundingBox();

  expect(before).not.toBeNull();
  expect(afterHover).not.toBeNull();
  expect(afterClick).not.toBeNull();
  expect(Math.abs(afterHover.y - before.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(afterClick.y - before.y)).toBeLessThanOrEqual(1);
  await expect(password).toHaveAttribute('type', 'text');
});

test('published schedule remains accessible without authentication', async ({ page }) => {
  await login(page, 'qa-chief@medrota.local');
  const token = await page.evaluate(async () => {
    const headers = {
      Authorization: `Bearer ${localStorage.getItem('token')}`,
      'Content-Type': 'application/json',
    };
    const program = await fetch('/api/programs/mine', { headers }).then(response => response.json());
    const response = await fetch('/api/schedule/publish', {
      method: 'POST',
      headers,
      body: JSON.stringify({ blockId: program.currentBlock.id }),
    });
    if (!response.ok) throw new Error(`publish failed: ${response.status}`);
    return (await response.json()).publicToken;
  });

  await page.evaluate(() => localStorage.clear());
  await page.goto(`/schedule/${token}`);
  await expect(page.getByText('Read-only published schedule')).toBeVisible();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  await expectNoMojibake(page);
});
