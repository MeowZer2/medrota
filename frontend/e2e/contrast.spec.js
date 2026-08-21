import { expect, test } from '@playwright/test';

/*
 * Rendered accessibility coverage for both themes.
 *
 * The static guard (`npm run theme:contrast`) checks token pairs; it can only
 * check pairs someone thought to list. This checks what the browser actually
 * paints: every text node against the background it is really composited onto,
 * and every form control's boundary against the surface around it.
 *
 * It exists because the light theme shipped with roughly 280 failing text nodes
 * — muted labels around 2.5:1, white-on-green actions at 3.3:1 — that no unit
 * test could see. Both figures are now zero, and these assertions are what keeps
 * them there rather than a report someone has to remember to read.
 *
 * WCAG 2.1 AA: 4.5:1 normal text, 3:1 large text (>=24px, or >=18.66px bold),
 * 3:1 for the visual boundary that identifies a user interface component.
 */

const PASSWORD = 'QA_only_password_123!';
test.describe.configure({ mode: 'serial' });

const PAGES = [
  { label: 'dashboard', path: '/dashboard' },
  { label: 'calendar', path: '/calendar' },
  { label: 'resident directory', path: '/residents' },
  { label: 'attending schedule', path: '/attending' },
  { label: 'block', path: '/blocks/1' },
  { label: 'block residents', path: '/blocks/1/residents' },
  { label: 'block settings', path: '/blocks/1/settings' },
  { label: 'settings: general', path: '/settings?tab=general' },
  { label: 'settings: clinical structure', path: '/settings?tab=clinical' },
  { label: 'settings: attendings', path: '/settings?tab=attendings' },
  { label: 'settings: scheduling', path: '/settings?tab=scheduling' },
  { label: 'settings: access', path: '/settings?tab=access' },
  { label: 'settings: history', path: '/settings?tab=history' },
];

// Shared colour maths, injected into the page for both audits below.
const COLOUR_HELPERS = `
  function parseColour(value) {
    const m = String(value).match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  }
  function over(fg, bg) {
    const a = fg[3];
    return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)).concat(1);
  }
  function luminance(c) {
    const [r, g, b] = c.slice(0, 3).map(x => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function ratio(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  // Composites every ancestor fill down to one opaque colour, which is what the
  // eye actually sees behind a translucent tint.
  function effectiveBackground(el) {
    let acc = null;
    let node = el;
    while (node) {
      const c = parseColour(getComputedStyle(node).backgroundColor);
      if (c && c[3] > 0) acc = acc === null ? c : over(acc, c);
      if (acc !== null && acc[3] >= 1) return acc;
      node = node.parentElement;
    }
    return [255, 255, 255, 1];
  }
  // A gradient cannot be reduced to one colour, so elements painted with one are
  // left to the eye rather than reported as a false failure.
  function paintedWithGradient(el) {
    let node = el;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (style.backgroundImage && style.backgroundImage.includes('gradient')) return true;
      const c = parseColour(style.backgroundColor);
      if (c && c[3] >= 1) return false;
      node = node.parentElement;
    }
    return false;
  }
  function describe(el) {
    const cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
      : '';
    return el.tagName.toLowerCase() + cls;
  }
`;

const TEXT_AUDIT = `(() => {
  ${COLOUR_HELPERS}
  const problems = [];
  const seen = new Set();

  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const ownText = [...el.childNodes]
      .filter(n => n.nodeType === 3 && n.textContent.trim().length > 1);
    const showsPlaceholder = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      && el.placeholder && !el.value;
    if (ownText.length === 0 && !showsPlaceholder) continue;
    if (paintedWithGradient(el)) continue;

    const size = parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || 400;
    const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = isLarge ? 3 : 4.5;

    const background = effectiveBackground(el);
    const foreground = showsPlaceholder
      ? parseColour(getComputedStyle(el, '::placeholder').color)
      : parseColour(style.color);
    if (!foreground) continue;

    const measured = ratio(over(foreground, background), background);
    if (measured >= required) continue;

    const text = showsPlaceholder
      ? 'placeholder "' + el.placeholder + '"'
      : '"' + ownText.map(n => n.textContent.trim()).join(' ').slice(0, 40) + '"';
    const key = describe(el) + text + Math.round(measured * 100);
    if (seen.has(key)) continue;
    seen.add(key);

    problems.push(
      describe(el) + ' ' + text + ' at ' + Math.round(size) + 'px/' + weight
      + ' is ' + measured.toFixed(2) + ':1, needs ' + required + ':1'
    );
  }
  return problems;
})()`;

const BOUNDARY_AUDIT = `(() => {
  ${COLOUR_HELPERS}
  const problems = [];
  const seen = new Set();

  for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) continue;
    // Checkboxes, radios and colour wells are drawn by the platform from
    // accent-color and color-scheme, not from a border we set.
    if (['checkbox', 'radio', 'color', 'range'].includes(el.type)) continue;

    const surrounding = effectiveBackground(el.parentElement || document.body);
    const width = parseFloat(style.borderTopWidth) || 0;

    let mark;
    let how;
    if (width > 0 && style.borderTopStyle !== 'none') {
      const border = parseColour(style.borderTopColor);
      if (!border) continue;
      mark = over(border, surrounding);
      how = 'border ' + style.borderTopColor;
    } else {
      // With no border, the control's own fill has to distinguish it.
      mark = effectiveBackground(el);
      how = 'fill ' + style.backgroundColor + ' (no border)';
    }

    const measured = ratio(mark, surrounding);
    if (measured >= 3) continue;

    const name = el.name || el.id || el.placeholder || describe(el);
    const key = name + how;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push(name + ': ' + how + ' is ' + measured.toFixed(2) + ':1 against the surface behind it, needs 3:1');
  }
  return problems;
})()`;

async function login(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#lg-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/dashboard|\/setup/, { timeout: 20_000 });
}

for (const theme of ['light', 'dark']) {
  test(`${theme}: every rendered text node and control boundary meets WCAG AA`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript((value) => {
      try { localStorage.setItem('medrota-theme', value); } catch { /* storage blocked */ }
    }, theme);

    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(TEXT_AUDIT), `text contrast on login (${theme})`).toEqual([]);
    expect(await page.evaluate(BOUNDARY_AUDIT), `control boundaries on login (${theme})`).toEqual([]);

    await login(page, 'qa-admin@medrota.local');

    for (const { label, path } of PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(await page.evaluate(TEXT_AUDIT), `text contrast on ${label} (${theme})`).toEqual([]);
      expect(await page.evaluate(BOUNDARY_AUDIT), `control boundaries on ${label} (${theme})`).toEqual([]);
    }

    // Dialogs carry their own surfaces and their own form controls.
    await page.goto('/calendar');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Edit Tuesday, 16 June 2026' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.evaluate(TEXT_AUDIT), `text contrast in the day dialog (${theme})`).toEqual([]);
    expect(await page.evaluate(BOUNDARY_AUDIT), `control boundaries in the day dialog (${theme})`).toEqual([]);
  });
}
