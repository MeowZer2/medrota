import { expect, test } from '@playwright/test';

// Dark theme regression coverage. The failure this exists to prevent is the one
// that already happened once: a theme that is applied to most of the app and
// missed on the rest, so some cards go dark while other surfaces, inputs and
// modals stay white. Rather than compare screenshots, these walk the rendered
// DOM and assert the two things that actually go wrong — a large light fill on
// a dark page, and text that has sunk into the surface behind it.

const PASSWORD = 'QA_only_password_123!';
test.describe.configure({ mode: 'serial' });

const PAGES = [
  { label: 'dashboard', path: '/dashboard' },
  { label: 'calendar', path: '/calendar' },
  { label: 'residents', path: '/residents' },
  { label: 'attending schedule', path: '/attending' },
  { label: 'block', path: '/blocks/1' },
  { label: 'block residents', path: '/blocks/1/residents' },
  { label: 'block settings', path: '/blocks/1/settings' },
  // Each Program Settings section mounts its own controls, so each is checked.
  { label: 'settings: general', path: '/settings?tab=general' },
  { label: 'settings: clinical structure', path: '/settings?tab=clinical' },
  { label: 'settings: attendings', path: '/settings?tab=attendings' },
  { label: 'settings: scheduling', path: '/settings?tab=scheduling' },
  { label: 'settings: access', path: '/settings?tab=access' },
  { label: 'settings: history', path: '/settings?tab=history' },
];

async function login(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#lg-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/dashboard|\/setup/, { timeout: 20_000 });
}

// Runs in the page. Returns human-readable descriptions of anything that is
// still painting light, or any text that cannot be read off its own background.
const DARK_SURFACE_AUDIT = `(() => {
  function luminance(value) {
    const m = value.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
    if (!m) return null;
    const alpha = m[4] === undefined ? 1 : Number(m[4]);
    // A mostly transparent fill shows whatever is behind it, so it is not the
    // element's own colour and cannot be judged here.
    if (alpha < 0.5) return null;
    const [r, g, b] = [m[1], m[2], m[3]].map(Number).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function describe(el) {
    const cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
      : '';
    return el.tagName.toLowerCase() + cls;
  }

  const problems = [];

  for (const el of document.querySelectorAll('body *')) {
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    if (Number(style.opacity) < 0.1) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 12) continue;

    const bg = luminance(style.backgroundColor);
    if (bg === null) continue;

    // Buttons and badges are meant to be bright; a large panel is not. The area
    // threshold is what separates an intentional accent from a missed surface.
    if (bg > 0.6 && rect.width * rect.height > 12000) {
      problems.push('light fill: ' + describe(el) + ' ' + style.backgroundColor
        + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height));
    }

    const fg = luminance(style.color);
    const text = (el.textContent || '').trim();
    if (fg !== null && el.children.length === 0 && text.length > 2) {
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      if (ratio < 1.6) {
        problems.push('unreadable text: ' + describe(el) + ' "' + text.slice(0, 32)
          + '" ' + style.color + ' on ' + style.backgroundColor);
      }
    }
  }

  return problems;
})()`;

test.describe('dark theme', () => {
  test.use({ colorScheme: 'dark' });

  test('every authenticated surface is themed', async ({ page }) => {
    test.setTimeout(180_000);

    // The app resolves this before first paint, so the pages below never render
    // a light frame first.
    await page.addInitScript(() => {
      try { localStorage.setItem('medrota-theme', 'dark'); } catch { /* storage blocked */ }
    });

    await page.goto('/login');
    expect(await page.getAttribute('html', 'data-theme'), 'login honours the stored theme').toBe('dark');
    expect(await page.evaluate(DARK_SURFACE_AUDIT), 'unthemed surfaces on login').toEqual([]);

    await login(page, 'qa-admin@medrota.local');

    for (const { label, path } of PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(await page.getAttribute('html', 'data-theme'), `${label} stays dark`).toBe('dark');
      expect(await page.evaluate(DARK_SURFACE_AUDIT), `unthemed surfaces on ${label}`).toEqual([]);
    }
  });

  test('the calendar day dialog is themed', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('medrota-theme', 'dark'); } catch { /* storage blocked */ }
    });
    await login(page, 'qa-admin@medrota.local');

    await page.goto('/calendar');
    await page.waitForLoadState('networkidle');

    // A modal is its own stacking context and was one of the surfaces the last
    // attempt left white, so it is opened and audited rather than assumed.
    // Same seeded day the calendar specs use.
    await page.getByRole('button', { name: 'Edit Tuesday, 16 June 2026' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(DARK_SURFACE_AUDIT), 'unthemed surfaces in the day dialog').toEqual([]);
  });
});

test('the theme preference survives a reload and drives the document', async ({ page }) => {
  await login(page, 'qa-admin@medrota.local');
  await page.goto('/dashboard');

  await page.getByRole('radio', { name: 'Dark theme' }).click();
  expect(await page.getAttribute('html', 'data-theme')).toBe('dark');

  await page.reload();
  await page.waitForLoadState('networkidle');
  expect(await page.getAttribute('html', 'data-theme'), 'dark survives a reload').toBe('dark');

  await page.getByRole('radio', { name: 'Light theme' }).click();
  expect(await page.getAttribute('html', 'data-theme')).toBe('light');

  await page.reload();
  await page.waitForLoadState('networkidle');
  expect(await page.getAttribute('html', 'data-theme'), 'light survives a reload').toBe('light');
});
