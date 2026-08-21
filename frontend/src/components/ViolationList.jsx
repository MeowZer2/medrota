// Violation rendering shared by the validation modal and the publish gate.
//
// Every entry answers the six questions a Chief Resident asks: who, what date,
// what rule, why it is a problem, what can be done, and whether it was
// intentional. Detail sits behind progressive disclosure so a long list stays
// readable.

const TONE = {
  error: { bg: 'var(--danger-soft)', border: 'var(--danger-border-2)', heading: 'var(--danger-ink-strong)', body: 'var(--danger-ink-deep)' },
  warning: { bg: 'var(--warn-soft)', border: 'var(--warn-border)', heading: 'var(--warn-ink-strong)', body: 'var(--warn-ink-deep)' },
  override: { bg: 'var(--warn-soft)', border: 'var(--warn-border)', heading: 'var(--warn-ink)', body: 'var(--warn-ink-deep)' },
};

function formatDate(dateKey) {
  if (!dateKey) return null;
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function ViolationCard({ item, onEditDate }) {
  const tone = item.isOverride ? TONE.override : TONE[item.severity] ?? TONE.error;
  const dateLabel = formatDate(item.date);

  return (
    <li
      data-testid={`violation-${item.code}`}
      className="rounded-xl px-4 py-3"
      style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div style={{ minWidth: 0, flex: '1 1 220px' }}>
          {/* Who, when, what rule. */}
          <p style={{ fontSize: 13.5, fontWeight: 750, color: tone.heading }}>
            {item.residentName ?? 'This schedule'}
            {dateLabel ? ` — ${dateLabel}` : ''}
          </p>
          <p style={{ fontSize: 13, fontWeight: 600, color: tone.body, marginTop: 2 }}>{item.rule ?? item.code}</p>

          {/* Why it is a problem. */}
          {item.why && (
            <p style={{ fontSize: 12.5, color: tone.body, marginTop: 4, lineHeight: 1.45 }}>{item.why}</p>
          )}

          {/* The specific fact that triggered it. */}
          {item.details?.previousDate && (
            <p style={{ fontSize: 12.5, color: tone.body, marginTop: 3 }}>
              Also assigned {formatDate(item.details.previousDate)}.
            </p>
          )}
          {typeof item.details?.actual === 'number' && typeof item.details?.limit === 'number' && (
            <p style={{ fontSize: 12.5, color: tone.body, marginTop: 3 }}>
              {item.details.actual} against a limit of {item.details.limit}
              {typeof item.details.daysOnService === 'number' ? ` for ${item.details.daysOnService} days on service` : ''}.
            </p>
          )}
          {typeof item.details?.required === 'number' && typeof item.details?.actual === 'number' && !item.details?.limit && (
            <p style={{ fontSize: 12.5, color: tone.body, marginTop: 3 }}>
              {item.details.actual} of the {item.details.required} required.
            </p>
          )}

          {/* Is it an intentional override? */}
          {item.isOverride ? (
            <div style={{ marginTop: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--warn-ink)' }}>
                Documented manual override
              </span>
              {item.overrideReasons?.length > 0 && (
                <p style={{ fontSize: 12.5, color: tone.body, marginTop: 2 }}>
                  Reason: {item.overrideReasons.join(' · ')}
                </p>
              )}
            </div>
          ) : (
            item.remedy && (
              <p style={{ fontSize: 12.5, color: tone.body, marginTop: 6, fontWeight: 600 }}>
                What you can do: {item.remedy}
              </p>
            )
          )}
        </div>

        {item.date && onEditDate && (
          <button
            type="button"
            onClick={() => onEditDate(item.date)}
            className="px-3 py-1.5 rounded-lg shrink-0"
            style={{ border: `1px solid ${tone.border}`, background: 'var(--surface-1)', color: tone.heading, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
          >
            Open {dateLabel}
          </button>
        )}
      </div>
    </li>
  );
}

export function UnfilledSlotCard({ slot, onEditDate }) {
  const dateLabel = formatDate(slot.date);
  const roleLabel = slot.roleOnDay === 'senior' ? 'Senior' : 'Junior';
  const shown = slot.candidates.slice(0, 4);
  const remaining = slot.candidates.length - shown.length;

  return (
    <li
      data-testid={`unfilled-${slot.date}-${slot.roleOnDay}`}
      className="rounded-xl px-4 py-3"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border-2)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div style={{ minWidth: 0, flex: '1 1 220px' }}>
          <p style={{ fontSize: 13.5, fontWeight: 750, color: 'var(--ink-1)' }}>
            {dateLabel} — {roleLabel} unassigned
          </p>
          {slot.candidates.length === 0 ? (
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>
              No resident is enrolled for this slot in the block.
            </p>
          ) : (
            <>
              <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>
                {slot.candidates.length} resident{slot.candidates.length === 1 ? '' : 's'} unavailable:
              </p>
              <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>
                {shown.map(candidate => (
                  <li key={candidate.residentId} style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                    • {candidate.residentName} — {candidate.reason}
                  </li>
                ))}
              </ul>
              {remaining > 0 && (
                <details style={{ marginTop: 4 }}>
                  <summary style={{ fontSize: 12, color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>
                    Show {remaining} more
                  </summary>
                  <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>
                    {slot.candidates.slice(4).map(candidate => (
                      <li key={candidate.residentId} style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                        • {candidate.residentName} — {candidate.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
        {onEditDate && (
          <button
            type="button"
            onClick={() => onEditDate(slot.date)}
            className="px-3 py-1.5 rounded-lg shrink-0"
            style={{ border: '1px solid var(--border-strong)', background: 'var(--surface-1)', color: 'var(--ink-1)', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
          >
            Open {dateLabel}
          </button>
        )}
      </div>
    </li>
  );
}
