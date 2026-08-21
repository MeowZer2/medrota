import { expect, test } from '@playwright/test';

const PASSWORD = 'QA_only_password_123!';
test.describe.configure({ mode: 'serial' });

async function loginAsChief(page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa-chief@medrota.local');
  await page.locator('#lg-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/dashboard|\/setup/, { timeout: 20_000 });
}

async function api(page, path, options = {}) {
  return page.evaluate(async ({ path, options }) => {
    const response = await fetch(`/api${path}`, { ...options, headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }, { path, options });
}

async function resetBlockTwoAvailability(page) {
  const program = (await api(page, '/programs/mine')).body;
  const block = program.blocks.find(item => item.number === 2);
  const composition = (await api(page, `/residents/block/${block.id}/composition`)).body;
  for (const resident of composition.inBlock.filter(item => item.isServiceResident && !item.isMedStudent)) {
    await api(page, `/residents/${resident.id}`, { method: 'PUT', body: JSON.stringify({ blockId: block.id, availabilityConfirmed: false }) });
  }
  return { block, composition };
}

test('generation readiness names missing availability before Generate', async ({ page }) => {
  await loginAsChief(page);
  await resetBlockTwoAvailability(page);
  await page.goto('/blocks/2/calendar');
  const panel = page.getByTestId('readiness-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Before you generate');
  const missing = page.getByTestId('readiness-MISSING_AVAILABILITY');
  await expect(missing).toContainText('incomplete block availability');
  await expect(missing.getByRole('link', { name: 'Manage block residents' })).toBeVisible();
  await expect(panel).toContainText('0/4');
});

test('Chief Resident confirms availability from the block resident workflow', async ({ page }) => {
  await loginAsChief(page);
  await page.goto('/blocks/2/residents');
  const status = page.getByTestId('block-resident-readiness');
  await expect(status).toContainText('0/4 have availability configured');
  const resident = page.locator('li').filter({ hasText: 'Dr. QA_ONLY Senior Resident' }).first();
  await resident.getByRole('button', { name: 'Configure' }).click();
  await expect(page.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  await page.getByTestId('save-block-availability').click();
  await expect(status).toContainText('1/4 have availability configured');
});

test('bulk compatibility endpoint confirms the remaining block roster without duplicates', async ({ page }) => {
  await loginAsChief(page);
  const program = (await api(page, '/programs/mine')).body;
  const block = program.blocks.find(item => item.number === 2);
  const composition = (await api(page, `/residents/block/${block.id}/composition`)).body;
  const result = await api(page, `/blocks/${block.id}/availability/bulk`, { method: 'POST', body: JSON.stringify({ residentIds: composition.inBlock.filter(item => item.isServiceResident && !item.isMedStudent).map(item => item.id) }) });
  expect(result.status).toBe(200);
  await page.goto('/blocks/2/residents');
  await expect(page.getByTestId('block-resident-readiness')).toContainText('4/4 have availability configured');
  const ids = (await api(page, `/residents/block/${block.id}/composition`)).body.inBlock.map(item => item.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('block history records availability changes for a Chief Resident', async ({ page }) => {
  await loginAsChief(page);
  await page.goto('/blocks/2/calendar');
  const history = page.getByTestId('block-history');
  await history.locator('summary').click();
  await expect(page.getByTestId('audit-BLOCK_AVAILABILITY_CHANGED').first()).toBeVisible();
  await expect(page.getByTestId('audit-history')).toContainText('QA_ONLY Chief Resident QA');
  await expect(page.getByTestId('audit-MEMBER_ROLE_CHANGED')).toHaveCount(0);
});

test('viewer cannot read program audit history', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa-viewer@medrota.local');
  await page.locator('#lg-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/dashboard|\/setup/, { timeout: 20_000 });
  const response = await page.request.get('/api/audit?programId=any', { headers: { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('token'))}` } });
  expect([403, 400]).toContain(response.status());
});
