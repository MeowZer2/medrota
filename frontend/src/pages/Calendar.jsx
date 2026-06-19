import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import Layout from '../components/Layout';
import PageWrapper from '../components/PageWrapper';
import { Skeleton } from '../components/Skeleton';
import api from '../api/axios';
import { useBlock, useUser } from '../context/AppContext';
import {
  getDaysFromDates, getDaysInBlock, isWeekend,
  toISODate, fmtShort, fmtDay, fmtFull, DAYS_OF_WEEK,
} from '../lib/blockUtils';

// ── helpers ───────────────────────────────────────────────────────────────────

function buildAssignmentsMap(list) {
  const map = {};
  for (const a of list) {
    const iso = toISODate(new Date(a.callDay.date));
    if (!map[iso]) map[iso] = { callDayId: a.callDay.id };
    if (a.roleOnDay === 'senior') {
      map[iso].seniorId = a.residentId;
      map[iso].senior   = a.resident.name;
      map[iso].seniorAssignmentId = a.id;
    } else if (a.roleOnDay === 'junior') {
      map[iso].juniorId = a.residentId;
      map[iso].junior   = a.resident.name;
      map[iso].juniorAssignmentId = a.id;
    }
  }
  return map;
}

function apiDateKey(value) { return String(value).slice(0, 10); }

// ── Chip ──────────────────────────────────────────────────────────────────────

function Chip({ label, color, bg }) {
  return (
    <span className="inline-block truncate max-w-full rounded px-1.5 py-0.5 leading-tight"
      style={{ fontSize: 10, fontWeight: 600, background: bg, color, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

// ── FLAG presets ──────────────────────────────────────────────────────────────

const FLAG_PRESETS = [
  { color: '#EF4444', label: 'Holiday' },
  { color: '#F59E0B', label: 'Academic day' },
  { color: '#10B981', label: 'Special event' },
  { color: '#3B82F6', label: 'Off-site' },
  { color: '#8B5CF6', label: 'Teaching day' },
  { color: '#14B8A6', label: 'Other' },
];

// ── DayCell (grid) ────────────────────────────────────────────────────────────

const DayCell = memo(function DayCell({ day, attendings, assignment, flag, onClick, isHoliday, animDelay = 0 }) {
  const weekend = isWeekend(day);

  // Split attendings: non-call go in top section, call-day go in bottom
  const nonCallAtts = (attendings ?? []).filter(a => !a.isCallDay);
  const callAtts    = (attendings ?? []).filter(a => a.isCallDay);

  const hasTopSection    = nonCallAtts.length > 0;
  const hasBottomSection = callAtts.length > 0 || assignment?.seniorId || assignment?.juniorId;
  const showDivider      = hasTopSection && hasBottomSection;

  const dayNum    = day.getDate();
  const monthAbbr = day.toLocaleDateString('en-GB', { month: 'short' });

  // Cell background: flag tint (12%) > holiday > weekend > plain white
  let bg     = '#fff';
  let border = '1px solid #E2E8F0';
  if (flag) {
    bg     = flag.color + '1F'; // 12% opacity
    border = `1px solid ${flag.color}55`;
  } else if (isHoliday) {
    bg     = '#FFF5F5';
    border = '1px solid #FCA5A5';
  } else if (weekend) {
    bg = '#F8FAFC';
  }

  const chipBase = { display: 'block', padding: '2px 6px', borderRadius: 4, fontSize: 11, lineHeight: '16px' };

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, delay: animDelay }}
      whileHover={{ y: -2, boxShadow: '0 6px 18px rgba(26,58,92,0.10)' }}
      whileTap={{ scale: 0.96 }}
      onClick={() => onClick(day)}
      className={`flex flex-col text-left w-full${isHoliday ? ' holiday-glow' : ''}`}
      style={{ background: bg, border, borderRadius: 8, padding: 8, minHeight: 90, cursor: 'pointer', position: 'relative' }}
    >
      {/* Date header row */}
      <div className="flex items-baseline gap-1 mb-1 flex-wrap">
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1E293B', lineHeight: 1 }}>{dayNum}</span>
        <span style={{ fontSize: 10, color: '#94A3B8', lineHeight: 1 }}>{monthAbbr}</span>
        {flag && (
          <span style={{ fontSize: 9, fontWeight: 600, color: flag.color, lineHeight: 1 }}>· {flag.label}</span>
        )}
        {isHoliday && !flag && (
          <span style={{ fontSize: 9, fontWeight: 700, color: '#DC2626', textTransform: 'uppercase', lineHeight: 1, marginLeft: 'auto' }}>Holiday</span>
        )}
      </div>

      {/* TOP SECTION — non-call attendings as subtle gray chips */}
      {nonCallAtts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {nonCallAtts.map((a, i) => {
            const text = a.activityLabel ? `${a.attendingName} · ${a.activityLabel}` : a.attendingName;
            return <span key={i} style={{ ...chipBase, background: '#F1F5F9', color: '#334155' }}>{text}</span>;
          })}
        </div>
      )}

      {/* Divider — only when both sections have content */}
      {showDivider && (
        <div style={{ borderTop: '1px solid #E2E8F0', margin: '4px 0' }} />
      )}

      {/* BOTTOM SECTION — call-day attendings (red chip) + resident chips */}
      {hasBottomSection && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {callAtts.map((a, i) => (
            <span key={`c${i}`} style={{ ...chipBase, background: '#FEF2F2', color: '#991B1B' }}>{a.attendingName}</span>
          ))}
          {assignment?.senior && (
            <span style={{ ...chipBase, background: '#F0FDF4', color: '#166534' }}>S: {assignment.senior}</span>
          )}
          {assignment?.junior && (
            <span style={{ ...chipBase, background: '#FFFBEB', color: '#92400E' }}>J: {assignment.junior}</span>
          )}
        </div>
      )}

      {/* Unassigned placeholder */}
      {!hasTopSection && !hasBottomSection && (
        <span style={{ fontSize: 10, color: '#CBD5E1', fontStyle: 'italic' }}>Unassigned</span>
      )}
    </motion.button>
  );
}, (prevProps, nextProps) => (
  prevProps.day === nextProps.day &&
  prevProps.attendings === nextProps.attendings &&
  prevProps.assignment === nextProps.assignment &&
  prevProps.flag === nextProps.flag &&
  prevProps.onClick === nextProps.onClick &&
  prevProps.isHoliday === nextProps.isHoliday &&
  prevProps.animDelay === nextProps.animDelay
));

// ── DayRow (mobile) ───────────────────────────────────────────────────────────

function DayRow({ day, attendings, assignment, flag, onClick, isHoliday }) {
  const weekend = isWeekend(day);
  const nonCallAtts = (attendings ?? []).filter(a => !a.isCallDay);
  const callAtts    = (attendings ?? []).filter(a => a.isCallDay);
  const hasContent  = attendings?.length > 0 || assignment?.seniorId || assignment?.juniorId;

  const rowBg = flag
    ? flag.color + '1A'
    : isHoliday ? '#FFF5F5' : weekend ? '#FAFBFC' : '#fff';
  const accentColor = flag
    ? flag.color
    : isHoliday ? '#FCA5A5' : weekend ? '#E2E8F0' : 'transparent';

  return (
    <button onClick={onClick} className="w-full flex items-start gap-3 px-4 py-3 text-left transition-all duration-200"
      style={{ background: rowBg, borderLeft: `3px solid ${accentColor}`, borderBottom: '1px solid #F1F5F9' }}
      onMouseEnter={e => { e.currentTarget.style.background = '#F0F5FF'; }}
      onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}
    >
      <div className="shrink-0 w-12">
        <p style={{ fontSize: 18, fontWeight: 700, color: isHoliday ? '#DC2626' : '#1A3A5C', lineHeight: 1, margin: 0 }}>
          {String(day.getDate()).padStart(2, '0')}
        </p>
        <p style={{ fontSize: 11, color: weekend ? '#D97706' : '#94A3B8', fontWeight: weekend ? 600 : 400 }}>
          {fmtDay(day)}
        </p>
        {flag && (
          <p style={{ fontSize: 9, fontWeight: 600, color: flag.color, marginTop: 2 }}>{flag.label}</p>
        )}
      </div>
      <div className="flex flex-col gap-0.5 flex-1 pt-0.5">
        {isHoliday && <span style={{ fontSize: 11, fontWeight: 600, color: '#DC2626' }}>Holiday</span>}
        {/* Non-call attendings — plain text */}
        {nonCallAtts.map((a, i) => {
          const text = [a.attendingName, a.activityLabel].filter(Boolean).join(' · ');
          return text ? <span key={i} style={{ fontSize: 11, color: '#475569' }}>{text}</span> : null;
        })}
        {/* Call attendings — navy bold */}
        {callAtts.map((a, i) => (
          <span key={`c${i}`} style={{ fontSize: 11, fontWeight: 600, color: '#1A3A5C' }}>{a.attendingName}</span>
        ))}
        {/* Resident chips */}
        <div className="flex flex-wrap gap-1 mt-0.5">
          {assignment?.senior && <Chip label={`S: ${assignment.senior}`} color="#15803D" bg="#F0FDF4" />}
          {assignment?.junior && <Chip label={`J: ${assignment.junior}`} color="#B45309" bg="#FFFBEB" />}
        </div>
        {!hasContent && <span style={{ fontSize: 11, color: '#CBD5E1', fontStyle: 'italic' }}>Unassigned</span>}
      </div>
    </button>
  );
}

// ── AttendingSection (inside modal) ──────────────────────────────────────────

const BLANK_FORM = { attendingName: '', activityLabel: '', isCallDay: false };

const miniInput = {
  width: '100%', padding: '6px 10px', borderRadius: 7,
  border: '1px solid #E2E8F0', fontSize: 12, color: '#1A3A5C',
  background: '#fff', outline: 'none', boxSizing: 'border-box',
};

const modalSelectClass = 'w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500';

function AttendingSection({ day, blockId, roster, initialEntries, onChange }) {
  const [entries, setEntries] = useState(initialEntries ?? []);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId]   = useState(null);
  const [form, setForm]       = useState(BLANK_FORM);
  const [saving, setSaving]   = useState(false);

  const iso = toISODate(day);

  function openAdd() { setForm(BLANK_FORM); setEditId(null); setShowForm(true); }
  function openEdit(e) { setForm({ attendingName: e.attendingName, activityLabel: e.activityLabel, isCallDay: e.isCallDay }); setEditId(e.id); setShowForm(true); }
  function cancelForm() { setShowForm(false); setEditId(null); setForm(BLANK_FORM); }

  function push(updated) { setEntries(updated); onChange(iso, updated); }

  async function handleSave() {
    if (!form.attendingName) {
      toast.error('Attending name is required');
      return;
    }
    setSaving(true);
    try {
      if (editId) {
        const { data } = await api.put(`/attending/${editId}`, { ...form, date: iso });
        push(entries.map(e => e.id === editId ? data : e));
      } else {
        const { data } = await api.post('/attending', { blockId, date: iso, ...form });
        push([...entries, data]);
      }
      cancelForm();
    } catch {
      toast.error('Failed to save attending entry');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    try {
      await api.delete(`/attending/${id}`);
      push(entries.filter(e => e.id !== id));
    } catch {
      toast.error('Failed to delete attending entry');
    }
  }

  return (
    <div style={{ borderBottom: '1px solid #E8EFF6', padding: '14px 20px 14px' }}>
      <div className="flex items-center justify-between mb-2">
        <p style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Attending
        </p>
        {!showForm && (
          <button onClick={openAdd} style={{ fontSize: 11, fontWeight: 600, color: '#2C5F8A', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            + Add
          </button>
        )}
      </div>

      {entries.length === 0 && !showForm && (
        <p style={{ fontSize: 12, color: '#CBD5E1', fontStyle: 'italic' }}>No attending assigned</p>
      )}
      <div className="space-y-1">
        {entries.map(e => (
          <div key={e.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: '#F8FAFC', border: '1px solid #E8EFF6' }}>
            <div className="flex flex-wrap gap-1 flex-1">
              {e.attendingName && <Chip label={`👤 ${e.attendingName}`} color="#1D4ED8" bg="#EFF6FF" />}
              {e.activityLabel && <Chip label={e.activityLabel} color="#6D28D9" bg="#F3F0FF" />}
              {e.isCallDay && <Chip label="Call" color="#1A3A5C" bg="#EEF4FF" />}
            </div>
            <button onClick={() => openEdit(e)} title="Edit"
              style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: '2px 4px', borderRadius: 4, lineHeight: 1 }}
              onMouseEnter={e => e.currentTarget.style.background = '#F0F5FF'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>✏️</button>
            <button onClick={() => handleDelete(e.id)} title="Delete"
              style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', padding: '2px 4px', borderRadius: 4, lineHeight: 1 }}
              onMouseEnter={ev => ev.currentTarget.style.background = '#FEF2F2'}
              onMouseLeave={ev => ev.currentTarget.style.background = 'none'}>✕</button>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="mt-2 space-y-2 p-3 rounded-lg" style={{ background: '#F0F5FF', border: '1px solid #D6E4F7' }}>
          {roster.length > 0 ? (
            <select
              className={modalSelectClass}
              value={form.attendingName}
              onChange={e => {
                const name = e.target.value;
                const matched = roster.find(r => r.name === name);
                const autoActivity = matched?.activities?.length === 1 ? matched.activities[0] : '';
                setForm(p => ({ ...p, attendingName: name, activityLabel: autoActivity || p.activityLabel }));
              }}>
              <option value="">— Select attending —</option>
              {roster.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
            </select>
          ) : (
            <input value={form.attendingName} onChange={e => setForm(p => ({ ...p, attendingName: e.target.value }))}
              placeholder="Attending name" style={miniInput} />
          )}

          {(() => {
            const matched = roster.find(r => r.name === form.attendingName);
            const acts    = matched?.activities ?? [];
            return acts.length > 0 ? (
              <select
                className={modalSelectClass}
                value={form.activityLabel}
                onChange={e => setForm(p => ({ ...p, activityLabel: e.target.value }))}>
                <option value="">— Select activity —</option>
                {acts.map(a => <option key={a} value={a}>{a}</option>)}
                {form.activityLabel && !acts.includes(form.activityLabel) && (
                  <option value={form.activityLabel}>{form.activityLabel}</option>
                )}
              </select>
            ) : (
              <input value={form.activityLabel} onChange={e => setForm(p => ({ ...p, activityLabel: e.target.value }))}
                placeholder="Activity label (e.g. General Medicine)" style={miniInput} />
            );
          })()}
          <label className="flex items-center gap-2" style={{ fontSize: 12, color: '#374151', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.isCallDay} onChange={e => setForm(p => ({ ...p, isCallDay: e.target.checked }))} />
            Mark as call day
          </label>
          <div className="flex gap-2">
            <button onClick={cancelForm}
              style={{ flex: 1, padding: '6px', borderRadius: 6, border: '1px solid #E8EFF6', background: '#fff', color: '#64748B', fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{ flex: 1, padding: '6px', borderRadius: 6, border: 'none', background: '#1A3A5C', color: '#fff', fontSize: 12, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? '…' : editId ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── FlagSection (inside modal) ────────────────────────────────────────────────

function FlagSection({ day, blockId, flag, onFlagChange }) {
  const iso = toISODate(day);
  const [label, setLabel] = useState(flag?.label ?? '');
  const [color, setColor] = useState(flag?.color ?? FLAG_PRESETS[0].color);
  const [saving, setSaving] = useState(false);

  const handleSaveFlag = async () => {
    if (!label.trim()) return;
    setSaving(true);
    try {
      let saved;
      if (flag?.id) {
        const { data } = await api.put(`/flags/${flag.id}`, { label: label.trim(), color });
        saved = data;
      } else {
        const { data } = await api.post('/flags', { blockId, date: iso, label: label.trim(), color });
        saved = data;
      }
      onFlagChange(iso, saved);
      toast.success('Flag saved');
    } catch {
      toast.error('Failed to save flag');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveFlag = async () => {
    if (!flag?.id) return;
    setSaving(true);
    try {
      await api.delete(`/flags/${flag.id}`);
      onFlagChange(iso, null);
      setLabel('');
      toast.success('Flag removed');
    } catch {
      toast.error('Failed to remove flag');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ borderTop: '1px solid #E8EFF6', padding: '14px 20px' }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        Flag this day
      </p>
      <input
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="e.g. Teaching Day"
        style={{ ...miniInput, marginBottom: 8 }}
      />
      {/* Color presets */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {FLAG_PRESETS.map(p => (
          <button
            key={p.color}
            title={p.label}
            onClick={() => { setColor(p.color); if (!label.trim()) setLabel(p.label); }}
            style={{
              width: 22, height: 22, borderRadius: '50%', border: 'none',
              background: p.color, cursor: 'pointer',
              outline: color === p.color ? `2px solid ${p.color}` : '2px solid transparent',
              outlineOffset: 2, flexShrink: 0,
            }}
          />
        ))}
      </div>
      {/* Preview */}
      {label.trim() && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '4px 10px', borderRadius: 6, background: color + '26', border: `1px solid ${color}55` }}>
          <span style={{ fontSize: 11, fontWeight: 600, color }}>· {label.trim()}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {flag?.id && (
          <button
            onClick={handleRemoveFlag}
            disabled={saving}
            style={{ flex: 1, padding: '6px', borderRadius: 6, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#DC2626', fontSize: 12, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            Remove
          </button>
        )}
        <button
          onClick={handleSaveFlag}
          disabled={saving || !label.trim()}
          style={{ flex: 1, padding: '6px', borderRadius: 6, border: 'none', background: color, color: '#fff', fontSize: 12, fontWeight: 600, cursor: (saving || !label.trim()) ? 'not-allowed' : 'pointer', opacity: (saving || !label.trim()) ? 0.5 : 1 }}
        >
          {saving ? '…' : 'Save flag'}
        </button>
      </div>
    </div>
  );
}

// ── DayModal ──────────────────────────────────────────────────────────────────

function DayModal({ isOpen, day, attendings, residents, roster, assignment, blockId, flag, onSave, onClose, onAttendingChange, onFlagChange }) {
  const [visible, setVisible] = useState(false);
  const assignmentFormRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => setVisible(true), 10);
      return () => clearTimeout(t);
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  if (!day) {
    return (
      <div className={`modal-backdrop${visible ? ' open' : ''}`} onClick={onClose}>
        <div className={`w-full max-w-sm rounded-t-2xl md:rounded-2xl overflow-hidden modal-panel${visible ? ' open' : ''}`} />
      </div>
    );
  }

  const seniors = residents.filter(r => r.residentRole === 'senior' && !r.isMedStudent);
  const juniors = residents.filter(r => r.residentRole === 'junior' && !r.isMedStudent);

  const dayKey = toISODate(day);
  const warning = null;

  const handleSave = () => {
    const formData = new FormData(assignmentFormRef.current);
    const seniorId = formData.get('seniorId') || '';
    const juniorId = formData.get('juniorId') || '';
    const seniorName = residents.find(r => r.id === seniorId)?.name ?? '';
    const juniorName = residents.find(r => r.id === juniorId)?.name ?? '';
    const warning = seniorId && juniorId && seniorId === juniorId ? 'Same resident assigned to both roles' : null;
    onSave({ senior: seniorName, junior: juniorName, seniorId, juniorId, warning });
  };

  return (
    <div
      className={`modal-backdrop${visible ? ' open' : ''}`}
      onClick={onClose}
    >
      <div
        className={`w-full max-w-sm rounded-t-2xl md:rounded-2xl overflow-hidden modal-panel${visible ? ' open' : ''}`}
        style={{ background: '#fff', boxShadow: '0 20px 60px rgba(26,58,92,0.18)', border: '1px solid #E8EFF6' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #E8EFF6' }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#1A3A5C' }}>{fmtFull(day)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = '#F0F5FF'}
            onMouseLeave={e => e.currentTarget.style.background = ''}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <AttendingSection
          day={day}
          blockId={blockId}
          roster={roster ?? []}
          initialEntries={attendings ?? []}
          onChange={onAttendingChange}
        />

        <div ref={assignmentFormRef} className="px-5 py-4 space-y-4">
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: '#64748B', marginBottom: 4 }}>Senior resident</label>
            <select key={`senior-${dayKey}`} name="seniorId" className={modalSelectClass} defaultValue={assignment?.seniorId ?? ''}>
              <option value="">— Unassigned —</option>
              {seniors.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: '#64748B', marginBottom: 4 }}>Junior resident</label>
            <select key={`junior-${dayKey}`} name="juniorId" className={modalSelectClass} defaultValue={assignment?.juniorId ?? ''}>
              <option value="">— Unassigned —</option>
              {juniors.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          {warning && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: '#FEF2F2', border: '1px solid #FCA5A5' }}>
              <span style={{ fontSize: 12, color: '#DC2626' }}>⚠ {warning}</span>
            </div>
          )}
        </div>

        <FlagSection
          day={day}
          blockId={blockId}
          flag={flag}
          onFlagChange={onFlagChange}
        />

        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-medium"
            style={{ border: '1px solid #E8EFF6', color: '#64748B', background: '#F8FAFC', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = '#F0F5FF'}
            onMouseLeave={e => e.currentTarget.style.background = '#F8FAFC'}>Cancel</button>
          <button
            onClick={handleSave}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: '#1A3A5C', cursor: 'pointer', border: 'none' }}
            onMouseEnter={e => e.currentTarget.style.background = '#2C5F8A'}
            onMouseLeave={e => e.currentTarget.style.background = '#1A3A5C'}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── GenSummaryModal ───────────────────────────────────────────────────────────

function GenSummaryModal({ summary, onClose }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="w-full max-w-sm rounded-2xl overflow-hidden"
        style={{ background: '#fff', boxShadow: '0 20px 60px rgba(26,58,92,0.18)', border: '1px solid #E8EFF6' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ height: 4, background: 'linear-gradient(90deg, #16A34A 0%, #2C5F8A 100%)' }} />
        <div style={{ padding: '24px 24px 20px' }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1A3A5C', margin: 0 }}>Schedule Generated</h2>
          <p style={{ fontSize: 13, color: '#94A3B8', marginTop: 4, marginBottom: 20 }}>Auto-generation complete</p>

          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: 'Work Days',  value: summary.workDays,   color: '#1A3A5C' },
              { label: 'Assigned',   value: summary.assigned,   color: '#16A34A' },
              { label: 'Unassigned', value: summary.unassigned, color: summary.unassigned > 0 ? '#D97706' : '#94A3B8' },
            ].map(s => (
              <div key={s.label} className="text-center p-3 rounded-xl" style={{ background: '#F8FAFC' }}>
                <p style={{ fontSize: 24, fontWeight: 700, color: s.color, margin: 0 }}>{s.value}</p>
                <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{s.label}</p>
              </div>
            ))}
          </div>

          {summary.callSummary?.length > 0 && (
            <div className="mb-4">
              <p style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                Call Distribution
              </p>
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {summary.callSummary.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span style={{ fontSize: 12, color: '#1A3A5C', flex: 1 }}>{r.name}</span>
                    <span style={{ fontSize: 11, color: '#94A3B8', textTransform: 'capitalize' }}>{r.role}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: r.calls >= 9 ? '#DC2626' : r.calls >= 7 ? '#D97706' : '#16A34A', minWidth: 20, textAlign: 'right' }}>
                      {r.calls}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {summary.usedFallback && (
            <div className="mb-4 px-3 py-2 rounded-lg" style={{ background: '#FFF7ED', border: '1px solid #FED7AA' }}>
              <p style={{ fontSize: 11, color: '#C2410C', fontWeight: 500 }}>
                Note: Some residents were scheduled using default settings because no block enrollment was found.
              </p>
            </div>
          )}

          {summary.warnings?.length > 0 && (
            <div className="mb-4 max-h-32 overflow-y-auto">
              <p style={{ fontSize: 10, fontWeight: 700, color: '#D97706', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                Warnings ({summary.warnings.length})
              </p>
              {summary.warnings.map((w, i) => (
                <p key={i} style={{ fontSize: 11, color: '#64748B', marginBottom: 3 }}>⚠ {w.date}: {w.message}</p>
              ))}
            </div>
          )}

          <button onClick={onClose}
            style={{ width: '100%', padding: '10px', borderRadius: 10, border: 'none', background: '#1A3A5C', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = '#2C5F8A'}
            onMouseLeave={e => e.currentTarget.style.background = '#1A3A5C'}>
            View Schedule
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── PublishConfirmModal ───────────────────────────────────────────────────────

function PublishConfirmModal({ onConfirm, onClose, publishing }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="w-full max-w-sm rounded-2xl overflow-hidden"
        style={{ background: '#fff', boxShadow: '0 20px 60px rgba(26,58,92,0.18)', border: '1px solid #E8EFF6' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ height: 4, background: 'linear-gradient(90deg, #16A34A 0%, #2C5F8A 100%)' }} />
        <div style={{ padding: '24px 24px 20px' }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1A3A5C', margin: '0 0 8px' }}>Publish Schedule</h2>
          <p style={{ fontSize: 13, color: '#64748B', marginBottom: 20, lineHeight: 1.5 }}>
            This will make the schedule publicly viewable via a shareable link. Residents will be able to see their assignments without logging in.
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} disabled={publishing}
              style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid #E8EFF6', background: '#F8FAFC', color: '#64748B', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = '#F0F5FF'}
              onMouseLeave={e => e.currentTarget.style.background = '#F8FAFC'}>
              Cancel
            </button>
            <button onClick={onConfirm} disabled={publishing}
              style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#16A34A', color: '#fff', fontSize: 13, fontWeight: 600, cursor: publishing ? 'not-allowed' : 'pointer', opacity: publishing ? 0.7 : 1 }}
              onMouseEnter={e => { if (!publishing) e.currentTarget.style.background = '#15803D'; }}
              onMouseLeave={e => e.currentTarget.style.background = '#16A34A'}>
              {publishing ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── ClearConfirmModal ─────────────────────────────────────────────────────────

function ClearConfirmModal({ blockNum, onConfirm, onClose, clearing }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="w-full max-w-sm rounded-2xl overflow-hidden"
        style={{ background: '#fff', boxShadow: '0 20px 60px rgba(26,58,92,0.18)', border: '1px solid #E8EFF6' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ height: 4, background: '#DC2626' }} />
        <div style={{ padding: '24px 24px 20px' }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1A3A5C', margin: '0 0 8px' }}>Clear schedule</h2>
          <p style={{ fontSize: 13, color: '#64748B', marginBottom: 20, lineHeight: 1.5 }}>
            This will remove all resident call assignments for Block {blockNum}. Attending entries will not be affected. This cannot be undone.
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} disabled={clearing}
              style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid #E8EFF6', background: '#F8FAFC', color: '#64748B', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = '#F0F5FF'}
              onMouseLeave={e => e.currentTarget.style.background = '#F8FAFC'}>
              Cancel
            </button>
            <button onClick={onConfirm} disabled={clearing}
              style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#DC2626', color: '#fff', fontSize: 13, fontWeight: 600, cursor: clearing ? 'not-allowed' : 'pointer', opacity: clearing ? 0.7 : 1 }}
              onMouseEnter={e => { if (!clearing) e.currentTarget.style.background = '#B91C1C'; }}
              onMouseLeave={e => e.currentTarget.style.background = '#DC2626'}>
              {clearing ? 'Clearing…' : 'Clear all assignments'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── PublishSuccessModal ──────────────────────────────────────────────────────

function PublishSuccessModal({ publicUrl, onClose }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(publicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{ background: '#fff', boxShadow: '0 20px 60px rgba(26,58,92,0.18)', border: '1px solid #E8EFF6' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ height: 4, background: 'linear-gradient(90deg, #16A34A 0%, #2C5F8A 100%)' }} />
        <div style={{ padding: '24px 24px 20px', textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1A3A5C', margin: '0 0 6px' }}>Schedule published!</h2>
          <p style={{ fontSize: 13, color: '#64748B', marginBottom: 16 }}>Share this link with your team.</p>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              readOnly
              value={publicUrl}
              style={{
                flex: 1, padding: '9px 12px', borderRadius: 8,
                border: '1px solid #E2E8F0', fontSize: 12, color: '#2C5F8A',
                background: '#F0F5FF', fontFamily: 'monospace', outline: 'none',
              }}
            />
            <button
              onClick={handleCopy}
              style={{
                padding: '9px 16px', borderRadius: 8,
                border: '1px solid #C7D9EC', background: copied ? '#DCFCE7' : '#EEF4FF',
                color: copied ? '#15803D' : '#2C5F8A', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => window.open(publicUrl, '_blank')}
              style={{
                flex: 1, padding: '10px', borderRadius: 10, border: '1px solid #C7D9EC',
                background: '#EEF4FF', color: '#2C5F8A', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#DCE9F5'}
              onMouseLeave={e => e.currentTarget.style.background = '#EEF4FF'}
            >
              View published version
            </button>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: '10px', borderRadius: 10, border: 'none',
                background: '#1A3A5C', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#2C5F8A'}
              onMouseLeave={e => e.currentTarget.style.background = '#1A3A5C'}
            >
              Done
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── CalendarTopBar ────────────────────────────────────────────────────────────

function Spinner() {
  return <div className="w-3.5 h-3.5 rounded-full border-2 animate-spin inline-block"
    style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />;
}

const CalendarTopBar = memo(function CalendarTopBar({
  blockNum, blockStart, blockEnd, days, assignmentMap,
  onAutoGenerate, generating,
  onClearSchedule, clearingSchedule,
  onPublish, publishPulsing,
  isPublished, publicToken,
  onCopyLink,
  onExportExcel, exportingExcel,
  onViewPublished,
  blockId,
}) {
  const assigned   = days.filter(d => { const a = assignmentMap[toISODate(d)]; return a?.seniorId || a?.juniorId; }).length;
  const unassigned = days.length - assigned;
  const warnings   = days.filter(d => assignmentMap[toISODate(d)]?.warning).length;

  const fmtRange = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  const stat = (label, value, color) => (
    <div className="flex flex-col items-center">
      <motion.span key={value} initial={{ scale: 1.2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1 }}>{value}</motion.span>
      <span style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{label}</span>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
      className="rounded-xl mb-4 overflow-hidden"
      style={{ border: '1px solid #E8EFF6', background: '#fff', boxShadow: '0 1px 3px rgba(26,58,92,0.05)' }}>
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4" style={{ borderBottom: '1px solid #E8EFF6' }}>
        <div className="flex items-center gap-3">
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1A3A5C' }}>Block {blockNum} Calendar</h1>
            {blockStart && blockEnd && (
              <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
                {fmtRange(blockStart)} – {fmtRange(blockEnd)}
              </p>
            )}
          </div>
          {/* Published / Draft badge */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
            background: isPublished ? '#DCFCE7' : '#F1F5F9',
            color: isPublished ? '#15803D' : '#94A3B8',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: isPublished ? '#16A34A' : '#CBD5E1', display: 'inline-block' }} />
            {isPublished ? 'Published' : 'Draft'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Export Excel */}
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
            onClick={onExportExcel}
            disabled={exportingExcel || !blockId}
            className="px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5"
            style={{ background: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0', cursor: exportingExcel ? 'not-allowed' : 'pointer' }}
            onMouseEnter={e => { if (!exportingExcel) e.currentTarget.style.background = '#DCFCE7'; }}
            onMouseLeave={e => e.currentTarget.style.background = '#F0FDF4'}>
            {exportingExcel ? <Spinner /> : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            )}
            Excel
          </motion.button>

          {/* View published (only when published) */}
          {isPublished && publicToken && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
              onClick={onViewPublished}
              className="px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5"
              style={{ background: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = '#DCFCE7'}
              onMouseLeave={e => e.currentTarget.style.background = '#F0FDF4'}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              View published
            </motion.button>
          )}

          {/* Copy share link (only when published) */}
          {isPublished && publicToken && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
              onClick={onCopyLink}
              className="px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5"
              style={{ background: '#EEF4FF', color: '#2C5F8A', border: '1px solid #C7D9EC', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = '#DCE9F5'}
              onMouseLeave={e => e.currentTarget.style.background = '#EEF4FF'}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
              Copy link
            </motion.button>
          )}

          {/* Clear schedule */}
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
            onClick={onClearSchedule}
            disabled={clearingSchedule}
            className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
            style={{ background: '#fff', color: '#DC2626', border: '1px solid #FCA5A5', cursor: clearingSchedule ? 'not-allowed' : 'pointer' }}
            onMouseEnter={e => { if (!clearingSchedule) { e.currentTarget.style.background = '#FEF2F2'; e.currentTarget.style.borderColor = '#EF4444'; } }}
            onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#FCA5A5'; }}>
            {clearingSchedule ? <><Spinner /><span style={{ color: '#DC2626' }}>Clearing…</span></> : 'Clear schedule'}
          </motion.button>

          {/* Auto-generate */}
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
            onClick={onAutoGenerate}
            disabled={generating}
            className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
            style={{ background: '#EEF4FF', color: '#2C5F8A', border: '1px solid #C7D9EC', cursor: generating ? 'not-allowed' : 'pointer' }}
            onMouseEnter={e => { if (!generating) e.currentTarget.style.background = '#DCE9F5'; }}
            onMouseLeave={e => e.currentTarget.style.background = '#EEF4FF'}>
            {generating ? <><Spinner /><span style={{ color: '#2C5F8A' }}>Generating…</span></> : 'Auto-generate'}
          </motion.button>

          {/* Publish */}
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.95 }}
            animate={publishPulsing ? { boxShadow: ['0 0 0 0 rgba(22,163,74,0)', '0 0 0 8px rgba(22,163,74,0.25)', '0 0 0 0 rgba(22,163,74,0)'] } : {}}
            transition={publishPulsing ? { duration: 0.6, repeat: 2 } : {}}
            onClick={onPublish}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ background: isPublished ? '#16A34A' : '#1A3A5C', cursor: 'pointer', border: 'none' }}
            onMouseEnter={e => e.currentTarget.style.background = isPublished ? '#15803D' : '#2C5F8A'}
            onMouseLeave={e => e.currentTarget.style.background = isPublished ? '#16A34A' : '#1A3A5C'}>
            {isPublished ? 'Re-publish' : 'Publish'}
          </motion.button>
        </div>
      </div>
      <div className="flex flex-wrap gap-6 px-6 py-3">
        {stat('Total days', days.length, '#1A3A5C')}
        {stat('Assigned', assigned, '#16A34A')}
        {stat('Unassigned', unassigned, '#D97706')}
        {stat('Warnings', warnings, '#DC2626')}
      </div>
    </motion.div>
  );
});

// ── main page ─────────────────────────────────────────────────────────────────

export default function Calendar() {
  const { blockNumber } = useParams();
  const { currentProgram, refreshContext } = useUser();
  const { currentBlock, setCurrentBlock, currentAcademicYear } = useBlock();

  const blockNum  = parseInt(blockNumber ?? '1', 10);
  const programId = currentProgram?.programId ?? null;

  // Sync currentBlock from context when navigating directly to a block URL
  useEffect(() => {
    if (currentAcademicYear?.blocks) {
      const matchingBlock = currentAcademicYear.blocks.find(b => b.number === blockNum);
      if (matchingBlock && matchingBlock.id !== currentBlock?.id) {
        setCurrentBlock(matchingBlock);
      }
    }
  }, [blockNum, currentAcademicYear, currentBlock?.id, setCurrentBlock]);

  const blockId = currentBlock?.id ?? null;

  const days = useMemo(() => {
    if (currentBlock?.startDate && currentBlock?.endDate) {
      return getDaysFromDates(currentBlock.startDate, currentBlock.endDate);
    }
    return getDaysInBlock(blockNum);
  }, [currentBlock, blockNum]);

  const [attendingEntries, setAttendingEntries] = useState([]);
  const [assignmentsMap, setAssignmentsMap]     = useState({});
  const [residents, setResidents]               = useState([]);
  const [roster, setRoster]                     = useState([]);
  const [flags, setFlags]                       = useState([]);
  const [selectedDay, setSelectedDay]           = useState(null);
  const [modalDay, setModalDay]                 = useState(null);
  const [loadingData, setLoadingData]           = useState(false);
  const [generating, setGenerating]             = useState(false);
  const [genSummary, setGenSummary]             = useState(null);
  const [publishPulsing, setPublishPulsing]     = useState(false);
  const [showPublishModal, setShowPublishModal]     = useState(false);
  const [showPublishSuccess, setShowPublishSuccess] = useState(false);
  const [publishing, setPublishing]                 = useState(false);
  const [exportingExcel, setExportingExcel]         = useState(false);
  const [showClearModal, setShowClearModal]         = useState(false);
  const [clearing, setClearing]                     = useState(false);
  const latestBlockIdRef = useRef(blockId);

  useEffect(() => {
    latestBlockIdRef.current = blockId;
  }, [blockId]);

  // Derived from context — persists across tab switches
  const isPublished = currentBlock?.isPublished ?? false;
  const publicToken = currentBlock?.publicToken ?? null;

  useEffect(() => {
    if (!blockId) return;
    const controller = new AbortController();
    const { signal } = controller;
    const currentBlockId = blockId;
    let cancelled = false;

    async function fetchBlockData() {
      setLoadingData(true);
      try {
        const [att, asgn, res, ros, fl] = await Promise.all([
          api.get(`/attending?blockId=${currentBlockId}`, { signal }),
          api.get(`/assignments?blockId=${currentBlockId}`, { signal }),
          programId ? api.get(`/residents?programId=${programId}`, { signal }) : Promise.resolve({ data: [] }),
          programId ? api.get(`/attending/roster?programId=${programId}`, { signal }) : Promise.resolve({ data: [] }),
          api.get(`/flags?blockId=${currentBlockId}`, { signal }),
        ]);

        if (cancelled || latestBlockIdRef.current !== currentBlockId) return;
        setAttendingEntries(att.data);
        setAssignmentsMap(buildAssignmentsMap(asgn.data));
        setResidents(res.data);
        setRoster(ros.data.map(r => ({ id: r.id, name: r.attendingName, activities: r.typicalActivities })));
        setFlags(fl.data);
      } catch (err) {
        if (!cancelled && err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {
          // Keep the existing silent failure behavior for transient API errors.
        }
      } finally {
        if (!cancelled && latestBlockIdRef.current === currentBlockId) setLoadingData(false);
      }
    }

    fetchBlockData();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [blockId, programId]);

  const attendingMap = useMemo(() => {
    const map = {};
    attendingEntries.forEach(e => {
      const iso = apiDateKey(e.date);
      if (!map[iso]) map[iso] = [];
      map[iso].push(e);
    });
    return map;
  }, [attendingEntries]);

  const flagsMap = useMemo(() => {
    const map = {};
    flags.forEach(f => { map[toISODate(new Date(f.date))] = f; });
    return map;
  }, [flags]);

  const handleDayClick = useCallback((day) => {
    setModalDay(day);
    setSelectedDay(day);
  }, []);

  const closeDayModal = useCallback(() => {
    setSelectedDay(null);
  }, []);

  const handleAttendingChange = useCallback((iso, updatedEntries) => {
    setAttendingEntries(prev => [
      ...prev.filter(e => apiDateKey(e.date) !== iso),
      ...updatedEntries,
    ]);
  }, []);

  const handleFlagChange = useCallback((iso, flagOrNull) => {
    setFlags(prev => {
      const without = prev.filter(f => toISODate(new Date(f.date)) !== iso);
      return flagOrNull ? [...without, flagOrNull] : without;
    });
  }, []);

  const handleSaveAssignment = useCallback(async ({ seniorId, juniorId, senior, junior }) => {
    if (!selectedDay) return;
    const iso      = toISODate(selectedDay);
    const existing = assignmentsMap[iso] ?? {};

    setAssignmentsMap(prev => ({
      ...prev,
      [iso]: {
        callDayId: existing.callDayId,
        seniorId: seniorId || undefined,
        senior:   senior   || undefined,
        juniorId: juniorId || undefined,
        junior:   junior   || undefined,
        seniorAssignmentId: seniorId === existing.seniorId ? existing.seniorAssignmentId : undefined,
        juniorAssignmentId: juniorId === existing.juniorId ? existing.juniorAssignmentId : undefined,
      },
    }));
    setSelectedDay(null);

    try {
      const dayEntries       = attendingMap[iso] ?? [];
      const attendingEntryId = (dayEntries.find(e => e.isCallDay) ?? dayEntries[0])?.id ?? null;

      if (!seniorId && existing.seniorAssignmentId)
        await api.delete(`/assignments/${existing.seniorAssignmentId}`);
      if (!juniorId && existing.juniorAssignmentId)
        await api.delete(`/assignments/${existing.juniorAssignmentId}`);
      if (seniorId && existing.seniorAssignmentId && seniorId !== existing.seniorId)
        await api.delete(`/assignments/${existing.seniorAssignmentId}`);
      if (juniorId && existing.juniorAssignmentId && juniorId !== existing.juniorId)
        await api.delete(`/assignments/${existing.juniorAssignmentId}`);

      let newCallDayId = existing.callDayId;
      let newSeniorAid, newJuniorAid;

      if (seniorId) {
        const { data } = await api.post('/assignments', { blockId, date: iso, residentId: seniorId, roleOnDay: 'senior', attendingEntryId });
        newCallDayId = data.callDay.id;
        newSeniorAid = data.assignment.id;
      }
      if (juniorId) {
        const { data } = await api.post('/assignments', { blockId, date: iso, residentId: juniorId, roleOnDay: 'junior', attendingEntryId });
        newCallDayId = data.callDay.id;
        newJuniorAid = data.assignment.id;
      }

      setAssignmentsMap(prev => ({
        ...prev,
        [iso]: {
          callDayId: newCallDayId,
          seniorId: seniorId || undefined, senior: senior || undefined, seniorAssignmentId: newSeniorAid,
          juniorId: juniorId || undefined, junior: junior || undefined, juniorAssignmentId: newJuniorAid,
        },
      }));
      toast.success(`${fmtShort(selectedDay ?? new Date(iso))} saved`);
    } catch {
      toast.error('Failed to save assignment');
    }
  }, [assignmentsMap, attendingMap, blockId, selectedDay]);

  const handleAutoGenerate = useCallback(async () => {
    if (!blockId) { toast.error('No block selected'); return; }
    setGenerating(true);
    try {
      const { data: summary } = await api.post('/schedule/generate', { blockId });
      const { data: asgn } = await api.get(`/assignments?blockId=${blockId}`);
      setAssignmentsMap(buildAssignmentsMap(asgn));
      setGenSummary(summary);
      toast.success('Schedule generated!');
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Failed to generate schedule');
    } finally {
      setGenerating(false);
    }
  }, [blockId]);

  const handleClearSchedule = useCallback(async () => {
    if (!blockId) return;
    setClearing(true);
    try {
      await api.delete('/schedule/clear', { data: { blockId } });
      setAssignmentsMap({});
      setGenSummary(null);
      setShowClearModal(false);
      toast.success('Schedule cleared successfully');
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Failed to clear schedule');
    } finally {
      setClearing(false);
    }
  }, [blockId]);

  const handlePublish = useCallback(() => {
    if (!blockId) return;
    setShowPublishModal(true);
  }, [blockId]);

  const handleConfirmPublish = useCallback(async () => {
    setPublishing(true);
    try {
      const { data } = await api.post('/schedule/publish', { blockId });
      // Refresh context so isPublished + publicToken persist in AppContext
      await refreshContext();
      // Update currentBlock to the refreshed version with new publicToken
      setCurrentBlock(prev => prev ? { ...prev, isPublished: true, publicToken: data.publicToken } : prev);
      setPublishPulsing(true);
      setTimeout(() => setPublishPulsing(false), 1200);
      setShowPublishModal(false);
      setShowPublishSuccess(true);
    } catch {
      toast.error('Failed to publish');
      setShowPublishModal(false);
    } finally {
      setPublishing(false);
    }
  }, [blockId, refreshContext, setCurrentBlock]);

  const handleCopyLink = useCallback(() => {
    if (!publicToken) return;
    const link = `${window.location.origin}/schedule/${publicToken}`;
    navigator.clipboard.writeText(link).then(() => {
      toast.success('Link copied!');
    }).catch(() => {
      toast.error('Failed to copy link');
    });
  }, [publicToken]);

  const handleExportExcel = useCallback(async () => {
    if (!blockId) return;
    setExportingExcel(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`http://localhost:3000/api/schedule/export/excel?blockId=${blockId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `block-${blockNum}-schedule.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Excel exported!');
    } catch {
      toast.error('Failed to export Excel');
    } finally {
      setExportingExcel(false);
    }
  }, [blockId, blockNum]);

  const openClearModal = useCallback(() => {
    setShowClearModal(true);
  }, []);

  const handleViewPublished = useCallback(() => {
    if (publicToken) window.open(`${window.location.origin}/schedule/${publicToken}`, '_blank');
  }, [publicToken]);

  const publicUrl = publicToken ? `${window.location.origin}/schedule/${publicToken}` : '';

  // Grid layout
  const weeks = useMemo(() => {
    const firstDay = days[0];
    const paddingBefore = firstDay ? (firstDay.getDay() + 6) % 7 : 0;
    const padded = [...Array(paddingBefore).fill(null), ...days];
    while (padded.length % 7 !== 0) padded.push(null);
    const rows = [];
    for (let i = 0; i < padded.length; i += 7) rows.push(padded.slice(i, i + 7));
    return rows;
  }, [days]);

  const modalIso       = modalDay ? toISODate(modalDay) : null;
  const selectedIso    = selectedDay ? toISODate(selectedDay) : modalIso;
  const assignedToday  = selectedIso ? assignmentsMap[selectedIso] : null;
  const attendingToday = selectedIso ? (attendingMap[selectedIso] ?? []) : [];
  const flagToday      = selectedIso ? (flagsMap[selectedIso] ?? null) : null;

  return (
    <PageWrapper>
      <Layout>
        <CalendarTopBar
          blockNum={blockNum}
          blockStart={currentBlock?.startDate}
          blockEnd={currentBlock?.endDate}
          days={days}
          assignmentMap={assignmentsMap}
          onAutoGenerate={handleAutoGenerate}
          generating={generating}
          onClearSchedule={openClearModal}
          clearingSchedule={clearing}
          onPublish={handlePublish}
          publishPulsing={publishPulsing}
          isPublished={isPublished}
          publicToken={publicToken}
          onCopyLink={handleCopyLink}
          onExportExcel={handleExportExcel}
          exportingExcel={exportingExcel}
          onViewPublished={handleViewPublished}
          blockId={blockId}
        />

        {loadingData ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hidden md:grid grid-cols-7 gap-1">
            {[...Array(35)].map((_, i) => <Skeleton key={i} height={100} radius={12} style={{ minHeight: 100 }} />)}
          </motion.div>
        ) : (
          <>
            {/* Desktop grid */}
            <div className="hidden md:block">
              <div className="grid grid-cols-7 gap-1 mb-1">
                {DAYS_OF_WEEK.map(d => (
                  <div key={d} className="text-center py-2"
                    style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {d}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                {weeks.map((week, wi) => (
                  <div key={wi} className="grid grid-cols-7 gap-1">
                    {week.map((day, di) => (
                      <div key={di} style={{ minHeight: 100 }}>
                        {day ? (
                          <DayCell
                            day={day}
                            attendings={attendingMap[toISODate(day)]}
                            assignment={assignmentsMap[toISODate(day)]}
                            flag={flagsMap[toISODate(day)] ?? null}
                            isHoliday={false}
                            onClick={handleDayClick}
                            animDelay={wi * 0.04 + di * 0.025}
                          />
                        ) : (
                          <div className="h-full rounded-xl" style={{ background: '#F8FAFC', border: '1px solid #F1F5F9', minHeight: 100 }} />
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Mobile list */}
            <div className="md:hidden rounded-xl overflow-hidden" style={{ border: '1px solid #E8EFF6', boxShadow: '0 1px 3px rgba(26,58,92,0.05)' }}>
              <div className="px-4 py-3" style={{ background: '#F8FAFC', borderBottom: '1px solid #E8EFF6' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>
                  {days.length} days · Tap a day to assign residents
                </span>
              </div>
              {days.map((day, i) => (
                <DayRow
                  key={i}
                  day={day}
                  attendings={attendingMap[toISODate(day)]}
                  assignment={assignmentsMap[toISODate(day)]}
                  flag={flagsMap[toISODate(day)] ?? null}
                  isHoliday={false}
                  onClick={() => handleDayClick(day)}
                />
              ))}
            </div>
          </>
        )}

        {/* Day edit modal */}
        <DayModal
          isOpen={selectedDay !== null}
          day={modalDay}
          attendings={attendingToday}
          residents={residents}
          roster={roster}
          assignment={assignedToday}
          blockId={blockId}
          flag={flagToday}
          onSave={handleSaveAssignment}
          onClose={closeDayModal}
          onAttendingChange={handleAttendingChange}
          onFlagChange={handleFlagChange}
        />

        {/* Generation summary modal */}
        <AnimatePresence>
          {genSummary && (
            <GenSummaryModal summary={genSummary} onClose={() => setGenSummary(null)} />
          )}
        </AnimatePresence>

        {/* Clear schedule confirmation modal */}
        <AnimatePresence>
          {showClearModal && (
            <ClearConfirmModal
              blockNum={blockNum}
              onConfirm={handleClearSchedule}
              onClose={() => setShowClearModal(false)}
              clearing={clearing}
            />
          )}
        </AnimatePresence>

        {/* Publish confirmation modal */}
        <AnimatePresence>
          {showPublishModal && (
            <PublishConfirmModal
              onConfirm={handleConfirmPublish}
              onClose={() => setShowPublishModal(false)}
              publishing={publishing}
            />
          )}
        </AnimatePresence>

        {/* Publish success modal */}
        <AnimatePresence>
          {showPublishSuccess && publicUrl && (
            <PublishSuccessModal
              publicUrl={publicUrl}
              onClose={() => setShowPublishSuccess(false)}
            />
          )}
        </AnimatePresence>
      </Layout>
    </PageWrapper>
  );
}
