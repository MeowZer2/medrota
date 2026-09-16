import { expect, test } from '@playwright/test';

// Viewport regression coverage for the core workflows. The rule these enforce is
// simple and was genuinely broken before: no page may scroll sideways, and no
// dialog may be wider than the screen or taller than the viewport.

const PASSWORD = 'QA_only_password_123!';
test.describe.configure({ mode: 'serial' });

const VIEWPORTS = [
  { label: 'phone', width: 375, height: 812 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'small laptop', width: 1024, height: 768 },
  { label: 'desktop', width: 1440, height: 900 },
];

const PAGES = [
  { label: 'block overview', path: '/blocks/1' },
  { label: 'block residents', path: '/blocks/1/residents' },
  { label: 'block attendings', path: '/blocks/1/attending' },
  { label: 'block schedule', path: '/blocks/1/calendar' },
  { label: 'calendar', path: '/calendar' },
  { label: 'residents', path: '/residents' },
  { label: 'attending schedule', path: '/attending' },
  { label: 'block settings', path: '/blocks/1/settings' },
  { label: 'program settings', path: '/settings' },
  // Each Program Settings section mounts different rows, so each is measured.
  { label: 'settings: clinical structure', path: '/settings?tab=clinical' },
  { label: 'settings: attendings', path: '/settings?tab=attendings' },
  { label: 'settings: scheduling', path: '/settings?tab=scheduling' },
  { label: 'settings: access', path: '/settings?tab=access' },
  { label: 'settings: history', path: '/settings?tab=history' },
  { label: 'dashboard', path: '/dashboard' },
];

async function login(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#lg-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/dashboard|\/setup/, { timeout: 20_000 });
}

async function expectNoHorizontalScroll(page, label) {
  const measurement = await page.evaluate(() => {
    const doc = document.documentElement;
    const offenders = [...document.querySelectorAll('body *')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className : '',
          overflow: Math.round(rect.right - window.innerWidth),
        };
      })
      .filter((entry) => entry.overflow > 0)
      .sort((a, b) => b.overflow - a.overflow)
      .slice(0, 3);
    return { overflow: doc.scrollWidth - doc.clientWidth, offenders };
  });
  expect(
    measurement.overflow,
    `${label} must not scroll horizontally; offenders: ${JSON.stringify(measurement.offenders)}`,
  ).toBeLessThanOrEqual(0);
}

for (const viewport of VIEWPORTS) {
  test(`core pages fit the ${viewport.label} viewport (${viewport.width}px)`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await login(page, 'qa-admin@medrota.local');

    for (const target of PAGES) {
      await page.goto(target.path);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalScroll(page, `${target.label} at ${viewport.width}px`);
    }
  });
}

test('public schedule and login fit a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });

  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await expectNoHorizontalScroll(page, 'login at 375px');

  await page.goto('/register');
  await page.waitForLoadState('networkidle');
  await expectNoHorizontalScroll(page, 'register at 375px');

  await login(page, 'qa-chief@medrota.local');
  await page.goto('/calendar');
  const publicUrl = await page.locator('input[readonly]').first().inputValue();
  await page.goto(publicUrl);
  await page.waitForLoadState('networkidle');
  await expectNoHorizontalScroll(page, 'public schedule at 375px');
});

test('dialogs fit a phone screen and stay reachable', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, 'qa-chief@medrota.local');

  const openers = [
    { label: 'validation', open: async () => page.getByRole('button', { name: 'Validate schedule' }).click(), path: '/calendar' },
    { label: 'publish', open: async () => page.getByRole('button', { name: /^Re-publish$|^Publish$/ }).click(), path: '/calendar' },
    { label: 'add resident', open: async () => page.getByRole('button', { name: 'Add Resident' }).click(), path: '/residents' },
  ];

  for (const opener of openers) {
    await page.goto(opener.path);
    await page.waitForLoadState('networkidle');
    await opener.open();

    const dialog = page.getByRole('dialog');
    await expect(dialog, `${opener.label} dialog should open`).toBeVisible();

    const box = await dialog.boundingBox();
    expect(box.width, `${opener.label} dialog must fit the screen width`).toBeLessThanOrEqual(375);
    expect(box.height, `${opener.label} dialog must fit the viewport height`).toBeLessThanOrEqual(812);
    expect(box.y, `${opener.label} dialog must start on screen`).toBeGreaterThanOrEqual(0);
    await expectNoHorizontalScroll(page, `${opener.label} dialog at 375px`);

    // Escape must close every dialog.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog'), `${opener.label} dialog should close on Escape`).toBeHidden();
  }
});

test('icon-only controls are large enough to tap on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, 'qa-chief@medrota.local');
  await page.goto('/residents');
  await page.waitForLoadState('networkidle');

  // Every button whose only content is an icon must still be a usable target.
  const tooSmall = await page.evaluate(() => {
    const offenders = [];
    for (const el of document.querySelectorAll('button, [role="switch"]')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.height < 32 || rect.width < 32) {
        offenders.push(`${el.tagName.toLowerCase()} ${Math.round(rect.width)}x${Math.round(rect.height)} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}"`);
      }
    }
    return offenders;
  });
  expect(tooSmall, 'controls smaller than 32px on a phone').toEqual([]);
});
