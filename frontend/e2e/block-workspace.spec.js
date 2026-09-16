import { expect, test } from '@playwright/test';
import { ownedName } from './qa-records.js';
import { resolveBlock, blockPath } from '../src/lib/blockNavigation.js';
import { formatBlockDate, getDaysFromDates, toISODate } from '../src/lib/blockUtils.js';

test.use({ timezoneId: 'America/New_York' });

async function login(page, role = 'chief') {
  await page.goto('/login');
  await page.evaluate(() => localStorage.setItem('medrota-theme', 'dark'));
  await page.reload();
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

for (const width of [375, 768, 1024, 1440]) {
  test(`prepare a block in two page transitions with the correct dates (${width}px)`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    const program = await api(page, '/programs/mine');
    const block = program.blocks.find(item => item.number === 2);
    const composition = await api(page, `/residents/block/${block.id}/composition`);
    const residents = composition.inBlock.filter(item => item.isServiceResident && !item.isMedStudent);
    const target = residents[0];
    const beforeEntries = await api(page, `/attending?blockId=${block.id}`);
    const beforeIds = new Set(beforeEntries.map(item => item.id));
    const name = ownedName(`Workspace attending MontgomeryWorthington ${width}`);
    let roster;
    const templates = [];
    try {
      // Fixture setup: an established weekly pattern and one resident left to
      // confirm. The job itself below uses the browser, not setup APIs.
      roster = await api(page, '/attending/roster', post({ programId: program.programId, attendingName: name, typicalActivities: [] }));
      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) templates.push(await api(page, `/attending-template/${program.programId}`, post({ attendingName: name, dayOfWeek, activityLabel: 'Ward' })));
      for (const resident of residents) await api(page, `/residents/${resident.id}`, put({ blockId: block.id, availabilityConfirmed: resident.id !== target.id }));

      await page.goto(`/blocks/2?blockId=${block.id}`);
      const header = page.getByTestId('block-workspace-header');
      await expect(header).toContainText('29 Jun 2026 – 12 Jul 2026');
      await expect(page.getByTestId('readiness-panel')).toContainText('3/4');
      await header.evaluate(element => { element.dataset.continuity = 'same-shell'; });
      const routeChanges = [];
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) routeChanges.push(new URL(frame.url()).pathname); });

      const row = page.getByTestId(`overview-resident-${target.id}`);
      const edit = row.getByRole('button', { name: /Confirm availability/ });
      await edit.click();
      await page.getByLabel('Add vacation').fill('2026-07-03');
      await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).first().click();
      await page.getByRole('button', { name: '+ Add academic time' }).click();
      await page.getByLabel('Academic day 1').selectOption('Tuesday');
      await page.getByLabel('Academic period 1').selectOption('PM');
      await page.getByTestId('save-block-availability').click();
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.getByTestId('readiness-panel')).toContainText('4/4');
      await expect(row.getByRole('button', { name: /Edit availability/ })).toBeFocused();
      const saved = (await api(page, `/residents/block/${block.id}/composition`)).inBlock.find(item => item.id === target.id);
      expect(saved.availabilityConfirmed).toBe(true);
      expect(saved.vacationDates.some(date => date.startsWith('2026-07-03'))).toBe(true);
      expect(saved.academicTimes).toContainEqual({ day: 'Tuesday', period: 'PM' });

      await page.getByRole('navigation', { name: 'Block workspace' }).getByRole('link', { name: 'Attendings', exact: true }).click();
      await expect(header).toHaveAttribute('data-continuity', 'same-shell');
      await expect(page.getByLabel('Workspace block')).toHaveValue(block.id);
      await expect(page.getByRole('button', { name: /29Jun.*Mon/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /12Jul.*Sun/ })).toBeVisible();
      await page.getByRole('button', { name: 'Apply template to block', exact: true }).click();
      await page.getByRole('button', { name: /This block only/ }).click();
      await expect.poll(async () => (await api(page, `/blocks/${block.id}/readiness`)).attending.complete).toBe(true);

      await page.getByRole('navigation', { name: 'Block workspace' }).getByRole('link', { name: 'Schedule', exact: true }).click();
      await expect(header).toHaveAttribute('data-continuity', 'same-shell');
      await expect(page.getByTestId('readiness-panel')).toContainText('14/14');
      await expect(page.getByTestId('readiness-panel')).toContainText('Preparation is complete');
      await expect(page.getByRole('button', { name: 'Auto-generate', exact: true })).toBeEnabled();
      expect(routeChanges).toEqual(['/blocks/2/attending', '/blocks/2/calendar']);
      const ready = await api(page, `/blocks/${block.id}/readiness`);
      expect(ready.readyToGenerate).toBe(true);
      expect(ready.blockers).toEqual([]);
      expect(ready.residents.enrolledJuniors).toBeGreaterThan(0);
      expect(ready.residents.enrolledSeniors).toBeGreaterThan(0);

      // Refresh must keep block identity and date boundaries, including the last
      // day that was missing from the old attending editor in this timezone.
      await page.reload();
      await expect(page.getByLabel('Workspace block')).toHaveValue(block.id);
      await expect(page.getByRole('heading', { name: 'Block 2 Calendar' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Edit Sunday, 12 July 2026' })).toContainText(name);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      const clippedDays = await page.getByRole('button', { name: /^Edit (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),/ }).evaluateAll(elements => elements.filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.left < 0 || rect.right > innerWidth || el.scrollWidth > el.clientWidth + 1;
      }).map(el => el.getAttribute('aria-label')));
      expect(clippedDays).toEqual([]);
      await page.getByRole('navigation', { name: 'Block workspace' }).getByRole('link', { name: 'Overview', exact: true }).click();
      await expect(page.getByTestId(`overview-resident-${target.id}`)).toBeVisible();
      const clipped = await page.locator('.workspace-resident, .workspace-nav a').evaluateAll(elements => elements.filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.left < 0 || rect.right > innerWidth || el.scrollWidth > el.clientWidth + 1;
      }).map(el => el.textContent));
      expect(clipped).toEqual([]);
    } finally {
      // Restore exactly the QA state observed before this task, including user
      // entered dates. Only rows this test's Apply operation created are removed.
      const entries = await api(page, `/attending?blockId=${block.id}`);
      for (const item of entries.filter(item => !beforeIds.has(item.id))) await api(page, `/attending/${item.id}`, { method: 'DELETE' });
      for (const item of beforeEntries) await api(page, `/attending/${item.id}`, put({ attendingName: item.attendingName, activityLabel: item.activityLabel, isCallDay: item.isCallDay }));
      for (const item of templates) await api(page, `/attending-template/entry/${item.id}`, { method: 'DELETE' });
      if (roster) await api(page, `/attending/roster/${roster.id}`, put({ isActive: false }));
      for (const resident of residents) await api(page, `/residents/${resident.id}`, put({ blockId: block.id, vacationDates: resident.vacationDates, otherUnavailableDates: resident.otherUnavailableDates, academicTimes: resident.academicTimes, availabilityConfirmed: resident.availabilityConfirmed }));
    }
  });
}

test('block search finds an existing rotating resident and keyboard navigation retains context', async ({ page }) => {
  await login(page);
  await page.goto('/blocks/2/residents');
  await page.getByLabel('Find residents in either list').fill('Student');
  await expect(page.locator('li[data-testid^="block-resident-"]')).toHaveCount(1);
  const nav = page.getByRole('navigation', { name: 'Block workspace' });
  await nav.getByRole('link', { name: 'Overview' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Block overview' })).toBeVisible();
  await expect(page.locator('.workspace-content')).toBeFocused();
  await page.getByLabel('Find a resident').fill('Junior');
  await expect(page.locator('[data-testid^="overview-resident-"]')).toHaveCount(2);
});

test('unknown block links fail closed and viewers receive read-only workspace actions', async ({ page }) => {
  await login(page, 'viewer');
  await page.goto('/blocks/1');
  await expect(page.getByTestId('workspace-publication')).toContainText('Read-only access');
  await expect(page.getByTestId('residents-this-block')).toBeVisible();
  await expect(page.getByRole('button', { name: /Confirm availability|Manage block residents|Availability/ })).toHaveCount(0);
  await expect(page.getByTestId('readiness-panel')).toHaveCount(0);
  await page.goto('/blocks/2');
  await expect(page.getByRole('alert')).toContainText('not published');
  await page.goto('/blocks/999');
  await expect(page.getByRole('heading', { name: 'Block not found' })).toBeVisible();
  await expect(page.getByTestId('residents-this-block')).toHaveCount(0);
  await page.goto('/blocks/1?blockId=not-a-real-block');
  await expect(page.getByRole('heading', { name: 'Block not found' })).toBeVisible();
});

test('stable block IDs disambiguate years and logical dates survive DST', () => {
  const previous = { id: 'previous', number: 1 };
  const next = { id: 'next', number: 1 };
  const academicYears = [{ id: 'year-a', blocks: [previous] }, { id: 'year-b', blocks: [next] }];
  const context = { academicYears, currentAcademicYear: academicYears[0], currentBlock: previous, blockNumber: '1' };
  expect(resolveBlock({ ...context, blockId: 'next' })).toBe(next);
  expect(resolveBlock({ ...context, blockId: 'missing' })).toBeNull();
  expect(resolveBlock({ ...context, blockId: 'next', blockNumber: '2' })).toBeNull();
  expect(blockPath(next, 'calendar')).toBe('/blocks/1/calendar?blockId=next');
  expect(getDaysFromDates('2026-03-07T00:00:00.000Z', '2026-03-10T00:00:00.000Z').map(toISODate)).toEqual(['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
  expect(formatBlockDate('2026-06-29T00:00:00.000Z')).toBe('29 Jun 2026');
});

test('a failed readiness request cannot look ready and can be retried', async ({ page }) => {
  await login(page);
  await page.route('**/api/blocks/*/readiness', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Preparation temporarily unavailable' }) }));
  await page.goto('/blocks/2');
  await expect(page.getByRole('alert')).toContainText('Preparation temporarily unavailable');
  await expect(page.getByTestId('block-next-action')).toHaveCount(0);
  await page.unroute('**/api/blocks/*/readiness');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('readiness-panel')).toBeVisible();
  await expect(page.getByTestId('residents-this-block')).toBeVisible();
});

test('switching blocks replaces local edits and preserves publication context through Back', async ({ page }) => {
  await login(page);
  const program = await api(page, '/programs/mine');
  const first = program.blocks.find(block => block.number === 1);
  const second = program.blocks.find(block => block.number === 2);
  await page.goto(`/blocks/2?blockId=${second.id}`);
  await page.getByLabel('Find a resident').fill('does not match');
  await expect(page.getByText('No residents match your search.')).toBeVisible();
  await page.getByLabel('Workspace block').selectOption(first.id);
  await expect(page.getByLabel('Find a resident')).toHaveValue('');
  const publication = await api(page, `/schedule/publication-status?blockId=${first.id}`);
  await expect(page.getByTestId('workspace-publication')).toContainText(publication.state === 'current' ? 'Working schedule matches the public version' : 'Changes not published');
  await expect(page.getByLabel('Workspace block')).toHaveValue(first.id);
  await page.getByRole('navigation', { name: 'Block workspace' }).getByRole('link', { name: 'Schedule', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Block 1 Calendar' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Block overview' })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('Workspace block')).toHaveValue(second.id);
  await expect(page.getByTestId('workspace-publication')).toContainText('No public schedule yet');
});

test('limited Chief permissions do not expose availability or attending mutations', async ({ page }) => {
  await login(page);
  await page.route('**/api/programs/mine', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.permissions = body.permissions.filter(permission => !['manage_block_availability', 'manage_attending_schedule'].includes(permission));
    await route.fulfill({ response, json: body });
  });
  await page.goto('/blocks/2');
  await expect(page.getByTestId('residents-this-block')).toBeVisible();
  await expect(page.getByTestId('residents-this-block').getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Block workspace' }).getByRole('link', { name: 'Attendings' })).toHaveCount(0);
  await page.goto('/blocks/2/attending');
  await expect(page.getByText('You do not have permission to manage attending coverage. Open the schedule to view published coverage.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply template to block' })).toHaveCount(0);
});
