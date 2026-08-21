import { expect, test } from '@playwright/test';

const PASSWORD = 'QA_only_password_123!';
const IN_SERVICE_NAME = 'QA_ONLY E2E Rowan Workflow';
const OFF_SERVICE_NAME = 'QA_ONLY E2E Robin Rotor';
const DISPLAY_IN_SERVICE = 'Dr. Workflow';
const DISPLAY_OFF_SERVICE = 'Dr. Rotor';
let protectedAssignmentId;
test.describe.configure({ mode: 'serial' });

async function login(page, email = 'qa-chief@medrota.local') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#lg-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/dashboard|\/setup/, { timeout: 20_000 });
}

async function api(page, path, options = {}) {
  return page.evaluate(async ({ path, options }) => {
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }, { path, options });
}

test('Resident Directory creates an in-service resident with calculated PGY and contact details', async ({ page }) => {
  await login(page);
  await page.goto('/residents');
  await expect(page.getByRole('heading', { name: 'Resident Directory' })).toBeVisible();
  await page.getByRole('button', { name: 'Add Resident', exact: true }).click();
  await page.getByLabel('Name').fill(IN_SERVICE_NAME);
  await page.getByLabel('Program start date').fill('2023-07-01');
  await page.getByLabel('Expected program completion date').fill('2030-06-30');
  await page.getByLabel('Email (optional)').fill('qa-e2e-workflow@example.test');
  await page.getByLabel('Phone (optional)').fill('555-0108');
  await page.getByRole('button', { name: 'Save resident' }).click();
  const row = page.locator('[data-testid^="directory-resident-"]').filter({ hasText: DISPLAY_IN_SERVICE });
  await expect(row).toBeVisible();
  await expect(row).toContainText('In-service');
  await expect(row).toContainText('PGY-3');
  await expect(row).toContainText('Calculated');
  await expect(row).toContainText('qa-e2e-workflow@example.test');
  await expect(row).toContainText('555-0108');
  await row.getByRole('button', { name: /Edit/ }).click();
  await page.getByLabel('Phone (optional)').fill('555-0110');
  await page.getByRole('button', { name: 'Save resident' }).click();
  await expect(row).toContainText('555-0110');
});

test('Block opens with its roster and eligible in-service residents already present', async ({ page }) => {
  await login(page);
  await page.goto('/blocks/1');
  const card = page.getByTestId('residents-this-block');
  await expect(card).toBeVisible();
  await expect(card).toContainText(DISPLAY_IN_SERVICE);
  await card.getByRole('button', { name: 'Manage block residents' }).click();
  await expect(page).toHaveURL(/\/blocks\/1\/residents$/);
  await expect(page.getByText(DISPLAY_IN_SERVICE, { exact: true })).toBeVisible();
});

test('an off-service resident is created once and enrolled only in the selected block', async ({ page }) => {
  await login(page);
  await page.goto('/blocks/1/residents');
  await page.getByRole('button', { name: '+ New rotating resident' }).click();
  await page.getByLabel('Name').fill(OFF_SERVICE_NAME);
  await page.getByLabel('Service classification').selectOption('off_service');
  await page.getByLabel('Home program / specialty').fill('General Surgery');
  await page.getByRole('button', { name: 'Save resident' }).click();
  const inBlock = page.locator('li').filter({ hasText: DISPLAY_OFF_SERVICE }).first();
  await expect(inBlock).toContainText(DISPLAY_OFF_SERVICE);
  await expect(inBlock).toContainText('Off-service');
  const program = (await api(page, '/programs/mine')).body;
  const blockTwo = program.blocks.find(block => block.number === 2);
  const blockTwoComposition = await api(page, `/residents/block/${blockTwo.id}/composition`);
  expect(blockTwoComposition.body.inBlock.some(resident => resident.name === OFF_SERVICE_NAME)).toBe(false);
  expect(blockTwoComposition.body.available.some(resident => resident.name === OFF_SERVICE_NAME)).toBe(true);
});

test('medical students are added explicitly and show one canonical badge', async ({ page }) => {
  await login(page);
  const program = (await api(page, '/programs/mine')).body;
  const blockTwo = program.blocks.find(block => block.number === 2);
  const initialComposition = (await api(page, `/residents/block/${blockTwo.id}/composition`)).body;
  const medStudent = [...initialComposition.inBlock, ...initialComposition.available]
    .find(resident => resident.isMedStudent);
  expect(medStudent).toBeTruthy();
  if (initialComposition.inBlock.some(resident => resident.id === medStudent.id)) {
    const reset = await api(page, `/residents/${medStudent.id}/enroll/${blockTwo.id}`, { method: 'DELETE' });
    expect(reset.status).toBe(200);
  }
  await page.goto('/blocks/2/residents');
  const availableStudent = page.locator('li').filter({ hasText: 'Dr. Student' }).first();
  await availableStudent.getByRole('button', { name: 'Add →' }).click();
  const student = page.locator('li').filter({ hasText: 'Dr. Student' }).first();
  await expect(student).toBeVisible();
  await expect(student.getByText('Medical Student', { exact: true })).toHaveCount(1);
  const cleanup = await api(page, `/residents/${medStudent.id}/enroll/${blockTwo.id}`, { method: 'DELETE' });
  expect(cleanup.status).toBe(200);
});

test('arbitrary Tuesday academic time persists with days-on-service and call-limit summary', async ({ page }) => {
  await login(page);
  await page.goto('/blocks/1/residents');
  const resident = page.locator('li').filter({ hasText: DISPLAY_IN_SERVICE }).first();
  await resident.getByRole('button', { name: 'Configure' }).click();
  await page.getByLabel('Add vacation').fill('2026-06-20');
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await page.getByRole('button', { name: '+ Add academic time' }).click();
  await page.getByLabel('Academic day 1').selectOption('Tuesday');
  await page.getByLabel('Academic period 1').selectOption('PM');
  await page.getByTestId('save-block-availability').click();
  const refreshed = page.locator('li').filter({ hasText: DISPLAY_IN_SERVICE }).first();
  await expect(refreshed).toContainText('Block days: 14');
  await expect(refreshed).toContainText('Vacation: 1');
  await expect(refreshed).toContainText('Days on service: 13');
  await expect(refreshed).toContainText('Call type: Home');
  await expect(refreshed).toContainText('PARO maximum: 4');
  await refreshed.getByRole('button', { name: 'Availability' }).click();
  await expect(page.getByLabel('Academic day 1')).toHaveValue('Tuesday');
  await expect(page.getByLabel('Academic period 1')).toHaveValue('PM');
  await page.keyboard.press('Escape');
});

test('duplicate last names and duplicate first initials remain unambiguous', async ({ page }) => {
  await login(page);
  const program = (await api(page, '/programs/mine')).body;
  for (const name of ['QA_ONLY E2E Alex Smith', 'QA_ONLY E2E Andrew Smith']) {
    const response = await api(page, '/residents', { method: 'POST', body: JSON.stringify({ programId: program.programId, name, pgyLevel: '2', residentRole: 'junior', isServiceResident: false }) });
    expect(response.status).toBe(201);
  }
  await page.goto('/residents');
  await expect(page.getByText('Dr. QA_ONLY E2E Alex Smith', { exact: true })).toBeVisible();
  await expect(page.getByText('Dr. QA_ONLY E2E Andrew Smith', { exact: true })).toBeVisible();
});

test('assigned rotating residents cannot be removed from a block', async ({ page }) => {
  await login(page);
  const program = (await api(page, '/programs/mine')).body;
  const block = program.blocks.find(item => item.number === 1);
  const residents = (await api(page, `/residents?programId=${program.programId}&blockId=${block.id}`)).body;
  const rotor = residents.find(item => item.name === OFF_SERVICE_NAME);
  const assigned = await api(page, '/assignments', { method: 'POST', body: JSON.stringify({ blockId: block.id, date: '2026-06-19', residentId: rotor.id, roleOnDay: 'junior' }) });
  expect(assigned.status).toBe(201);
  protectedAssignmentId = assigned.body.id;
  await page.goto('/blocks/1/residents');
  const row = page.locator('li').filter({ hasText: DISPLAY_OFF_SERVICE }).first();
  await expect(row).toContainText('Assigned: 1');
  page.once('dialog', dialog => dialog.accept());
  await row.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText(/has 1 call assignment.*Resolve the assignments/i)).toBeVisible();
  await expect(row).toBeVisible();
});

test('Manage block residents is usable on mobile and viewer access is read-only', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.goto('/blocks/1/residents');
  await expect(page.getByRole('heading', { name: 'Available residents' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'In this block' })).toBeVisible();
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(horizontalOverflow).toBe(false);

  await page.evaluate(() => localStorage.clear());
  await login(page, 'qa-viewer@medrota.local');
  await page.goto('/blocks/1/residents');
  await expect(page.getByRole('heading', { name: 'In this block' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Add|Remove|Configure|Availability/ })).toHaveCount(0);

  await page.evaluate(() => localStorage.clear());
  await login(page);
  if (protectedAssignmentId) {
    const removed = await api(page, `/assignments/${protectedAssignmentId}`, { method: 'DELETE' });
    expect(removed.status).toBe(204);
  }
});
