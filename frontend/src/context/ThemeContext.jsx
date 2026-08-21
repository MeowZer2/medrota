import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/*
 * Theme runtime.
 *
 * The stored preference is one of `light` | `dark` | `system`. Whatever it is,
 * this resolves it down to an explicit `data-theme="light"|"dark"` on <html>,
 * because `styles/theme.css` deliberately has no `prefers-color-scheme` block —
 * one place decides, and the CSS never has to agree with a second copy of the
 * dark palette.
 *
 * The same resolution runs as a blocking inline script in index.html so the
 * first paint is already correct — keep the two in step if either changes.
 */

export const THEME_STORAGE_KEY = 'medrota-theme';

const ThemeContext = createContext(null);

function prefersDark() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function readStoredPreference() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Private mode or blocked storage: fall through to the system preference.
  }
  return 'system';
}

export function resolveTheme(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return prefersDark() ? 'dark' : 'light';
}

function applyTheme(resolved) {
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  // Keeps the browser UI (form controls, scrollbars, the surface behind an
  // over-scroll) in step with the page instead of flashing a white gutter.
  root.style.colorScheme = resolved;

  // On mobile the address bar is part of the page's apparent background, so it
  // has to follow too. Read from the canvas token rather than a second copy of
  // the colour.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const canvas = getComputedStyle(root).getPropertyValue('--bg-canvas').trim();
    if (canvas) meta.setAttribute('content', canvas);
  }
}

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(readStoredPreference);
  const [resolved, setResolved] = useState(() => resolveTheme(readStoredPreference()));

  // Preference -> DOM. Runs on mount too, which reconciles React with whatever
  // the bootstrap script decided before hydration.
  useEffect(() => {
    const next = resolveTheme(preference);
    setResolved(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Not being able to persist is not a reason to fail the toggle.
    }
  }, [preference]);

  // Follow the OS while, and only while, the user is on `system`.
  useEffect(() => {
    if (preference !== 'system') return undefined;
    if (typeof window.matchMedia !== 'function') return undefined;

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next = query.matches ? 'dark' : 'light';
      setResolved(next);
      applyTheme(next);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);

  // Follow the preference across tabs, so a toggle in one window does not leave
  // another window of the same app on the opposite theme.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      setPreferenceState(readStoredPreference());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setPreference = useCallback((next) => {
    setPreferenceState(next === 'light' || next === 'dark' ? next : 'system');
  }, []);

  const toggle = useCallback(() => {
    // A toggle is an explicit choice, so it leaves `system` behind rather than
    // flipping back to it on the next OS change.
    setPreferenceState(resolveTheme(readStoredPreference()) === 'dark' ? 'light' : 'dark');
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, isDark: resolved === 'dark', setPreference, toggle }),
    [preference, resolved, setPreference, toggle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider');
  return context;
}
