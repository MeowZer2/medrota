// Pre-generation readiness summary.
//
// Missing block availability used to surface only after generation, as a
// warning about a schedule that had already been built without those people.
// Showing it before Generate turns it into a task to finish.

import { Link } from 'react-router-dom';

const SEVERITY_STYLE = {
  error: { bg: 'var(--danger-soft)', border: 'var(--danger-border-2)', text: 'var(--danger-ink)', label: 'Needs attention' },
  warning: { bg: 'var(--warn-soft)', border: 'var(--warn-border)', text: 'var(--warn-ink)', label: 'Worth checking' },
};

function Stat({ label, value, tone }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: tone, lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>{label}</div>
    </div>
  );
}

export default function ReadinessPanel({ readiness, onDismiss }) {
  if (!readiness) return null;

  const { residents, vacation, attending, blockers, readyToGenerate } = readiness;
  const errors = blockers.filter(item => item.severity === 'error');
  const warnings = blockers.filter(item => item.severity === 'warning');
  const allGood = blockers.length === 0;
  const residentTotal = residents.inBlockTotal ?? residents.activeServiceTotal;

  return (
    <section
      data-testid="readiness-panel"
      aria-label="Schedule readiness"
      className="rounded-2xl mb-4"
      style={{
        background: 'var(--surface-1)',
        border: `1px solid ${allGood ? 'var(--success-border)' : errors.length ? 'var(--danger-border-2)' : 'var(--warn-border)'}`,
        boxShadow: 'var(--shadow-xs)',
      }}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-1)', margin: 0 }}>
            Before you generate
          </h2>
          <p style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>
            {readyToGenerate
              ? 'Everything required is in place.'
              : 'Some setup is still missing, so the generator would skip people.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Stat
            label="residents have block availability"
            value={`${residents.withAvailability}/${residentTotal}`}
            tone={residents.withAvailability === residentTotal ? 'var(--success)' : 'var(--danger-ink)'}
          />
          <Stat
            label={`vacation period${vacation.periods === 1 ? '' : 's'} entered`}
            value={vacation.periods}
            tone="var(--brand)"
          />
          <Stat
            label="days have attending coverage"
            value={`${attending.daysCovered}/${attending.totalDays}`}
            tone={attending.complete ? 'var(--success)' : 'var(--warn-ink)'}
          />
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Hide readiness summary"
            className="rounded-lg"
            style={{ color: 'var(--ink-5)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 36, minHeight: 36 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true" focusable="false">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {blockers.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[...errors, ...warnings].map(item => {
            const style = SEVERITY_STYLE[item.severity] ?? SEVERITY_STYLE.warning;
            return (
              <li
                key={item.code}
                data-testid={`readiness-${item.code}`}
                style={{ background: style.bg, border: `1px solid ${style.border}`, borderRadius: 10, padding: '9px 12px' }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: style.text }}>
                    {style.label}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: style.text }}>{item.message}</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>{item.action}</p>
                {item.code === 'MISSING_AVAILABILITY' && residents.missingAvailability.length > 0 && (
                  <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
                    {residents.missingAvailability.map(r => r.residentName).join(', ')}
                    {' · '}
                    <Link to={`/blocks/${readiness.blockNumber}/residents`} style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      Manage block residents
                    </Link>
                  </p>
                )}
                {item.code === 'ATTENDING_COVERAGE_INCOMPLETE' && (
                  <p style={{ fontSize: 12, marginTop: 4 }}>
                    <Link to="/attending" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                      Open the attending schedule
                    </Link>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {allGood && (
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--success)', margin: 0, padding: '0 20px 16px' }}>
          All residents have block availability and attending coverage is complete.
        </p>
      )}
    </section>
  );
}
