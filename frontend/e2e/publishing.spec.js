import { expect, test } from '@playwright/test';

// Retracting and replacing a public link, from the Chief Resident's side.
// These run last in the file and republish at the end so the shared QA block is
// left published for the rest of the suite.

const PASSWORD = 'QA_only_password_123!';
test.describe.configure({ mode: 'serial' });

async function loginAsChief(page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa-chief@medrota.local');
  await page.locator('#lg-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/dashboard|\/setup/, { timeout: 20_000 });
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: /Block 1 Calendar/i })).toBeVisible();
}

async function currentPublicUrl(page) {
  const input = page.locator('input[readonly]').first();
  await expect(input).toBeVisible();
  return input.inputValue();
}

test('generating a new public link invalidates the old one', async ({ page }) => {
  await loginAsChief(page);

  const originalUrl = await currentPublicUrl(page);
  expect(originalUrl).toMatch(/\/schedule\//);

  // The old link works before rotation.
  const before = await page.request.get(originalUrl);
  expect(before.status()).toBe(200);

  await page.getByTestId('rotate-public-link').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Generate a new public link?');
  await expect(dialog).toContainText('the current one stops working immediately');
  await dialog.getByTestId('confirm-rotate').click();

  await expect(page.getByText(/New public link generated/)).toBeVisible();

  const rotatedUrl = await currentPublicUrl(page);
  expect(rotatedUrl).not.toBe(originalUrl);

  // The old link is dead; the new one serves the same published schedule.
  await page.goto(originalUrl);
  await expect(page.getByText(/not available|unavailable/i).first()).toBeVisible();

  await page.goto(rotatedUrl);
  await expect(page.getByText(/QA Vascular Surgery/i).first()).toBeVisible();
});

test('unpublishing stops the public link resolving and can be reversed', async ({ page }) => {
  await loginAsChief(page);
  const publicUrl = await currentPublicUrl(page);

  await page.getByTestId('unpublish-schedule').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Unpublish this schedule?');
  await expect(dialog).toContainText('draft schedule is not changed');
  await dialog.getByTestId('confirm-unpublish').click();

  await expect(page.getByText(/Schedule unpublished/)).toBeVisible();

  // The public page stops serving the schedule.
  await page.goto(publicUrl);
  await expect(page.getByText(/not available|unavailable/i).first()).toBeVisible();

  // The draft is untouched: the seeded assignment is still on the calendar.
  await loginAsChief(page);
  await expect(page.getByText('QA_ONLY Dr Avery').first()).toBeVisible();

  // Publishing again restores access, leaving the QA data as the suite found it.
  await page.getByRole('button', { name: /^Publish$/ }).click();
  await expect(page.getByRole('heading', { name: 'Publish Schedule' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: /^Publish$/ }).click();
  await expect(page.getByText(/Schedule published/)).toBeVisible();
});

test('a viewer sees no unpublish or new-link controls', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa-viewer@medrota.local');
  await page.locator('#lg-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/dashboard|\/setup/, { timeout: 20_000 });
  await page.goto('/calendar');

  await expect(page.getByTestId('unpublish-schedule')).toHaveCount(0);
  await expect(page.getByTestId('rotate-public-link')).toHaveCount(0);
});
