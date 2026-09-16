import { expect, test } from '@playwright/test';
import { rangeKeys } from '../src/lib/dateRanges';
import { focusBlocksForDate } from '../src/lib/dashboardBlocks';

test.use({ timezoneId: 'America/New_York' });
test.describe.configure({ mode: 'serial' });

async function login(page, role = 'chief') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`qa-${role}@medrota.local`);
  await page.locator('#lg-password').fill('QA_only_password_123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/dashboard/);
}

async function api(page, path, options = {}) {
  return page.evaluate(async ({ path, options }) => {
    const response = await fetch(`/api${path}`, { ...options, headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' } });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`);
    return body;
  }, { path, options });
}
const put = data => ({ method: 'PUT', body: JSON.stringify(data) });
const post = data => ({ method: 'POST', body: JSON.stringify(data) });
const dateKey = value => String(value).slice(0, 10);

test('availability date ranges keep every date through DST changes and at a single-day boundary', () => {
  expect(rangeKeys('2026-03-07', '2026-03-10')).toEqual(['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
  expect(rangeKeys('2026-11-01', '2026-11-01')).toEqual(['2026-11-01']);
});

test('dashboard finds current and upcoming blocks across academic years', () => {
  const old = { id: 'old', startDate: '2026-12-01', endDate: '2026-12-28' };
  const next = { id: 'next', startDate: '2027-01-05', endDate: '2027-02-01' };
  const later = { id: 'later', startDate: '2027-02-02', endDate: '2027-03-01' };
  expect(focusBlocksForDate([later, old, next], '2026-12-15').focusBlocks.map(item => item.id)).toEqual(['old', 'next']);
  expect(focusBlocksForDate([later, old, next], '2026-12-29').focusBlocks.map(item => item.id)).toEqual(['next']);
  expect(focusBlocksForDate([later, old, next], '2027-04-01').focusBlocks.map(item => item.id)).toEqual(['later']);
});

test('the affected date survives closing the day, workspace navigation and Back', async ({ page }) => {
  await login(page);
  const block = (await api(page, '/programs/mine')).blocks.find(item => item.number === 1);
  await page.goto(`/blocks/1/calendar?blockId=${block.id}&date=2026-06-15`);
  await expect(page.getByRole('dialog', { name: /Monday, 15 June 2026/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close day editor' }).click();
  await expect(page.getByRole('dialog', { name: /Monday, 15 June 2026/ })).toBeHidden();
  await expect(page).toHaveURL(/date=2026-06-15/);
  await page.getByRole('navigation', { name: 'Block workspace' }).getByRole('link', { name: 'Residents & availability' }).click();
  await expect(page).toHaveURL(/date=2026-06-15/);
  await page.goBack();
  await expect(page).toHaveURL(/calendar\?blockId=.*date=2026-06-15/);
  const affectedDay = page.getByRole('button', { name: 'Edit Monday, 15 June 2026' });
  await expect(affectedDay).toBeVisible();
  const dayDialog = page.getByRole('dialog', { name: /Monday, 15 June 2026/ });
  if (!(await dayDialog.isVisible())) await affectedDay.click();
  await expect(dayDialog).toBeVisible();
});

for (const width of [375, 768, 1024, 1440]) test(`published absence is repaired on the same day and republished with immutable history (${width}px)`, async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width, height: 900 });
  await login(page);
  const program = await api(page, '/programs/mine');
  const block = program.blocks.find(item => item.number === 1);
  const date = '2026-06-15';
  const beforeAssignments = await api(page, `/assignments?blockId=${block.id}`);
  const senior = beforeAssignments.find(item => item.roleOnDay === 'senior' && dateKey(item.callDay.date) === date);
  const junior = beforeAssignments.find(item => item.roleOnDay === 'junior' && dateKey(item.callDay.date) === date);
  const residents = (await api(page, `/residents/block/${block.id}/composition`)).inBlock;
  const replacement = residents.find(item => ['QA_ONLY Senior Resident', 'QA_ONLY Alternate Senior'].includes(item.name) && item.id !== senior.residentId && item.isActive);
  expect(replacement).toBeTruthy();
  const original = residents.find(item => item.id === senior.residentId);
  // Start from a known current public snapshot even when another spec edited QA data.
  await api(page, '/schedule/publish', post({ blockId: block.id, acknowledgeViolations: true }));
  const oldStatus = await api(page, `/schedule/publication-status?blockId=${block.id}`);
  expect(oldStatus.state).toBe('current');
  const oldHistory = (await api(page, `/schedule/history?blockId=${block.id}`))[0];
  try {
    await page.goto(`/blocks/1/calendar?blockId=${block.id}&date=${date}`);
    await expect(page.getByRole('dialog', { name: /Monday, 15 June 2026/ })).toBeVisible();
    await page.getByRole('button', { name: `Edit ${senior.resident.name} availability` }).click();
    const availability = page.getByRole('dialog', { name: /Availability/ });
    const dialogBounds = await availability.boundingBox();
    expect(dialogBounds.x).toBeGreaterThanOrEqual(0);
    expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(width + 1);
    await availability.getByLabel('Add other unavailable').fill(date);
    await availability.getByRole('button', { name: 'Add', exact: true }).nth(1).click();
    await availability.getByTestId('save-block-availability').click();
    await expect(page.getByRole('dialog', { name: /Monday, 15 June 2026/ })).toBeVisible();
    await expect(page.getByText('Assignment needs review')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`date=${date}`));
    expect((await api(page, `/residents/block/${block.id}/composition`)).inBlock.find(item => item.id === senior.residentId).otherUnavailableDates.map(dateKey)).toContain(date);
    expect((await api(page, `/assignments?blockId=${block.id}`)).find(item => item.roleOnDay === 'senior' && dateKey(item.callDay.date) === date).residentId).toBe(senior.residentId);
    await page.reload();
    await expect(page.getByRole('dialog', { name: /Monday, 15 June 2026/ })).toBeVisible();
    await page.locator('select[name="seniorId"]').selectOption(replacement.id);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await api(page, `/schedule/publication-status?blockId=${block.id}`)).state).toBe('changes_unpublished');
    await expect(page.getByTestId('workspace-publication')).toContainText('Changes not published');
    await page.reload();
    await expect(page.getByRole('dialog', { name: /Monday, 15 June 2026/ })).toBeVisible();
    expect((await api(page, `/assignments?blockId=${block.id}`)).find(item => item.roleOnDay === 'senior' && dateKey(item.callDay.date) === date).residentId).toBe(replacement.id);
    await page.getByRole('button', { name: 'Close day editor' }).click();
    await page.getByRole('button', { name: 'Validate schedule' }).click();
    await expect(page.getByRole('dialog', { name: /No scheduling rule violations|Schedule needs attention/ })).toBeVisible();
    await page.getByRole('button', { name: 'Close validation results' }).click();
    await page.getByRole('button', { name: 'Re-publish' }).click();
    await page.getByRole('dialog', { name: 'Publish Schedule' }).getByRole('button', { name: 'Publish', exact: true }).click();
    const acknowledgement = page.getByRole('dialog', { name: 'Review rule violations before publishing' });
    if (await acknowledgement.isVisible().catch(() => false)) await acknowledgement.getByRole('button', { name: 'Acknowledge issues and publish' }).click();
    await expect.poll(async () => (await api(page, `/schedule/publication-status?blockId=${block.id}`)).state).toBe('current');
    const history = await api(page, `/schedule/history?blockId=${block.id}`);
    expect(history.find(item => item.id === oldHistory.id).snapshotJson).toEqual(oldHistory.snapshotJson);
    const publicSchedule = await api(page, `/public/${block.publicToken}`);
    const publishedDay = publicSchedule.callDays.find(item => item.dateKey === date);
    expect(publishedDay.assignments.find(item => item.roleOnDay === 'senior').resident.name).toBe(replacement.displayName || replacement.name);
  } finally {
    await api(page, `/residents/${original.id}`, put({ blockId: block.id, vacationDates: original.vacationDates, otherUnavailableDates: original.otherUnavailableDates, academicTimes: original.academicTimes, availabilityConfirmed: original.availabilityConfirmed }));
    await api(page, '/assignments/day', put({ blockId: block.id, date, seniorId: senior.residentId, juniorId: junior.residentId, confirmOverride: true, overrideReason: 'Restore QA assignment after workflow test' }));
    await api(page, '/schedule/publish', post({ blockId: block.id, acknowledgeViolations: true }));
  }
});

for (const width of [375, 768, 1024, 1440]) test(`vacation range persists and removes only selected dates (${width}px)`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await login(page);
  const block = (await api(page, '/programs/mine')).blocks.find(item => item.number === 2);
  const resident = (await api(page, `/residents/block/${block.id}/composition`)).inBlock.find(item => item.isServiceResident);
  try {
    await page.goto(`/blocks/2?blockId=${block.id}`);
    await page.getByTestId(`overview-resident-${resident.id}`).getByRole('button', { name: /availability/i }).click();
    const dialog = page.getByRole('dialog', { name: /Availability/ });
    await dialog.getByLabel('Add vacation').fill('2026-07-02');
    await dialog.getByLabel('Vacation end date').fill('2026-07-08');
    await dialog.getByRole('button', { name: 'Add', exact: true }).first().click();
    await dialog.getByTestId('save-block-availability').click();
    const saved = (await api(page, `/residents/block/${block.id}/composition`)).inBlock.find(item => item.id === resident.id);
    expect(saved.vacationDates.map(dateKey).sort()).toEqual(['2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08']);
    await page.reload();
    await page.getByTestId(`overview-resident-${resident.id}`).getByRole('button', { name: /availability/i }).click();
    await dialog.getByLabel('Add vacation').fill('2026-07-04');
    await dialog.getByLabel('Vacation end date').fill('2026-07-06');
    await dialog.getByRole('button', { name: 'Remove range' }).first().click();
    await dialog.getByTestId('save-block-availability').click();
    const revised = (await api(page, `/residents/block/${block.id}/composition`)).inBlock.find(item => item.id === resident.id);
    expect(revised.vacationDates.map(dateKey).sort()).toEqual(['2026-07-02', '2026-07-03', '2026-07-07', '2026-07-08']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  } finally {
    await api(page, `/residents/${resident.id}`, put({ blockId: block.id, vacationDates: resident.vacationDates, otherUnavailableDates: resident.otherUnavailableDates, academicTimes: resident.academicTimes, availabilityConfirmed: resident.availabilityConfirmed }));
  }
});

test('attending edits mark a published draft dirty while directory contact edits do not', async ({ page }) => {
  await login(page, 'admin');
  const program = await api(page, '/programs/mine');
  const block = program.blocks.find(item => item.number === 1);
  const entry = (await api(page, `/attending?blockId=${block.id}`))[0];
  const resident = (await api(page, `/residents?programId=${program.programId}`))[0];
  await api(page, '/schedule/publish', post({ blockId: block.id, acknowledgeViolations: true }));
  try {
    expect((await api(page, `/schedule/publication-status?blockId=${block.id}`)).state).toBe('current');
    await api(page, `/residents/${resident.id}`, put({ phone: 'QA only contact edit' }));
    expect((await api(page, `/schedule/publication-status?blockId=${block.id}`)).state).toBe('current');
    await api(page, `/attending/${entry.id}`, put({ attendingName: entry.attendingName, activityLabel: 'QA only changed activity', isCallDay: entry.isCallDay }));
    expect((await api(page, `/schedule/publication-status?blockId=${block.id}`)).state).toBe('changes_unpublished');
    await page.goto('/dashboard');
    await expect(page.getByTestId(`attention-block-${block.id}`)).toContainText('Working schedule changed after publication');
    await expect(page.getByTestId(`attention-block-${block.id}`).getByRole('link', { name: 'Review and publish' })).toBeVisible();
    await api(page, `/attending/${entry.id}`, put({ attendingName: entry.attendingName, activityLabel: entry.activityLabel, isCallDay: entry.isCallDay }));
    expect((await api(page, `/schedule/publication-status?blockId=${block.id}`)).state).toBe('current');
  } finally {
    await api(page, `/residents/${resident.id}`, put({ phone: resident.phone }));
    await api(page, `/attending/${entry.id}`, put({ attendingName: entry.attendingName, activityLabel: entry.activityLabel, isCallDay: entry.isCallDay }));
  }
});

test('dashboard shows date-correct work and a viewer cannot edit contextual availability', async ({ page }) => {
  await login(page);
  const block = (await api(page, '/programs/mine')).blocks.find(item => item.number === 2);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'What needs attention?' })).toBeVisible();
  const attention = page.getByTestId(`attention-block-${block.id}`);
  await expect(attention).toContainText('Earlier block');
  await expect(page.getByText('% complete')).toHaveCount(0);
  await expect(attention.getByRole('link', { name: 'Review residents' }).first()).toHaveAttribute('href', new RegExp(`/blocks/2/residents\\?blockId=${block.id}`));
  await login(page, 'viewer');
  const publishedBlock = (await api(page, '/programs/mine')).blocks.find(item => item.number === 1);
  await page.goto(`/blocks/1/calendar?blockId=${publishedBlock.id}&date=2026-06-15`);
  await expect(page.getByRole('button', { name: /Edit .* availability/ })).toHaveCount(0);
  const assigned = (await api(page, `/assignments?blockId=${publishedBlock.id}`))[0];
  const forbidden = await page.evaluate(async ({ blockId, residentId }) => fetch(`/api/residents/${residentId}`, { method: 'PUT', headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId, otherUnavailableDates: ['2026-06-15'] }) }).then(response => response.status), { blockId: publishedBlock.id, residentId: assigned.residentId });
  expect(forbidden).toBe(403);
});
