import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import Layout from '../components/Layout';
import PageWrapper from '../components/PageWrapper';
import { ResidentListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import api from '../api/axios';
import { useBlock, useUser } from '../context/AppContext';
import BlockSelector from '../components/BlockSelector';
import { PlusIcon, PgyBadge, CallBadge, VacationRangePill, parseVacationRanges, labelStyle, inputStyle } from '../components/ResidentPanels';
import BlockAvailabilityModal from '../components/BlockAvailabilityModal';

// ── constants ─────────────────────────────────────────────────────────────────

const ACADEMIC_DAY_OPTIONS = [
  'None', 'Half day Monday AM', 'Half day Monday PM',
  'Half day Wednesday AM', 'Half day Wednesday PM', 'Full day Friday',
];

const PGY_OPTIONS = [
  { label: 'PGY-1', value: '1' }, { label: 'PGY-2', value: '2' },
  { label: 'PGY-3', value: '3' }, { label: 'PGY-4', value: '4' },
  { label: 'PGY-5', value: '5' }, { label: 'PGY-6', value: '6' },
  { label: 'PGY-7', value: '7' },
  { label: 'Fellow', value: 'Fellow' },
  { label: 'Medical Student', value: 'Medical Student' },
];

const ROLE_OPTIONS = [
  { label: 'Senior Resident', value: 'senior' },
  { label: 'Junior Resident', value: 'junior' },
  { label: 'Medical Student', value: 'med-student' },
];

const EMPTY_FORM = {
  name: '', email: '', pgyLevel: '1', role: 'junior',
  isServiceResident: true,
  academicDayPref: 'None',
  vacationRanges: [{ from: '', to: '' }],
  rotationFrom: '', rotationTo: '',
  callCapOverride: '',
};

// ── helpers ───────────────────────────────────────────────────────────────────

function isoToDateInput(isoOrDate) {
  if (!isoOrDate) return '';
  const d = new Date(isoOrDate);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function vacationDatesToFormRanges(dates = []) {
  const valid = dates.filter(Boolean).map(isoToDateInput).filter(Boolean);
  const ranges = [];
  for (let i = 0; i < valid.length; i += 2) {
    ranges.push({ from: valid[i], to: valid[i + 1] ?? '' });
  }
  if (ranges.length === 0) ranges.push({ from: '', to: '' });
  return ranges;
}

// ── ServiceToggle — the "Available this block" pill toggle ───────────────────

function ServiceToggle({ on, onChange, disabled, residentName }) {
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      aria-label={`Active this block${residentName ? `: ${residentName}` : ''}`}
      title={on ? 'Available this block — click to unenroll' : 'Not enrolled this block — click to enroll'}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '3px 8px 3px 4px', borderRadius: 99,
        border: `1px solid ${on ? '#BBF7D0' : '#E2E8F0'}`,
        background: on ? '#F0FDF4' : '#F8FAFC',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.18s', opacity: disabled ? 0.5 : 1,
      }}
    >
      {/* pill track */}
      <span style={{
        width: 28, height: 16, borderRadius: 8,
        background: on ? '#16A34A' : '#D1D5DB',
        position: 'relative', display: 'block', transition: 'background 0.18s',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: on ? 13 : 2,
          width: 12, height: 12, borderRadius: '50%', background: '#fff',
          transition: 'left 0.18s', display: 'block',
        }} />
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, color: on ? '#15803D' : '#94A3B8', whiteSpace: 'nowrap' }}>
        {on ? 'This block' : 'Not enrolled'}
      </span>
    </button>
  );
}

// ── ResidentCard — single resident row ────────────────────────────────────────

function ResidentCard({ resident, blockId, onToggleEnroll, onEdit, onRemove }) {
  const isMed     = resident.isMedStudent;
  const isService = resident.isServiceResident;

  const roleColor = resident.residentRole === 'senior'
    ? { bg: '#EFF6FF', color: '#1D4ED8' }
    : isMed
      ? { bg: '#FFFBEB', color: '#B45309' }
      : { bg: '#F0FDF4', color: '#15803D' };

  const roleLabel = isMed ? 'Med Student' : resident.residentRole === 'senior' ? 'Senior' : 'Junior';

  const vacation = parseVacationRanges(resident.vacationDates ?? []);

  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '12px 16px', borderRadius: 12,
        background: '#fff', border: '1px solid #E8EFF6',
        boxShadow: '0 1px 2px rgba(26,58,92,0.04)',
      }}
    >
      {/* Avatar */}
      <div style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
        background: `linear-gradient(135deg, ${resident.residentRole === 'senior' ? '#1A3A5C, #2C5F8A' : isMed ? '#D97706, #B45309' : '#16A34A, #15803D'})`,
        color: '#fff', fontSize: 11, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {resident.name.split(' ').filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase()}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1A3A5C' }}>{resident.name}</span>
          {resident.email && (
            <a href={`mailto:${resident.email}`} onClick={e => e.stopPropagation()} title={resident.email}
              style={{ color: '#94A3B8', display: 'inline-flex', alignItems: 'center', lineHeight: 1 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,12 2,6" />
              </svg>
            </a>
          )}
          <PgyBadge level={resident.pgyLevel} />
          <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 99, background: roleColor.bg, color: roleColor.color }}>
            {roleLabel}
          </span>
          {isService ? (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 99, background: '#EEF4FF', color: '#2C5F8A' }}>
              Service
            </span>
          ) : (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 99, background: '#F3F0FF', color: '#7C3AED' }}>
              Off-service
            </span>
          )}
          {resident.callCount > 0 && <CallBadge count={resident.callCount} max={resident.callCapOverride ?? (isMed ? 5 : 9)} />}
        </div>
        {vacation.length > 0 && vacation.some(v => v.from) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
            {vacation.filter(v => v.from).map((v, i) => (
              <VacationRangePill key={i} from={v.from} to={v.to} />
            ))}
          </div>
        )}
      </div>

      {/* Enrollment toggle (only for service residents when blockId is set) */}
      {blockId && isService && (
        <ServiceToggle
          on={resident.isEnrolledThisBlock}
          residentName={resident.name}
          onChange={() => onToggleEnroll(resident)}
        />
      )}

      {/* Edit / Delete */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button
          onClick={() => onEdit(resident)}
          style={{ padding: '5px 6px', borderRadius: 7, border: 'none', background: 'none', cursor: 'pointer', color: '#94A3B8' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#F0F5FF'; e.currentTarget.style.color = '#2C5F8A'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#94A3B8'; }}
          title="Edit"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        <button
          onClick={() => onRemove(resident.id)}
          style={{ padding: '5px 6px', borderRadius: 7, border: 'none', background: 'none', cursor: 'pointer', color: '#94A3B8' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#FEF2F2'; e.currentTarget.style.color = '#DC2626'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#94A3B8'; }}
          title="Remove"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── ResidentSection — a labelled section of resident cards ───────────────────

function ResidentSection({ title, accent, residents, blockId, onToggleEnroll, onEdit, onRemove, emptyLabel }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E8EFF6', borderRadius: 16, boxShadow: '0 1px 3px rgba(26,58,92,0.05)', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: residents.length > 0 ? '1px solid #F1F5F9' : 'none' }}>
        <div style={{ width: 4, height: 20, borderRadius: 2, background: accent }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: '#1A3A5C' }}>{title}</span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 99, background: '#F0F5FF', color: '#4A6FA5' }}>
          {residents.length}
        </span>
      </div>
      {residents.length === 0 ? (
        <p style={{ fontSize: 13, color: '#CBD5E1', fontStyle: 'italic', padding: '14px 18px', textAlign: 'center' }}>{emptyLabel}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 14px 14px' }}>
          {residents.map(r => (
            <ResidentCard
              key={r.id}
              resident={r}
              blockId={blockId}
              onToggleEnroll={onToggleEnroll}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── ResidentForm — shared modal body ─────────────────────────────────────────

function ResidentForm({ form, setForm, isSaving, error, onSubmit, onClose, submitLabel, showServiceToggle }) {
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isMedStudent = form.role === 'med-student';

  const addRange    = () => set('vacationRanges', [...form.vacationRanges, { from: '', to: '' }]);
  const updateRange = (i, field, val) =>
    set('vacationRanges', form.vacationRanges.map((r, j) => j === i ? { ...r, [field]: val } : r));
  const removeRange = (i) =>
    set('vacationRanges', form.vacationRanges.filter((_, j) => j !== i));

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.34)' }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.14, ease: 'easeOut' }}
        className="w-full max-w-md rounded-2xl overflow-hidden max-h-[90vh] flex flex-col"
        style={{ background: '#fff', boxShadow: '0 14px 36px rgba(26,58,92,0.16)', border: '1px solid #E8EFF6' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 shrink-0" style={{ borderBottom: '1px solid #E8EFF6' }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1A3A5C' }}>
            {submitLabel === 'Save changes' ? 'Edit Resident' : 'Add Resident'}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = '#F0F5FF'}
            onMouseLeave={e => e.currentTarget.style.background = ''}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={onSubmit} className="px-6 py-5 space-y-4 overflow-y-auto">
          {error && <p className="text-sm px-3 py-2 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>{error}</p>}

          {/* Service / Off-service toggle — hidden for med students (always off-service) */}
          {showServiceToggle && !isMedStudent && (
            <div>
              <label style={labelStyle}>Resident type</label>
              <div style={{ display: 'flex', borderRadius: 9, overflow: 'hidden', border: '1px solid #E2E8F0' }}>
                {[
                  { label: 'Service resident', value: true, desc: 'Permanent member of this program' },
                  { label: 'Off-service (this block)', value: false, desc: 'Rotating in for one block only' },
                ].map(opt => (
                  <button key={String(opt.value)} type="button"
                    onClick={() => set('isServiceResident', opt.value)}
                    style={{
                      flex: 1, padding: '8px 10px', border: 'none', cursor: 'pointer',
                      background: form.isServiceResident === opt.value ? '#1A3A5C' : '#F8FAFC',
                      color: form.isServiceResident === opt.value ? '#fff' : '#64748B',
                      fontSize: 12, fontWeight: 600,
                    }}>
                    {opt.label}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                {form.isServiceResident
                  ? 'Will appear in all blocks. Toggle per-block availability from the residents list.'
                  : 'Will only appear in the current block.'}
              </p>
            </div>
          )}

          {/* Role */}
          <div>
            <label style={labelStyle}>Role</label>
            <select value={form.role} onChange={e => set('role', e.target.value)} style={inputStyle}>
              {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Name */}
          <div>
            <label style={labelStyle}>Full name</label>
            <input required value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="Dr. Firstname Lastname" style={inputStyle} />
          </div>

          {/* Email (optional) */}
          <div>
            <label style={labelStyle}>Email <span style={{ color: '#CBD5E1', fontWeight: 400 }}>(optional)</span></label>
            <input type="email" value={form.email ?? ''} onChange={e => set('email', e.target.value)}
              placeholder="dr.smith@hospital.org" style={inputStyle} />
          </div>

          {/* PGY level */}
          <div>
            <label style={labelStyle}>PGY level</label>
            <select value={form.pgyLevel}
              onChange={e => {
                const val = e.target.value;
                if (val === 'Medical Student') setForm(f => ({ ...f, pgyLevel: val, role: 'med-student', isServiceResident: false }));
                else setForm(f => ({ ...f, pgyLevel: val, ...(f.role === 'med-student' ? { role: 'junior', isServiceResident: true } : {}) }));
              }} style={inputStyle}>
              {PGY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Med student rotation dates */}
          {isMedStudent && (
            <div>
              <label style={labelStyle}>Rotation dates (2-week)</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>From</p>
                  <input type="date" value={form.rotationFrom} onChange={e => set('rotationFrom', e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <p style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>To</p>
                  <input type="date" value={form.rotationTo} onChange={e => set('rotationTo', e.target.value)} style={inputStyle} />
                </div>
              </div>
            </div>
          )}

          {/* Academic day pref */}
          {!isMedStudent && (
            <div>
              <label style={labelStyle}>Academic day preference</label>
              <select value={form.academicDayPref} onChange={e => set('academicDayPref', e.target.value)} style={inputStyle}>
                {ACADEMIC_DAY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          )}

          {/* Vacation ranges */}
          <div>
            <label style={labelStyle}>Vacation dates</label>
            <div className="space-y-2">
              {form.vacationRanges.filter(r => r.from && r.to).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.vacationRanges.filter(r => r.from && r.to).map((r, i) => {
                    const fmt = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                    return (
                      <span key={i} className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg"
                        style={{ background: '#FFF7ED', color: '#C2410C', border: '1px solid #FED7AA' }}>
                        {fmt(r.from)} – {fmt(r.to)}
                        <button type="button" onClick={() => removeRange(form.vacationRanges.indexOf(r))}
                          className="ml-0.5 hover:text-red-600">×</button>
                      </span>
                    );
                  })}
                </div>
              )}
              {form.vacationRanges.map((range, i) => (
                <div key={i} className="grid grid-cols-2 gap-2">
                  <div>
                    {i === 0 && <p style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>From</p>}
                    <input type="date" value={range.from} onChange={e => updateRange(i, 'from', e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    {i === 0 && <p style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>To</p>}
                    <input type="date" value={range.to} onChange={e => updateRange(i, 'to', e.target.value)} style={inputStyle} />
                  </div>
                </div>
              ))}
              <button type="button" onClick={addRange} className="text-xs font-medium" style={{ color: '#2C5F8A' }}>
                + Add range
              </button>
            </div>
          </div>

          {/* Call cap override */}
          <div>
            <label style={labelStyle}>
              Call cap override{' '}
              <span style={{ color: '#CBD5E1' }}>(optional, default: {isMedStudent ? 5 : 9})</span>
            </label>
            <input type="number" min="1" max="15" value={form.callCapOverride}
              onChange={e => set('callCapOverride', e.target.value)}
              placeholder={isMedStudent ? '5' : '9'} style={inputStyle} />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-medium"
              style={{ border: '1px solid #E8EFF6', color: '#64748B', background: '#F8FAFC', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = '#F0F5FF'}
              onMouseLeave={e => e.currentTarget.style.background = '#F8FAFC'}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white"
              style={{ background: '#1A3A5C', cursor: 'pointer', border: 'none' }}
              onMouseEnter={e => { if (!isSaving) e.currentTarget.style.background = '#2C5F8A'; }}
              onMouseLeave={e => e.currentTarget.style.background = '#1A3A5C'}>
              {isSaving ? 'Saving…' : submitLabel}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ── AddModal ──────────────────────────────────────────────────────────────────

function AddModal({ programId, blockId, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!programId) { setError('Program ID not configured.'); return; }
    setSaving(true); setError('');
    try {
      const isMed = form.role === 'med-student';
      const vacationDates = form.vacationRanges.filter(r => r.from)
        .flatMap(r => r.to ? [r.from, r.to] : [r.from]);
      const allVacation = isMed && form.rotationFrom
        ? [form.rotationFrom, form.rotationTo, ...vacationDates]
        : vacationDates;

      const isMedStudent = isMed;
      const isServiceResident = isMedStudent ? false : form.isServiceResident;

      const payload = {
        programId,
        blockId: blockId || undefined,
        name: form.name,
        email: form.email || undefined,
        pgyLevel: form.pgyLevel,
        residentRole: isMedStudent ? 'junior' : form.role,
        isMedStudent,
        isServiceResident,
        academicDayPref: form.academicDayPref === 'None' ? null : form.academicDayPref,
        vacationDates: allVacation,
        callCapOverride: form.callCapOverride ? parseInt(form.callCapOverride, 10) : null,
      };

      const { data } = await api.post('/residents', payload);
      onSaved({
        ...data,
        vacationDates: allVacation,
        academicDayPref: payload.academicDayPref,
        callCapOverride: payload.callCapOverride,
        callCount: 0,
        isEnrolledThisBlock: !isServiceResident, // off-service + med students always enrolled
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResidentForm
      form={form} setForm={setForm}
      isSaving={saving} error={error}
      onSubmit={handleSubmit} onClose={onClose}
      submitLabel="Add resident"
      showServiceToggle
    />
  );
}

// ── EditModal ─────────────────────────────────────────────────────────────────

function EditModal({ resident, blockId, onClose, onSaved }) {
  const isMed   = resident.isMedStudent;
  const roleVal = isMed ? 'med-student' : resident.residentRole;

  const [form, setForm] = useState({
    name: resident.name ?? '',
    email: resident.email ?? '',
    pgyLevel: String(resident.pgyLevel),
    role: roleVal,
    isServiceResident: resident.isServiceResident ?? true,
    academicDayPref: resident.academicDayPref ?? 'None',
    vacationRanges: vacationDatesToFormRanges(resident.vacationDates),
    rotationFrom: '', rotationTo: '',
    callCapOverride: resident.callCapOverride != null ? String(resident.callCapOverride) : '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const isMedStudent = form.role === 'med-student';
      const vacationDates = form.vacationRanges.filter(r => r.from)
        .flatMap(r => r.to ? [r.from, r.to] : [r.from]);
      const allVacation = isMedStudent && form.rotationFrom
        ? [form.rotationFrom, form.rotationTo, ...vacationDates]
        : vacationDates;

      const payload = {
        name: form.name,
        email: form.email || undefined,
        pgyLevel: form.pgyLevel,
        residentRole: isMedStudent ? 'junior' : form.role,
        isMedStudent,
        isServiceResident: isMedStudent ? false : form.isServiceResident,
        academicDayPref: form.academicDayPref === 'None' ? null : form.academicDayPref,
        vacationDates: allVacation,
        callCapOverride: form.callCapOverride ? parseInt(form.callCapOverride, 10) : null,
        blockId: blockId || undefined,
      };

      await api.put(`/residents/${resident.id}`, payload);
      onSaved({ ...resident, ...payload, vacationDates: allVacation });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResidentForm
      form={form} setForm={setForm}
      isSaving={saving} error={error}
      onSubmit={handleSubmit} onClose={onClose}
      submitLabel="Save changes"
      showServiceToggle={false}
    />
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function Residents() {
  const { currentProgram } = useUser();
  const { currentBlock, setCurrentBlock, currentAcademicYear } = useBlock();
  const programId     = currentProgram?.programId ?? null;
  const blockId       = currentBlock?.id ?? null;
  const allYearBlocks = currentAcademicYear?.blocks ?? [];

  const [residents, setResidents]         = useState([]);
  const [loading, setLoading]             = useState(false);
  const [modalOpen, setModalOpen]         = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [editingResident, setEditingResident] = useState(null);
  const latestBlockIdRef = useRef(blockId);

  useEffect(() => {
    latestBlockIdRef.current = blockId;
  }, [blockId]);

  const fetchResidents = useCallback(async ({ signal } = {}) => {
    if (!programId) return;
    const currentBlockId = blockId;
    setLoading(true);
    try {
      const url = currentBlockId
        ? `/residents?programId=${programId}&blockId=${currentBlockId}`
        : `/residents?programId=${programId}`;
      const { data } = await api.get(url, { signal });
      if (latestBlockIdRef.current !== currentBlockId) return;
      setResidents(data);
    } catch (err) {
      if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {
        // Keep the existing silent failure behavior.
      }
    } finally {
      if (!signal?.aborted && latestBlockIdRef.current === currentBlockId) setLoading(false);
    }
  }, [programId, blockId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchResidents({ signal: controller.signal });
    return () => controller.abort();
  }, [fetchResidents]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSaved = (resident) => {
    setResidents(prev => [...prev, resident]);
    setModalOpen(false);
    toast.success(`${resident.name} added`);
  };

  const handleEdited = (updated) => {
    setResidents(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
    setEditingResident(null);
    toast.success(`${updated.name} updated`);
  };

  const handleRemove = async (id) => {
    const removed = residents.find(r => r.id === id);
    setResidents(prev => prev.filter(r => r.id !== id));
    try {
      await api.delete(`/residents/${id}`);
      toast.success(`${removed?.name ?? 'Resident'} removed`);
    } catch { fetchResidents(); }
  };

  const handleToggleEnroll = async (resident) => {
    if (!blockId) return;
    const wasEnrolled = resident.isEnrolledThisBlock;
    // Optimistic
    setResidents(prev => prev.map(r =>
      r.id === resident.id ? { ...r, isEnrolledThisBlock: !wasEnrolled } : r
    ));
    try {
      if (wasEnrolled) {
        await api.delete(`/residents/${resident.id}/enroll/${blockId}`);
      } else {
        await api.post(`/residents/${resident.id}/enroll`, { blockId });
      }
    } catch {
      setResidents(prev => prev.map(r =>
        r.id === resident.id ? { ...r, isEnrolledThisBlock: wasEnrolled } : r
      ));
      toast.error('Failed to update enrollment');
    }
  };

  // ── Data split ─────────────────────────────────────────────────────────────
  // Med students are always off-service; they get their own section at the bottom
  const medStudents       = residents.filter(r => r.isMedStudent);
  const serviceResidents  = residents.filter(r => r.isServiceResident && !r.isMedStudent);
  const offServiceResidents = residents.filter(r => !r.isServiceResident && !r.isMedStudent);

  const serviceSeniors = serviceResidents.filter(r => r.residentRole === 'senior');
  const serviceJuniors = serviceResidents.filter(r => r.residentRole === 'junior');

  const enrolledCount = blockId ? serviceResidents.filter(r => r.isEnrolledThisBlock).length : serviceResidents.length;

  return (
    <PageWrapper>
      <Layout>
        {/* Header */}
        <motion.div className="flex flex-wrap items-start gap-3 mb-8"
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.14, ease: 'easeOut' }}>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            <h1 className="text-[28px] font-semibold leading-tight" style={{ color: '#1A3A5C' }}>Residents</h1>
            <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
              {blockId
                ? `${enrolledCount} of ${serviceResidents.length} service residents active this block`
                : 'Manage residents for this program'}
            </p>
            <motion.div className="mt-4 h-px" initial={{ width: 0 }} animate={{ width: 192 }}
              transition={{ duration: 0.16, delay: 0.04, ease: 'easeOut' }}
              style={{ background: 'linear-gradient(90deg, #2C5F8A 0%, transparent 100%)' }} />

            {/* Block selector */}
            {allYearBlocks.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <BlockSelector
                  blocks={allYearBlocks}
                  activeBlockId={blockId}
                  onSelect={setCurrentBlock}
                />
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2" style={{ flexShrink: 0, alignSelf: 'flex-start' }}>
            {blockId && (
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
                onClick={() => setAvailabilityOpen(true)}
                data-testid="set-block-availability"
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold"
                style={{ background: '#fff', color: '#2C5F8A', border: '1px solid #BFD4EA', cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F0F5FF'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}>
                Set block availability
              </motion.button>
            )}
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white"
              style={{ background: '#1A3A5C', border: 'none', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = '#2C5F8A'}
              onMouseLeave={e => e.currentTarget.style.background = '#1A3A5C'}>
              <PlusIcon /> Add Resident
            </motion.button>
          </div>
        </motion.div>

        {!programId && (
          <div className="mb-6 p-4 rounded-xl" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
            <p className="text-sm font-semibold" style={{ color: '#92400E' }}>No program found</p>
            <p className="text-xs mt-0.5" style={{ color: '#B45309' }}>Your account is not linked to a program yet.</p>
          </div>
        )}

        {loading ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <ResidentListSkeleton /><ResidentListSkeleton />
          </motion.div>
        ) : residents.length === 0 && programId ? (
          <EmptyState
            icon={<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2C5F8A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>}
            title="No residents yet"
            subtitle="Add your first resident to start building the call schedule."
            action="+ Add Resident"
            onAction={() => setModalOpen(true)}
          />
        ) : (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.14, delay: 0.02, ease: 'easeOut' }}>
            {/* Service resident sections */}
            <ResidentSection title="Senior Residents" accent="#2C5F8A"
              residents={serviceSeniors} blockId={blockId}
              onToggleEnroll={handleToggleEnroll} onEdit={setEditingResident} onRemove={handleRemove}
              emptyLabel="No senior residents" indexOffset={0} />
            <ResidentSection title="Junior Residents" accent="#16A34A"
              residents={serviceJuniors} blockId={blockId}
              onToggleEnroll={handleToggleEnroll} onEdit={setEditingResident} onRemove={handleRemove}
              emptyLabel="No junior residents" indexOffset={serviceSeniors.length} />

            {/* Off-service section — only shown when blockId is set and there are non-med off-service residents */}
            {blockId && offServiceResidents.length > 0 && (
              <ResidentSection title={`Off-service Residents — Block ${currentBlock?.number}`} accent="#7C3AED"
                residents={offServiceResidents} blockId={null}
                onToggleEnroll={handleToggleEnroll} onEdit={setEditingResident} onRemove={handleRemove}
                emptyLabel="No off-service residents this block"
                indexOffset={serviceResidents.length} />
            )}

            {/* Medical Students — always off-service, always block-specific, shown at the bottom */}
            {(blockId && medStudents.length > 0) && (
              <ResidentSection title={`Medical Students — Block ${currentBlock?.number}`} accent="#D97706"
                residents={medStudents} blockId={null}
                onToggleEnroll={handleToggleEnroll} onEdit={setEditingResident} onRemove={handleRemove}
                emptyLabel="No medical students this block"
                indexOffset={serviceResidents.length + offServiceResidents.length} />
            )}
          </motion.div>
        )}

        <AnimatePresence>
          {modalOpen && (
            <AddModal programId={programId} blockId={blockId}
              onClose={() => setModalOpen(false)} onSaved={handleSaved} />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {editingResident && (
            <EditModal resident={editingResident} blockId={blockId}
              onClose={() => setEditingResident(null)} onSaved={handleEdited} />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {availabilityOpen && blockId && (
            <BlockAvailabilityModal
              blockId={blockId}
              blockNumber={currentBlock?.number}
              residents={residents}
              allYearBlocks={allYearBlocks}
              onClose={() => setAvailabilityOpen(false)}
              onApplied={fetchResidents}
            />
          )}
        </AnimatePresence>
      </Layout>
    </PageWrapper>
  );
}
