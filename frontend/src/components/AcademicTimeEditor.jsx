const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PERIODS = ['AM', 'PM', 'Full day'];

export default function AcademicTimeEditor({ value = [], onChange, disabled = false }) {
  const entries = Array.isArray(value) ? value : [];
  const update = (index, field, nextValue) => {
    const next = entries.map((entry, itemIndex) => itemIndex === index ? { ...entry, [field]: nextValue } : entry);
    const duplicate = next.some((entry, itemIndex) => itemIndex !== index && entry.day === next[index].day && entry.period === next[index].period);
    if (!duplicate) onChange(next);
  };
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map((entry, index) => (
          <div key={`${entry.day}-${entry.period}-${index}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) 40px', gap: 8 }}>
            <select aria-label={`Academic day ${index + 1}`} value={entry.day} disabled={disabled} onChange={event => update(index, 'day', event.target.value)} className="form-input">
              {DAYS.map(day => <option key={day}>{day}</option>)}
            </select>
            <select aria-label={`Academic period ${index + 1}`} value={entry.period} disabled={disabled} onChange={event => update(index, 'period', event.target.value)} className="form-input">
              {PERIODS.map(period => <option key={period}>{period}</option>)}
            </select>
            <button type="button" aria-label={`Remove academic time ${index + 1}`} disabled={disabled} onClick={() => onChange(entries.filter((_, itemIndex) => itemIndex !== index))} style={{ minWidth: 40, minHeight: 40, border: '1px solid #FECACA', background: '#fff', color: '#B91C1C', borderRadius: 9 }}>×</button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled || entries.length >= DAYS.length * PERIODS.length}
        onClick={() => {
          const candidate = DAYS.flatMap(day => PERIODS.map(period => ({ day, period }))).find(item => !entries.some(entry => entry.day === item.day && entry.period === item.period));
          if (candidate) onChange([...entries, candidate]);
        }}
        style={{ marginTop: 10, border: 0, background: 'transparent', color: '#2C5F8A', fontSize: 13, fontWeight: 700, padding: '6px 0' }}
      >
        + Add academic time
      </button>
      <p style={{ marginTop: 4, color: '#64748B', fontSize: 11 }}>
        Full days are hard avoids when academic-day avoidance is enabled. AM/PM entries are warnings because call is currently modeled by whole day.
      </p>
    </div>
  );
}
