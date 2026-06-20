import { expect, test } from '@playwright/test';

const PASSWORD = 'QA_only_password_123!';
const MOJIBAKE_PATTERNS = ['Ã¢', 'Ãƒ', 'Ã‚', 'ï¿½', 'Â'];

async function login(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#lg-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/dashboard|\/setup/, { timeout: 20_000 });
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: /Block 1 Calendar/i })).toBeVisible();
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
  await expect(page.getByRole('button', { name: /Publish/i })).toBeDisabled();

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

test('login password eye stays fixed and toggles visibility', async ({ page }) => {
  await page.goto('/login');
  const password = page.locator('#lg-password');
  const eye = page.getByRole('button', { name: 'Show password' });

  await password.fill(PASSWORD);
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
