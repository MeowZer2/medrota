import { useTheme } from '../context/ThemeContext';

/*
 * Theme control.
 *
 * Three explicit choices rather than a two-state switch, because "follow my
 * system" is a real preference and a plain toggle silently throws it away the
 * first time it is touched.
 *
 * `segmented` is the full control for the sidebar; `icon` is a single button for
 * the mobile top bar, where there is no room for three, and it flips between
 * light and dark.
 */

const SIZE = { segmented: 14, icon: 18 };

function SunIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MonitorIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function MoonIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

const OPTIONS = [
  { value: 'light', label: 'Light theme', Icon: SunIcon },
  { value: 'system', label: 'Match system theme', Icon: MonitorIcon },
  { value: 'dark', label: 'Dark theme', Icon: MoonIcon },
];

export default function ThemeToggle({ variant = 'segmented' }) {
  const { preference, resolved, setPreference, toggle } = useTheme();

  if (variant === 'icon') {
    const Icon = resolved === 'dark' ? SunIcon : MoonIcon;
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        className="p-2 rounded-lg transition-colors duration-100"
        style={{ color: 'var(--ink-4)', background: 'transparent', border: 'none', cursor: 'pointer' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <Icon size={SIZE.icon} />
      </button>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      style={{
        display: 'inline-flex',
        padding: 2,
        gap: 2,
        borderRadius: 999,
        background: 'var(--surface-3)',
        border: '1px solid var(--border-1)',
      }}
    >
      {OPTIONS.map((option) => {
        const selected = preference === option.value;
        const OptionIcon = option.Icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            onClick={() => setPreference(option.value)}
            style={{
              width: 26,
              height: 24,
              display: 'grid',
              placeItems: 'center',
              padding: 0,
              border: 0,
              borderRadius: 999,
              cursor: 'pointer',
              background: selected ? 'var(--surface-raised)' : 'transparent',
              color: selected ? 'var(--ink-1)' : 'var(--ink-5)',
              boxShadow: selected ? 'var(--shadow-xs)' : 'none',
              transition: 'background 120ms ease, color 120ms ease',
            }}
          >
            <OptionIcon size={SIZE.segmented} />
          </button>
        );
      })}
    </div>
  );
}
