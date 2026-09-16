import { useState } from 'react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import AcademicTimeEditor from './AcademicTimeEditor';
import api from '../api/axios';
import { rangeKeys } from '../lib/dateRanges';
const buttonBase = { minHeight: 38, borderRadius: 9, padding: '8px 12px', fontSize: 13, fontWeight: 700 };
const inputStyle = { width: '100%', minHeight: 40, padding: '8px 10px', border: '1px solid var(--border-strong)', borderRadius: 9, color: 'var(--ink-1)' };

function DateListEditor({ label, dates, onChange, blockStart, blockEnd, initialDate }) {
  const [start, setStart] = useState(initialDate ?? '');
  const [end, setEnd] = useState(initialDate ?? '');
  const [error, setError] = useState('');
  const keys = [...new Set(dates.map(value => String(value).slice(0, 10)))].sort();
  const changeRange = remove => {
    const last = end || start;
    if (!start || last < start || (blockStart && start < blockStart) || (blockEnd && last > blockEnd)) {
      setError('Choose a valid range within this block.'); return;
    }
    const selected = new Set(rangeKeys(start, last));
    onChange(remove ? keys.filter(key => !selected.has(key)) : [...new Set([...keys, ...selected])].sort());
    setError('');
  };
  return <div>
    <strong style={{ display: 'block', color: 'var(--ink-2)', fontSize: 12, marginBottom: 6 }}>{label}</strong>
    <div className="availability-range">
      <label>Start<input type="date" aria-label={`Add ${label.toLowerCase()}`} value={start} min={blockStart} max={blockEnd} onChange={event => { setStart(event.target.value); if (!end || end < event.target.value) setEnd(event.target.value); }} style={inputStyle} /></label>
      <label>End<input type="date" aria-label={`${label} end date`} value={end} min={start || blockStart} max={blockEnd} onChange={event => setEnd(event.target.value)} style={inputStyle} /></label>
      <button type="button" onClick={() => changeRange(false)} style={{ ...buttonBase, border: '1px solid var(--border-strong)', background: 'var(--surface-1)', color: 'var(--accent)' }}>Add</button>
      <button type="button" onClick={() => changeRange(true)} disabled={!keys.length} style={{ ...buttonBase, border: '1px solid var(--border-strong)', background: 'var(--surface-1)', color: 'var(--ink-3)' }}>Remove range</button>
    </div>
    {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</p>}
    {keys.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>{keys.map(date => <button key={date} type="button" aria-label={`Remove ${label.toLowerCase()} ${date}`} onClick={() => onChange(keys.filter(item => item !== date))} style={{ border: 0, borderRadius: 999, padding: '5px 8px', background: 'var(--surface-3)', color: 'var(--ink-3)', fontSize: 11 }}>{date} ×</button>)}</div>}
  </div>;
}

export default function BlockResidentAvailabilityModal({ resident, blockId, blockStart, blockEnd, initialDate, onClose, onSaved }) {
  const [vacationDates, setVacationDates] = useState(resident.vacationDates ?? []);
  const [otherUnavailableDates, setOtherUnavailableDates] = useState(resident.otherUnavailableDates ?? []);
  const [academicTimes, setAcademicTimes] = useState(resident.academicTimes ?? []);
  const [callCapOverride, setCallCapOverride] = useState(resident.callCapOverride ?? '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/residents/${resident.id}`, { blockId, vacationDates, otherUnavailableDates, academicTimes, callCapOverride: callCapOverride === '' ? null : Number(callCapOverride), availabilityConfirmed: true });
      toast.success('Block availability confirmed'); await onSaved(); onClose();
    } catch (error) { toast.error(error.response?.data?.error ?? 'Could not save availability'); }
    finally { setSaving(false); }
  };
  return <Modal title={`Availability · ${resident.displayName || resident.name}`} description="This block only" onClose={onClose} maxWidth="max-w-xl" footer={<div style={{ display: 'flex', gap: 8 }}><button type="button" onClick={onClose} style={{ ...buttonBase, flex: 1, background: 'var(--surface-1)', border: '1px solid var(--border-strong)' }}>Cancel</button><button type="button" onClick={save} disabled={saving} data-testid="save-block-availability" style={{ ...buttonBase, flex: 1, background: 'var(--brand)', color: 'var(--ink-inverse)', border: 0 }}>{saving ? 'Saving…' : 'Confirm availability'}</button></div>}>
    <div style={{ display: 'grid', gap: 18 }}>
      <DateListEditor label="Vacation" dates={vacationDates} onChange={setVacationDates} blockStart={blockStart} blockEnd={blockEnd} initialDate={initialDate} />
      <DateListEditor label="Other unavailable" dates={otherUnavailableDates} onChange={setOtherUnavailableDates} blockStart={blockStart} blockEnd={blockEnd} initialDate={initialDate} />
      <div><label style={{ display: 'block', color: 'var(--ink-2)', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Academic time</label><AcademicTimeEditor value={academicTimes} onChange={setAcademicTimes} /></div>
      <div><label htmlFor="local-call-cap" style={{ display: 'block', color: 'var(--ink-2)', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Local call maximum (optional)</label><input id="local-call-cap" type="number" min="1" value={callCapOverride} onChange={event => setCallCapOverride(event.target.value)} style={inputStyle} /></div>
    </div>
  </Modal>;
}

