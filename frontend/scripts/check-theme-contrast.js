#!/usr/bin/env node
/* global process */

/*
 * Contrast guard for the design tokens.
 *
 * A dark theme is easy to get *looking* right on the two screens you happen to
 * check and wrong everywhere else. This walks the token pairs that actually
 * occur in the product — every ink on every surface it is drawn on, every
 * status ink on its own soft fill, every solid action against its `--on-*`
 * foreground — and holds each one to WCAG AA. Both themes are checked from the
 * same table, so a value can never be tuned in light and forgotten in dark.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const themeFile = join(scriptDir, '..', 'src', 'styles', 'theme.css');

// ── token parsing ────────────────────────────────────────────────────────────

function parseBlock(css, selector) {
  const start = css.indexOf(selector + ' {');
  if (start === -1) throw new Error(`theme.css is missing the ${selector} block`);
  const open = css.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  const body = css.slice(open + 1, end);
  const tokens = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

// ── colour maths ─────────────────────────────────────────────────────────────

function parseColor(value) {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const rgba = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i);
  if (rgba) {
    return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
  }
  return null;
}

// Flattens a translucent colour onto an opaque one so overlays and tinted rings
// are judged as they are actually seen.
function over(fg, bg) {
  if (fg[3] >= 1) return fg;
  return [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
}

function luminance([r, g, b]) {
  const [R, G, B] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrast(fgValue, bgValue) {
  const bg = parseColor(bgValue);
  const fgRaw = parseColor(fgValue);
  if (!bg || !fgRaw) return null;
  const fg = over(fgRaw, bg);
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// ── the pairs the product actually renders ───────────────────────────────────

const SURFACES = ['--bg-canvas', '--surface-1', '--surface-2', '--surface-3', '--surface-raised'];

/** @type {Array<{fg: string, bg: string, min: number, note: string}>} */
const PAIRS = [];

function add(fg, bg, min, note) {
  PAIRS.push({ fg, bg, min, note });
}

// Every step of the ink ramp must clear AA everywhere it can land. None of it
// gets the 3:1 large-text allowance: the whole ramp is rendered at 10-14px in
// this product, and the quiet end carries field names, counts and empty-state
// messages that a reader has to be able to make out.
for (const bg of SURFACES) {
  add('--ink-1', bg, 4.5, 'primary text');
  add('--ink-2', bg, 4.5, 'body text');
  add('--ink-3', bg, 4.5, 'body text');
  add('--ink-4', bg, 4.5, 'secondary text');
  add('--ink-5', bg, 4.5, 'muted label, empty state, timestamp');
  add('--ink-placeholder', bg, 4.5, 'form placeholder');
}

// Sidebar has its own ground.
add('--ink-1', '--sidebar-bg', 4.5, 'sidebar text');
add('--ink-4', '--sidebar-bg', 4.5, 'sidebar secondary');
add('--ink-5', '--sidebar-bg', 4.5, 'sidebar muted');
add('--accent-muted', '--sidebar-bg', 4.5, 'sidebar nav label, selected');
add('--accent-muted-2', '--sidebar-bg', 4.5, 'sidebar nav label');
add('--accent-muted-2', '--surface-hover', 4.5, 'sidebar nav label, hovered');

// Hovered and selected rows keep their text legible.
for (const bg of ['--surface-hover', '--surface-active']) {
  add('--ink-1', bg, 4.5, 'text on interactive row');
  add('--ink-4', bg, 4.5, 'secondary on interactive row');
  add('--accent-ink', bg, 4.5, 'accent on interactive row');
}

// Links / accent text on every surface it appears on.
for (const bg of SURFACES) {
  add('--accent', bg, 4.5, 'link');
  add('--accent-ink', bg, 4.5, 'accent text');
}

// Status text on its own tinted fill — the pairing used by every badge,
// callout and violation row in the app.
const STATUS = [
  ['--danger-ink', '--danger-soft'], ['--danger-ink', '--danger-soft-2'],
  ['--danger-ink-strong', '--danger-soft'], ['--danger-ink-deep', '--danger-soft'],
  ['--success-ink', '--success-soft'], ['--success-ink', '--success-soft-2'],
  ['--success-ink-strong', '--success-soft'],
  ['--warn-ink', '--warn-soft'], ['--warn-ink', '--warn-soft-2'],
  ['--warn-ink-strong', '--warn-soft'], ['--warn-ink-deep', '--warn-soft'],
  ['--orange-ink', '--orange-soft'], ['--info-ink', '--info-soft'],
  ['--violet-ink', '--violet-soft'], ['--accent-ink', '--accent-soft'],
  ['--accent-ink', '--accent-soft-2'], ['--accent-ink', '--accent-soft-3'],
];
for (const [fg, bg] of STATUS) add(fg, bg, 4.5, 'status text on its tint');

// Status tints are also dropped straight onto page/card grounds; the text drawn
// on them there is the same status ink.
for (const soft of ['--danger-soft', '--success-soft', '--warn-soft', '--accent-soft', '--info-soft', '--violet-soft']) {
  add('--ink-1', soft, 4.5, 'primary text on a tinted panel');
}

// Solid actions against their declared foreground.
add('--on-brand', '--brand', 4.5, 'primary button label');
add('--on-brand', '--brand-hover', 4.5, 'primary button label, hover');
add('--on-accent', '--accent', 4.5, 'accent button label');
add('--on-danger', '--danger', 4.5, 'danger button label');
add('--on-danger', '--danger-hover', 4.5, 'danger button label, hover');
add('--on-success', '--success', 4.5, 'success button label');
add('--on-warn', '--warn', 4.5, 'warning button label');
add('--on-orange', '--orange', 4.5, 'reset button label');
add('--on-violet', '--violet', 4.5, 'academic button label');
add('--on-info', '--info', 4.5, 'info button label');
add('--ink-inverse', '--surface-inverse', 4.5, 'text on an inverted panel');

// Status colours are also drawn as text directly on cards and tints, and a
// status fill that carries a white label needs the same ratio as the colour used
// as text, so one check covers both roles.
for (const bg of ['--surface-1', '--bg-canvas', '--surface-2']) {
  add('--success', bg, 4.5, 'success text');
  add('--warn', bg, 4.5, 'warning text');
  add('--danger', bg, 4.5, 'danger text');
  add('--info', bg, 4.5, 'info text');
  add('--orange', bg, 4.5, 'reset text');
  add('--violet', bg, 4.5, 'academic text');
  add('--teal', bg, 4.5, 'categorical text');
  add('--cyan', bg, 4.5, 'categorical text');
  add('--indigo', bg, 4.5, 'categorical text');
}
add('--success', '--success-soft', 4.5, 'success text on its tint');
add('--warn', '--warn-soft', 4.5, 'warning text on its tint');
add('--danger', '--danger-soft', 4.5, 'danger text on its tint');
add('--danger', '--danger-soft-2', 4.5, 'danger text on its tint');
add('--info', '--info-soft', 4.5, 'info text on its tint');

// Non-text contrast (WCAG 1.4.11): borders, rings and marks that carry meaning
// must reach 3:1 against what surrounds them.
for (const bg of [...SURFACES, '--accent-soft', '--accent-soft-2']) {
  add('--border-strong', bg, 3, 'control boundary');
}
add('--border-strong', '--bg-canvas', 3, 'control boundary on canvas');
add('--focus-ring-color', '--surface-1', 3, 'focus ring');
add('--focus-ring-color', '--bg-canvas', 3, 'focus ring on canvas');
add('--day-today-ring', '--surface-1', 3, 'today ring');

/*
 * Chart bands. The pastel fills are deliberately below 3:1 — darkening them far
 * enough would have replaced the chart's palette rather than corrected it — so
 * each bar and legend swatch is drawn with a matching edge, and it is the edge
 * that has to satisfy 1.4.11. Dashboard.jsx pairs fill and edge in one table so
 * the two cannot drift apart.
 */
add('--chart-normal-edge', '--surface-1', 3, 'call-chart bar edge');
add('--chart-high-edge', '--surface-1', 3, 'call-chart bar edge');
add('--chart-over-edge', '--surface-1', 3, 'call-chart bar edge');

// ── run ──────────────────────────────────────────────────────────────────────

const css = readFileSync(themeFile, 'utf8');
const themes = {
  light: parseBlock(css, ':root'),
  dark: parseBlock(css, ':root[data-theme="dark"]'),
};

// The two blocks must define exactly the same token set, or a component styled
// with a token that only exists in light silently loses its colour in dark.
const lightKeys = Object.keys(themes.light).sort();
const darkKeys = Object.keys(themes.dark).sort();
const missingInDark = lightKeys.filter((k) => !darkKeys.includes(k));
const missingInLight = darkKeys.filter((k) => !lightKeys.includes(k));

const failures = [];
const parity = [];

for (const key of missingInDark) parity.push(`${key} is defined in light but not in dark`);
for (const key of missingInLight) parity.push(`${key} is defined in dark but not in light`);

/*
 * Both themes are held to the same absolute threshold.
 *
 * This used to grade light on a curve — "dark must be no worse than light" —
 * because light shipped with a quiet ink ramp that sat around 2.1:1 and
 * correcting it was out of scope at the time. That ramp has since been
 * re-spaced, so the allowance is gone and there is no theme-specific exemption
 * left in this file. A pair either meets its threshold in both themes or the
 * build fails.
 */
for (const { fg, bg, min, note } of PAIRS) {
  for (const [themeName, tokens] of Object.entries(themes)) {
    const fgValue = tokens[fg];
    const bgValue = tokens[bg];
    if (!fgValue || !bgValue) {
      failures.push(`${themeName}: ${fg} on ${bg} — token not defined`);
      continue;
    }
    const ratio = contrast(fgValue, bgValue);
    if (ratio === null) {
      failures.push(`${themeName}: ${fg} on ${bg} — unparseable colour`);
      continue;
    }
    if (ratio < min) {
      failures.push(
        `${themeName}: ${fg} (${fgValue}) on ${bg} (${bgValue}) = ${ratio.toFixed(2)}:1, `
        + `needs ${min}:1 — ${note}`
      );
    }
  }
}

if (parity.length) {
  console.error('Theme token parity failed.');
  for (const line of parity) console.error('  ' + line);
}

if (failures.length) {
  console.error(`Theme contrast guard failed (${failures.length} pairs).`);
  for (const line of failures) console.error('  ' + line);
} else if (!parity.length) {
  console.log(`Theme contrast guard passed: ${PAIRS.length} pairs x 2 themes, all at WCAG AA.`);
}

if (failures.length || parity.length) process.exitCode = 1;
