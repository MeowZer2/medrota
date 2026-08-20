import { expect, test } from '@playwright/test';
import { ownedName } from './qa-records.js';

const PASSWORD = 'QA_only_password_123!';

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

test('program identity, custom registries, weekly activity selection, and Chief permissions work together', async ({ page }) => {
  const serviceName = ownedName('Trauma');
  const activityName = ownedName('Angio');

  await login(page, 'qa-admin@medrota.local');
  await expect(page.getByRole('heading', { name: 'Program Settings' })).toBeVisible();
  await expect(page.getByLabel('Program display name')).toBeVisible();
  await expect(page.getByLabel('Primary specialty')).toBeVisible();

  // Registries and permissions each live in their own settings section.
  await page.getByRole('tab', { name: 'Clinical Structure' }).click();
  await page.getByLabel('New clinical service', { exact: true }).fill(serviceName);
  await page.getByRole('button', { name: 'Add service' }).click();
  await expect(page.getByLabel(`${serviceName} name`)).toBeVisible();

  await page.getByRole('tab', { name: 'Attendings' }).click();
  await page.getByLabel('New attending activity').fill(activityName);
  await page.getByRole('button', { name: 'Add activity' }).click();
  await expect(page.getByLabel(`${activityName} name`)).toBeVisible();

  const mine = await api(page, '/programs/mine');
  expect(mine.status).toBe(200);
  const programId = mine.body.programId;
  const permissionResponse = await api(page, `/program-configuration/${programId}/role-permissions`);
  const initialPermissions = permissionResponse.body.roles.chief_resident.permissions.filter(item => item.enabled).map(item => item.permission);

  await page.goto('/attending');
  await page.getByRole('button', { name: /Attending Roster & Weekly Pattern/i }).click();
  await expect(page.locator('select').filter({ has: page.locator(`option[value="${activityName}"]`) }).first()).toBeVisible();

  await page.goto('/settings?tab=access');
  const residentsToggle = page.getByLabel('Manage residents');
  await expect(residentsToggle).toBeChecked();
  await residentsToggle.uncheck();
  const disableResponsePromise = page.waitForResponse(response => response.url().includes('/role-permissions') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save permissions' }).click();
  const disableResponse = await disableResponsePromise;
  expect(disableResponse.status()).toBe(200);
  expect((await disableResponse.json()).permissions).not.toContain('manage_residents');

  await login(page, 'qa-chief@medrota.local', '/dashboard');
  await expect(page.getByRole('button', { name: /^Residents$/ })).toHaveCount(0);

  await login(page, 'qa-admin@medrota.local', '/settings?tab=access');
  await expect(page.getByLabel('Manage residents')).not.toBeChecked();
  await page.getByLabel('Manage residents').check();
  const enableResponsePromise = page.waitForResponse(response => response.url().includes('/role-permissions') && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save permissions' }).click();
  const enableResponse = await enableResponsePromise;
  expect(enableResponse.status()).toBe(200);
  expect((await enableResponse.json()).permissions).toContain('manage_residents');
  await login(page, 'qa-chief@medrota.local', '/dashboard');
  await expect(page.getByRole('button', { name: /^Residents$/ })).toBeVisible();

  await login(page, 'qa-viewer@medrota.local', '/dashboard');
  const viewerMutation = await api(page, `/program-configuration/${programId}/clinical-services`, { method: 'POST', body: JSON.stringify({ name: ownedName('Viewer') }) });
  expect(viewerMutation.status).toBe(403);

  await login(page, 'qa-admin@medrota.local', '/settings?tab=access');
  await api(page, `/program-configuration/${programId}/role-permissions`, { method: 'PUT', body: JSON.stringify({ role: 'chief_resident', permissions: initialPermissions }) });
  const services = await api(page, `/program-configuration/${programId}/clinical-services`);
  const activities = await api(page, `/program-configuration/${programId}/attending-activities`);
  const service = services.body.find(item => item.name === serviceName);
  const activity = activities.body.find(item => item.name === activityName);
  if (service) await api(page, `/program-configuration/${programId}/clinical-services/${service.id}`, { method: 'PUT', body: JSON.stringify({ isActive: false }) });
  if (activity) await api(page, `/program-configuration/${programId}/attending-activities/${activity.id}`, { method: 'PUT', body: JSON.stringify({ isActive: false }) });
});
