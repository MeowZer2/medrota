#!/usr/bin/env node
/* global process */

/*
 * Theme token guard.
 *
 * The last dark-mode attempt shipped half-finished, and the reason was
 * structural: most of this app is styled with inline `style={{ … }}` objects,
 * which no `.dark .card { … }` override can reach. The fix was to route every
 * colour through a custom property. This guard is what keeps it that way.
 *
 * It fails the build when:
 *   1. a colour literal (hex, rgb(), hsl()) appears anywhere in src outside the
 *      token definitions themselves — one of those is one surface that will not
 *      follow the theme;
 *   2. a token is used against the wrong kind of property — an ink token as a
 *      fill, or a surface/border token as text. Those look plausible in the
 *      theme they were written in and invert in the other one;
 *   3. a token is referenced that no theme block defines, which silently
 *      renders as nothing at all.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(scriptDir, '..');
const srcRoot = join(frontendRoot, 'src');
const themeFile = join(srcRoot, 'styles', 'theme.css');

// theme.css is where the literals are supposed to live.
const LITERAL_ALLOWED = new Set(['src/styles/theme.css']);

// Leftover Vite scaffolding. Nothing imports it and it styles no part of the
// product, so it is neither themed nor checked.
const SKIPPED = new Set(['src/App.css']);

const EXTENSIONS = new Set(['.css', '.js', '.jsx']);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : (EXTENSIONS.has(extname(name)) ? [full] : []);
  });
}

function rel(file) {
  return relative(frontendRoot, file).replaceAll('\\', '/');
}

// ── which tokens exist ───────────────────────────────────────────────────────

const themeCss = readFileSync(themeFile, 'utf8');
const defined = new Set([...themeCss.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]));

// Tailwind generates these from the `@theme inline` block in index.css.
const indexCss = readFileSync(join(srcRoot, 'index.css'), 'utf8');
for (const m of indexCss.matchAll(/^\s*(--color-[a-z0-9-]+)\s*:/gim)) defined.add(m[1]);
// Page-local aliases are declared where they are used.
for (const file of walk(srcRoot)) {
  if (extname(file) !== '.css') continue;
  for (const m of readFileSync(file, 'utf8').matchAll(/^\s*(--lg-[a-z0-9-]+)\s*:/gim)) defined.add(m[1]);
}

// ── role tables ──────────────────────────────────────────────────────────────

const INK_TOKEN = /^--(ink-\d|ink-disabled|ink-inverse|.*-ink(-.*)?)$/;
const FILL_TOKEN = /^--(surface-.*|bg-.*|.*-soft(-\d)?|border-.*|.*-border(-\d)?|skeleton-.*|day-.*|overlay.*|scrollbar-.*|sidebar-bg|chart-.*)$/;

// `color: var(--danger)` and `background: var(--danger)` are both legitimate —
// a status hue is allowed to be either. Only the explicitly ink-named and
// explicitly fill-named tokens are constrained.

const errors = [];
const literals = [];

// A colour literal, but not a CSS length, an id selector, or a hex in a comment
// about one. Also skips SVG path data, which is digits and letters but never a
// `#rrggbb` token.
const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g;
const FUNC = /\b(?:rgba?|hsla?|lab|lch|oklab|oklch|color)\s*\(/g;

/*
 * Named CSS colours. These are the easiest ones to miss — `background: 'white'`
 * reads as harmless and is invisible to any search for `#`, but it pins that
 * surface to white in every theme. (`transparent` and `currentColor` are fine:
 * both follow whatever is behind or around them.)
 */
const NAMED = new RegExp(
  String.raw`(?:^|[\s:'"\`(,])(?:white|black|red|blue|green|yellow|orange|purple|pink|brown|gray|grey|silver|gold|navy|teal|maroon|olive|lime|aqua|cyan|magenta|fuchsia|beige|ivory|snow|azure|coral|crimson|indigo|khaki|lavender|linen|orchid|plum|salmon|sienna|tan|thistle|tomato|turquoise|violet|wheat|whitesmoke|gainsboro|(?:light|dark)(?:gray|grey|blue|green|red|pink|salmon|seagreen|slategray|slategrey|steelblue|goldenrod|khaki|cyan|magenta|orange|violet))(?=['"\`;,)\s]|$)`,
  'g'
);

// Only inspect the value side of a colour-bearing declaration, so prose,
// class names and unrelated identifiers are not mistaken for colours.
const COLOUR_DECL = /\b(background|backgroundColor|background-color|color|borderColor|border-color|border|borderTop|borderBottom|borderLeft|borderRight|border-top|border-bottom|border-left|border-right|outline|outlineColor|fill|stroke|boxShadow|box-shadow|caretColor|caret-color|accentColor|accent-color|textDecorationColor|stopColor)\s*[:=]\s*(['"`]?)([^;,}\n]*)/g;

for (const file of walk(srcRoot)) {
  const relPath = rel(file);
  if (SKIPPED.has(relPath)) continue;
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  if (!LITERAL_ALLOWED.has(relPath)) {
    /*
     * A literal is occasionally correct: a colour that is persisted as user data
     * cannot be a token, because the token name would be what gets written to
     * the database. Those are opted out explicitly and with a reason, between
     *   theme-guard-allow-start: <why>
     *   theme-guard-allow-end
     * so the exemption is visible where the colours are rather than buried in an
     * allowlist here.
     */
    let exempt = false;

    lines.forEach((line, i) => {
      if (line.includes('theme-guard-allow-start')) { exempt = true; return; }
      if (line.includes('theme-guard-allow-end')) { exempt = false; return; }
      if (exempt) return;

      // Ignore comment-only lines: prose may legitimately name a colour.
      const trimmed = line.trim();
      if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;

      for (const m of line.matchAll(HEX)) {
        literals.push(`${relPath}:${i + 1} hard-coded colour ${m[0]} — use a token from styles/theme.css`);
      }
      for (const m of line.matchAll(FUNC)) {
        literals.push(`${relPath}:${i + 1} hard-coded ${m[0].replace(/\s*\($/, '()')} — use a token from styles/theme.css`);
      }
      for (const decl of line.matchAll(COLOUR_DECL)) {
        for (const named of decl[3].matchAll(NAMED)) {
          literals.push(
            `${relPath}:${i + 1} named colour "${named[0].trim()}" in ${decl[1]} — `
            + 'use a token from styles/theme.css'
          );
        }
      }
    });
  }

  lines.forEach((line, i) => {
    const where = `${relPath}:${i + 1}`;

    for (const m of line.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
      if (!defined.has(m[1])) errors.push(`${where} undefined token ${m[1]}`);
    }

    for (const m of line.matchAll(/\b(background|backgroundColor|background-color)\s*:\s*['"`]?var\(\s*(--[a-z0-9-]+)/gi)) {
      if (INK_TOKEN.test(m[2])) errors.push(`${where} ${m[1]} uses the ink token ${m[2]}`);
    }
    for (const m of line.matchAll(/\.style\.(background|backgroundColor)\s*=\s*['"`]?var\(\s*(--[a-z0-9-]+)/gi)) {
      if (INK_TOKEN.test(m[2])) errors.push(`${where} hover fill uses the ink token ${m[2]}`);
    }
    // Only `color`. An SVG `fill`/`stroke` is a paint property in its own right
    // and may quite reasonably be given a surface or border token.
    for (const m of line.matchAll(/(?<![a-zA-Z-])color\s*:\s*['"`]?var\(\s*(--[a-z0-9-]+)/gi)) {
      if (FILL_TOKEN.test(m[1])) errors.push(`${where} text colour uses the fill token ${m[1]}`);
    }
  });
}

// Literal Tailwind colour utilities cannot be themed either.
const BANNED_UTILITIES = /\b(?:bg|text|border|ring|divide|placeholder|from|to|via|fill|stroke|outline|decoration|shadow)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/g;
for (const file of walk(srcRoot)) {
  if (extname(file) !== '.jsx') continue;
  const relPath = rel(file);
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(BANNED_UTILITIES)) {
      literals.push(`${relPath}:${i + 1} literal Tailwind colour "${m[0]}" — use a token-backed utility (see @theme in index.css)`);
    }
  });
}

const all = [...literals, ...errors];

if (all.length === 0) {
  console.log('Theme token guard passed: every colour in src resolves through a token.');
} else {
  console.error(`Theme token guard failed (${all.length} issues).`);
  for (const line of all) console.error('  ' + line);
  process.exitCode = 1;
}
