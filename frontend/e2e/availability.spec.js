import { expect, test } from '@playwright/test';

// Block 2 is seeded as a draft with no resident availability, so these tests
// exercise the readiness check and the bulk/copy availability workflow in the
// order a Chief Resident would meet them.

const PASSWORD = 'QA_only_password_123!';
test.describe.configure({ mode: 'serial' });

async function loginAsChief(page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa-chief@medrota.local');
  await page.locator('#lg-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/dashboard|\/setup/, { timeout: 20_000 });
}

async function selectBlock(page, number) {
  await page.getByRole('button', { name: 'Select block' }).click();
  await page.getByTestId(`block-option-${number}`).click();
}

// Put block 2 back to having no availability so the suite can be re-run.
async function resetBlockTwoAvailability(page) {
  await page.goto('/residents');
  await selectBlock(page, 2);
  await expect(page.getByTestId('set-block-availability')).toBeVisible();
  const toggles = page.getByRole('switch', { name: /Active this block/i });
  const count = await toggles.count();
  for (let index = 0; index < count; index += 1) {
    const toggle = toggles.nth(index);
    if (await toggle.getAttribute('aria-checked') === 'true') {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
    }
  }
}

test('generation readiness is reported before generating, not only after', async ({ page }) => {
  await loginAsChief(page);
  await page.goto('/blocks/2/calendar');

  const panel = page.getByTestId('readiness-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Before you generate');

  // Missing availability must be named and actionable up front.
  const missing = page.getByTestId('readiness-MISSING_AVAILABILITY');
  await expect(missing).toBeVisible();
  await expect(missing).toContainText('no block availability');
  await expect(missing).toContainText('QA_ONLY Senior Resident');
  await expect(missing.getByRole('link', { name: /Set block availability/i })).toBeVisible();

  await expect(panel).toContainText('0/5');
});

test('chief resident can set block availability for several residents at once', async ({ page }) => {
  await loginAsChief(page);
  await page.goto('/residents');
  await selectBlock(page, 2);

  await expect(page.getByText(/0 of 4 service residents active this block/)).toBeVisible();

  await page.getByTestId('set-block-availability').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Set block availability');
  await expect(dialog).toContainText('0/5 already set');

  // Everyone missing availability is preselected, so one click is enough.
  await expect(dialog.getByTestId('availability-apply')).toContainText('Mark 5 active for this block');
  await dialog.getByTestId('availability-apply').click();

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText(/4 of 4 service residents active this block/)).toBeVisible();
});

test('readiness clears once every resident has block availability', async ({ page }) => {
  await loginAsChief(page);
  await page.goto('/blocks/2/calendar');

  const panel = page.getByTestId('readiness-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('5/5');
  await expect(page.getByTestId('readiness-MISSING_AVAILABILITY')).toHaveCount(0);
  await expect(panel).toContainText('Everything required is in place.');
});

test('availability dialog is keyboard accessible and restores focus on close', async ({ page }) => {
  await loginAsChief(page);
  await page.goto('/residents');
  await selectBlock(page, 2);

  const trigger = page.getByTestId('set-block-availability');
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  // Focus must return to the control that opened the dialog.
  await expect(trigger).toBeFocused();
});

test('copy availability forward carries the previous block configuration', async ({ page }) => {
  await loginAsChief(page);
  await resetBlockTwoAvailability(page);
  await expect(page.getByText(/0 of 4 service residents active this block/)).toBeVisible();

  await page.getByTestId('set-block-availability').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Copy availability forward').selectOption({ label: 'Block 1' });
  await dialog.getByTestId('availability-copy').click();

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText(/4 of 4 service residents active this block/)).toBeVisible();
});
