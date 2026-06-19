#!/usr/bin/env node
/* global process */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(scriptDir, '..');
const srcRoot = join(frontendRoot, 'src');
const allowedExtensions = new Set(['.css', '.html', '.js', '.jsx', '.ts', '.tsx']);

const coreFilePatterns = [
  /src[\\/]components[\\/](Layout|Sidebar|ResidentPanels|BlockSelector|PageWrapper)\.jsx$/,
  /src[\\/]pages[\\/](Calendar|Residents|Dashboard|AttendingSchedule|BlockPage|BlockSettings|ProgramSettings)\.jsx$/,
];

const allowedInfiniteContext = [
  /loading/i,
  /spinner/i,
  /spin/i,
  /shimmer/i,
  /skeleton/i,
  /animate-spin/i,
  /lg-spinner/i,
];

const severe = [];
const warnings = [];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const fullPath = join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return walk(fullPath);
    return allowedExtensions.has(extname(name)) ? [fullPath] : [];
  });
}

function rel(file) {
  return relative(frontendRoot, file).replaceAll('\\', '/');
}

function lineNumberForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function contextFor(lines, index, radius = 3) {
  return lines.slice(Math.max(0, index - radius), index + 1).join(' ');
}

function addSevere(file, line, message) {
  severe.push({ file: rel(file), line, message });
}

function addWarning(file, line, message) {
  warnings.push({ file: rel(file), line, message });
}

function isCoreFile(file) {
  const name = rel(file);
  return coreFilePatterns.some((pattern) => pattern.test(name));
}

function isAllowedInfinite(line, context) {
  return allowedInfiniteContext.some((pattern) => pattern.test(line) || pattern.test(context));
}

function countChar(value, char) {
  return [...value].filter((c) => c === char).length;
}

function printIssues(label, issues, stream = console.log) {
  if (!issues.length) return;
  stream(`${label}:`);
  for (const issue of issues) {
    stream(`  ${issue.file}:${issue.line} ${issue.message}`);
  }
}

const files = [...walk(srcRoot), join(frontendRoot, 'index.html')].filter((file) =>
  allowedExtensions.has(extname(file))
);

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const coreFile = isCoreFile(file);

  for (const match of text.matchAll(/\.animated-bg\s*\{[\s\S]*?\}/g)) {
    const block = match[0];
    const line = lineNumberForIndex(text, match.index ?? 0);
    // Full-page animated backgrounds force continuous repaint work under every interaction.
    if (/animation\s*:\s*[^;]*infinite/i.test(block) || /background-size\s*:\s*(?:[3-9]\d{2}|[1-9]\d{3,})%/i.test(block)) {
      addSevere(file, line, '.animated-bg must remain static; no infinite animation or oversized moving background.');
    }
  }

  let inKeyframes = false;
  let keyframeName = '';
  let keyframeDepth = 0;

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const context = contextFor(lines, index);

    const keyframeMatch = line.match(/@keyframes\s+([A-Za-z0-9_-]+)/);
    if (keyframeMatch) {
      inKeyframes = true;
      keyframeName = keyframeMatch[1];
      keyframeDepth = countChar(line, '{') - countChar(line, '}');
    } else if (inKeyframes) {
      keyframeDepth += countChar(line, '{') - countChar(line, '}');
    }

    // Animated shadow/glow effects are paint-heavy and caused calendar hover/cell jank.
    if (inKeyframes && /box-shadow/i.test(line)) {
      addSevere(file, lineNo, `@keyframes ${keyframeName} animates box-shadow; use static emphasis or opacity/transform.`);
    }

    if (inKeyframes && keyframeDepth <= 0) {
      inKeyframes = false;
      keyframeName = '';
    }

    // transition: all makes harmless CSS changes accidentally animate layout, shadow, or filters.
    if (/transition\s*:\s*all\b/i.test(line)) {
      addSevere(file, lineNo, 'Use property-specific transitions instead of transition: all.');
    }

    // Tailwind transition-all is severe in core app surfaces and a warning elsewhere.
    if (/\btransition-all\b/.test(line)) {
      const message = 'Replace transition-all with transition-colors, transition-opacity, or transition-transform.';
      if (coreFile) addSevere(file, lineNo, message);
      else addWarning(file, lineNo, message);
    }

    // Blurred overlays are expensive during modal/sidebar open and close on lower-power devices.
    const hasBackdropBlur =
      /\bbackdrop-blur\b/.test(line) ||
      /backdrop-filter\s*:\s*[^;]*blur/i.test(line) ||
      /backdropFilter\s*:\s*['"`](?!none['"`])[^'"`]*blur/i.test(line);
    if (hasBackdropBlur) {
      addSevere(file, lineNo, 'Avoid backdrop blur in modal/overlay components; use an opacity backdrop.');
    }

    // Framer layout measures and animates geometry; repeated rows/grids make this costly.
    const hasLayoutProp = /<motion\.[^>]*\blayout\b/.test(line) || /^\s*layout(?:=|\s|$)/.test(line);
    if (hasLayoutProp) {
      const message = 'Avoid Framer Motion layout on repeated lists/grids unless performance-tested.';
      if (coreFile) addSevere(file, lineNo, message);
      else addWarning(file, lineNo, message);
    }

    // Infinite animations are allowed for explicit loading indicators only.
    if (/animation\s*:\s*['"`]?[^;'"`}]*infinite/i.test(line) && !isAllowedInfinite(line, context)) {
      addSevere(file, lineNo, 'Infinite animation must be loading-only; avoid continuous decorative motion.');
    }

    // Longer Tailwind durations in core app pages tend to make clicks feel delayed.
    if (coreFile && /\bduration-(500|700|1000)\b/.test(line)) {
      addWarning(file, lineNo, 'Long Tailwind duration in a core app surface; prefer 100-180ms.');
    }

    // One-off boxShadow animation is not always fatal, but it deserves review.
    if (/boxShadow\s*:\s*\[/.test(line) || /whileHover=\{\{[^}]*boxShadow/.test(line)) {
      addWarning(file, lineNo, 'Animated box-shadow found; confirm it is not repeated or frequently triggered.');
    }
  });
}

if (severe.length === 0) {
  console.log('Frontend performance guard passed.');
} else {
  console.error('Frontend performance guard failed.');
}

printIssues('Warnings', warnings, console.warn);
printIssues('Severe issues', severe, console.error);

if (severe.length > 0) {
  process.exitCode = 1;
}
