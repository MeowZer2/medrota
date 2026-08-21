import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import Layout from '../components/Layout';
import PageWrapper from '../components/PageWrapper';
import { Skeleton } from '../components/Skeleton';
import api from '../api/axios';
import { useBlock, useUser } from '../context/AppContext';
import {
  getDaysInBlock, isWeekend,
  toISODate, fmtShort, fmtDay, fmtFull, DAYS_OF_WEEK,
} from '../lib/blockUtils';
import ReadinessPanel from '../components/ReadinessPanel';
import Modal, { useDialogA11y } from '../components/Modal';
import { ViolationCard, UnfilledSlotCard } from '../components/ViolationList';
import AuditHistory from '../components/AuditHistory';

// â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function normalizeDateKey(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  if (value instanceof Date) return toISODate(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : toISODate(date);
}

function dateFromDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function getDaysFromDateKeys(startDate, endDate) {
  const startKey = normalizeDateKey(startDate);
  const endKey = normalizeDateKey(endDate);
  if (!startKey || !endKey) return [];
  const current = dateFromDateKey(startKey);
  const end = dateFromDateKey(endKey);
  const days = [];
  while (current <= end) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return days;
}

const DEFAULT_BLOCK_SETTINGS = {
  maxCallsPerResident: 9,
  maxCallsMedStudent: 5,
  allowAttendingOnlyDays: false,
  avoidAcademicDays: true,
};

function buildAssignmentsMap(list) {
  const map = {};
  for (const a of list) {
    const iso = normalizeDateKey(a.callDay.date);
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

// â”€â”€ Chip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function Chip({ label, color, bg }) {
  return (
    <span className="inline-block truncate max-w-full rounded px-1.5 py-0.5 leading-tight"
      style={{ fontSize: 10, fontWeight: 600, background: bg, color, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

// â”€â”€ FLAG presets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/*
 * Day-flag colours are stored per flag in the database and fed straight back
 * into the colour input, so they must stay literal hex. A token here would be
 * persisted as the string "var(--danger)" and then concatenated with an alpha
 * suffix below into invalid CSS.
 *
 * They are the same hue in both themes, which is correct: a flag colour is the
 * user's data, not part of the palette. Only its legibility is themed, by
 * flagInk() below.
 */
/* theme-guard-allow-start: persisted per-flag user data, not palette values */
const FLAG_PRESETS = [
  { color: '#EF4444', label: 'Holiday' },
  { color: '#F59E0B', label: 'Academic day' },
  { color: '#10B981', label: 'Special event' },
  { color: '#3B82F6', label: 'Off-site' },
  { color: '#8B5CF6', label: 'Teaching day' },
  { color: '#14B8A6', label: 'Other' },
];
/* theme-guard-allow-end */

/*
 * A flag colour used as text. The stored hue is a saturated mid-tone picked
 * against a white card, and on the dark canvas it reads too dark. --flag-lift
 * blends it toward the page foreground: 0% in light, so nothing there changes,
 * and enough in dark to clear the card while keeping the hue recognisable
 * against its own tint.
 */
const flagInk = (color) => `color-mix(in srgb, var(--ink-1) var(--flag-lift), ${color})`;

/*
 * A label drawn *on* a flag colour. The fill is whatever the user picked, so no
 * fixed foreground works for every choice — white on the default red is 3.8:1,
 * below AA. This picks the foreground by the fill's own luminance, using the two
 * tokens that stay constant across themes because the colour they sit on does.
 *
 * The two candidates are white and black, and the crossover — where they give
 * equal contrast — is at (L+0.05)^2 = 1.05 x 0.05, i.e. L = 0.179. Picking the
 * better side of that line guarantees at least 4.58:1 for any colour a user can
 * choose, which is why the dark candidate has to be black rather than a softer
 * near-black: the violet preset sits close enough to the crossover that #0B0F17
 * would leave it at 4.37:1.
 */
function onFlagColor(color) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return 'var(--on-color-light)';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.179 ? 'var(--on-color-dark)' : 'var(--on-color-light)';
}

// â”€â”€ DayCell (grid) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DayCell = memo(function DayCell({ dayData, onClick, canEdit }) {
  const { day, attendings, assignment, flag, isHoliday, holidayName } = dayData;
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
  let bg     = 'var(--surface-1)';
  let border = '1px solid var(--border-2)';
  if (flag) {
    bg     = flag.color + '1F'; // 12% opacity
    border = `1px solid ${flag.color}55`;
  } else if (isHoliday) {
    bg     = 'var(--danger-soft-3)';
    border = '1px solid var(--danger-border)';
  } else if (weekend) {
    bg = 'var(--surface-2)';
  }

  const chipBase = { display: 'block', padding: '2px 6px', borderRadius: 4, fontSize: 11, lineHeight: '16px' };

  return (
    <button
      aria-label={`${canEdit ? 'Edit' : 'View'} ${fmtFull(day)}`}
      onClick={() => { if (canEdit) onClick(dayData); }}
      className={`flex flex-col text-left w-full${isHoliday ? ' holiday-glow' : ''}`}
      style={{
        background: bg,
        border,
        borderRadius: 8,
        padding: 8,
        minHeight: 90,
        cursor: canEdit ? 'pointer' : 'default',
        position: 'relative',
        transition: 'transform 90ms ease, border-color 90ms ease, background-color 90ms ease',
        willChange: 'transform',
      }}
      onMouseEnter={e => { if (canEdit) e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
    >
      {/* Date header row */}
      <div className="flex items-baseline gap-1 mb-1 flex-wrap">
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-2)', lineHeight: 1 }}>{dayNum}</span>
        <span style={{ fontSize: 10, color: 'var(--ink-5)', lineHeight: 1 }}>{monthAbbr}</span>
        {flag && (
          <span style={{ fontSize: 9, fontWeight: 600, color: flagInk(flag.color), lineHeight: 1 }}>- {flag.label}</span>
        )}
        {isHoliday && !flag && (
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--danger)', textTransform: 'uppercase', lineHeight: 1, marginLeft: 'auto' }}>{holidayName || 'Holiday'}</span>
        )}
      </div>

      {/* TOP SECTION — non-call attendings as subtle gray chips */}
      {nonCallAtts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {nonCallAtts.map((a, i) => {
            const text = a.activityLabel ? `${a.attendingName} - ${a.activityLabel}` : a.attendingName;
            return <span key={i} style={{ ...chipBase, background: 'var(--surface-3)', color: 'var(--ink-2)' }}>{text}</span>;
          })}
        </div>
      )}

      {/* Divider — only when both sections have content */}
      {showDivider && (
        <div style={{ borderTop: '1px solid var(--border-2)', margin: '4px 0' }} />
      )}

      {/* BOTTOM SECTION — call-day attendings (red chip) + resident chips */}
      {hasBottomSection && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {callAtts.map((a, i) => (
            <span key={`c${i}`} style={{ ...chipBase, background: 'var(--danger-soft)', color: 'var(--danger-ink-strong)' }}>{a.attendingName}</span>
          ))}
          {assignment?.senior && (
            <span style={{ ...chipBase, background: 'var(--success-soft)', color: 'var(--success-ink-strong)' }}>S: {assignment.senior}</span>
          )}
          {assignment?.junior && (
            <span style={{ ...chipBase, background: 'var(--warn-soft)', color: 'var(--warn-ink-strong)' }}>J: {assignment.junior}</span>
          )}
        </div>
      )}

      {/* Unassigned placeholder */}
      {!hasTopSection && !hasBottomSection && (
        <span style={{ fontSize: 10, color: 'var(--ink-5)', fontStyle: 'italic' }}>Unassigned</span>
      )}
    </button>
  );
}, (prevProps, nextProps) => (
  prevProps.dayData === nextProps.dayData &&
  prevProps.onClick === nextProps.onClick &&
  prevProps.canEdit === nextProps.canEdit
));

// â”€â”€ DayRow (mobile) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function DayRow({ dayData, onClick, canEdit }) {
  const { day, attendings, assignment, flag, isHoliday, holidayName } = dayData;
  const weekend = isWeekend(day);
  const nonCallAtts = (attendings ?? []).filter(a => !a.isCallDay);
  const callAtts    = (attendings ?? []).filter(a => a.isCallDay);
  const hasContent  = attendings?.length > 0 || assignment?.seniorId || assignment?.juniorId;

  const rowBg = flag
    ? flag.color + '1A'
    : isHoliday ? 'var(--danger-soft-3)' : weekend ? 'var(--surface-2)' : 'var(--surface-1)';
  const accentColor = flag
    ? flag.color
    : isHoliday ? 'var(--danger-border)' : weekend ? 'var(--border-2)' : 'transparent';

  return (
    <button aria-label={`${canEdit ? 'Edit' : 'View'} ${fmtFull(day)}`} onClick={() => { if (canEdit) onClick(dayData); }} className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors duration-100"
      style={{ background: rowBg, borderLeft: `3px solid ${accentColor}`, borderBottom: '1px solid var(--border-subtle)', cursor: canEdit ? 'pointer' : 'default' }}
      onMouseEnter={e => { if (canEdit) e.currentTarget.style.background = 'var(--accent-soft-2)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}
    >
      <div className="shrink-0 w-12">
        <p style={{ fontSize: 18, fontWeight: 700, color: isHoliday ? 'var(--danger)' : 'var(--ink-1)', lineHeight: 1, margin: 0 }}>
          {String(day.getDate()).padStart(2, '0')}
        </p>
        <p style={{ fontSize: 11, color: weekend ? 'var(--warn)' : 'var(--ink-5)', fontWeight: weekend ? 600 : 400 }}>
          {fmtDay(day)}
        </p>
        {flag && (
          <p style={{ fontSize: 9, fontWeight: 600, color: flagInk(flag.color), marginTop: 2 }}>{flag.label}</p>
        )}
      </div>
      <div className="flex flex-col gap-0.5 flex-1 pt-0.5">
        {isHoliday && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--danger)' }}>{holidayName || 'Holiday'}</span>}
        {/* Non-call attendings — plain text */}
        {nonCallAtts.map((a, i) => {
          const text = [a.attendingName, a.activityLabel].filter(Boolean).join(' - ');
          return text ? <span key={i} style={{ fontSize: 11, color: 'var(--ink-3)' }}>{text}</span> : null;
        })}
        {/* Call attendings — navy bold */}
        {callAtts.map((a, i) => (
          <span key={`c${i}`} style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-1)' }}>{a.attendingName}</span>
        ))}
        {/* Resident chips */}
        <div className="flex flex-wrap gap-1 mt-0.5">
          {assignment?.senior && <Chip label={`S: ${assignment.senior}`} color="var(--success-ink)" bg="var(--success-soft)" />}
          {assignment?.junior && <Chip label={`J: ${assignment.junior}`} color="var(--warn-ink)" bg="var(--warn-soft)" />}
        </div>
        {!hasContent && <span style={{ fontSize: 11, color: 'var(--ink-5)', fontStyle: 'italic' }}>Unassigned</span>}
      </div>
    </button>
  );
}

// â”€â”€ AttendingSection (inside modal) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const BLANK_FORM = { attendingName: '', activityLabel: '', isCallDay: false };

const miniInput = {
  width: '100%', padding: '6px 10px', borderRadius: 7,
  border: '1px solid var(--border-strong)', fontSize: 12, color: 'var(--ink-1)',
  background: 'var(--surface-1)', outline: 'none', boxSizing: 'border-box',
};

const modalSelectClass = 'w-full px-3 py-2 rounded-lg border border-hairline-strong bg-surface-1 text-sm text-ink-1 focus:outline-none focus:ring-2 focus:ring-accent';

function AttendingSection({ day, blockId, roster, initialEntries, onChange }) {
  const [entries, setEntries] = useState(initialEntries ?? []);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId]   = useState(null);
  const [form, setForm]       = useState(BLANK_FORM);
  const [saving, setSaving]   = useState(false);

  const iso = toISODate(day);

  useEffect(() => {
    setEntries(initialEntries ?? []);
    setShowForm(false);
    setEditId(null);
    setForm(BLANK_FORM);
  }, [iso, initialEntries]);

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
    <div style={{ borderBottom: '1px solid var(--border-1)', padding: '14px 20px 14px' }}>
      <div className="flex items-center justify-between mb-2">
        <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Attending
        </p>
        {!showForm && (
          <button onClick={openAdd} style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            + Add
          </button>
        )}
      </div>

      {entries.length === 0 && !showForm && (
        <p style={{ fontSize: 12, color: 'var(--ink-5)', fontStyle: 'italic' }}>No attending assigned</p>
      )}
      <div className="space-y-1">
        {entries.map(e => (
          <div key={e.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-1)' }}>
            <div className="flex flex-wrap gap-1 flex-1">
              {e.attendingName && <Chip label={e.attendingName} color="var(--info-strong)" bg="var(--info-soft)" />}
              {e.activityLabel && <Chip label={e.activityLabel} color="var(--violet-ink)" bg="var(--violet-soft)" />}
              {e.isCallDay && <Chip label="Call" color="var(--ink-1)" bg="var(--accent-soft)" />}
            </div>
            <button onClick={() => openEdit(e)} title="Edit"
              style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', padding: '2px 4px', borderRadius: 4, lineHeight: 1 }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-soft-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>Edit</button>
            <button onClick={() => handleDelete(e.id)} title="Delete"
              style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '2px 4px', borderRadius: 4, lineHeight: 1 }}
              onMouseEnter={ev => ev.currentTarget.style.background = 'var(--danger-soft)'}
              onMouseLeave={ev => ev.currentTarget.style.background = 'none'}>Delete</button>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="mt-2 space-y-2 p-3 rounded-lg" style={{ background: 'var(--accent-soft-2)', border: '1px solid var(--accent-border)' }}>
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
              <option value="">Select attending</option>
              {roster.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
            </select>
          ) : (
            <input value={form.attendingName} onChange={e => setForm(p => ({ ...p, attendingName: e.target.value }))}
              aria-label="Attending name" placeholder="Attending name" style={miniInput} />
          )}

          {(() => {
            const matched = roster.find(r => r.name === form.attendingName);
            const acts    = matched?.activities ?? [];
            return acts.length > 0 ? (
              <select
                className={modalSelectClass}
                value={form.activityLabel}
                onChange={e => setForm(p => ({ ...p, activityLabel: e.target.value }))}>
                <option value="">Select activity</option>
                {acts.map(a => <option key={a} value={a}>{a}</option>)}
                {form.activityLabel && !acts.includes(form.activityLabel) && (
                  <option value={form.activityLabel}>{form.activityLabel}</option>
                )}
              </select>
            ) : (
              <input value={form.activityLabel} onChange={e => setForm(p => ({ ...p, activityLabel: e.target.value }))}
                aria-label="Activity label" placeholder="Activity label (e.g. General Medicine)" style={miniInput} />
            );
          })()}
          <label className="flex items-center gap-2" style={{ fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.isCallDay} onChange={e => setForm(p => ({ ...p, isCallDay: e.target.checked }))} />
            Mark as call day
          </label>
          <div className="flex gap-2">
            <button onClick={cancelForm}
              style={{ flex: 1, padding: '6px', borderRadius: 6, border: '1px solid var(--border-1)', background: 'var(--surface-1)', color: 'var(--ink-4)', fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{ flex: 1, padding: '6px', borderRadius: 6, border: 'none', background: 'var(--brand)', color: 'var(--ink-inverse)', fontSize: 12, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? '...' : editId ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// â”€â”€ FlagSection (inside modal) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function FlagSection({ day, blockId, flag, onFlagChange }) {
  const iso = toISODate(day);
  const [label, setLabel] = useState(flag?.label ?? '');
  const [color, setColor] = useState(flag?.color ?? FLAG_PRESETS[0].color);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLabel(flag?.label ?? '');
    setColor(flag?.color ?? FLAG_PRESETS[0].color);
  }, [flag?.id, flag?.label, flag?.color, iso]);

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
    <div style={{ borderTop: '1px solid var(--border-1)', padding: '14px 20px' }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        Flag this day
      </p>
      <input
        value={label}
        onChange={e => setLabel(e.target.value)}
        aria-label="Day flag label"
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
          <span style={{ fontSize: 11, fontWeight: 600, color }}>- {label.trim()}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {flag?.id && (
          <button
            onClick={handleRemoveFlag}
            disabled={saving}
            style={{ flex: 1, padding: '6px', borderRadius: 6, border: '1px solid var(--danger-border)', background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 12, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            Remove
          </button>
        )}
        <button
          onClick={handleSaveFlag}
          disabled={saving || !label.trim()}
          style={{ flex: 1, padding: '6px', borderRadius: 6, border: 'none', background: color, color: onFlagColor(color), fontSize: 12, fontWeight: 600, cursor: (saving || !label.trim()) ? 'not-allowed' : 'pointer', opacity: (saving || !label.trim()) ? 0.5 : 1 }}
        >
          {saving ? '...' : 'Save flag'}
        </button>
      </div>
    </div>
  );
}

// â”€â”€ DayModal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function DayModal({ isOpen, day, attendings, residents, roster, assignment, blockId, flag, onSave, onClose, onAttendingChange, onFlagChange, saving }) {
  const [visible, setVisible] = useState(false);
  const [seniorId, setSeniorId] = useState('');
  const [juniorId, setJuniorId] = useState('');
  // The day sheet keeps its own mobile slide-up chrome, so it borrows the
  // dialog behaviour rather than the shared shell. Focus waits for `visible`
  // because the backdrop is visibility:hidden until then, and a hidden element
  // cannot take focus.
  const { panelRef, handleKeyDown } = useDialogA11y(onClose, { active: isOpen && visible });
  const headingId = 'day-modal-title';

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => setVisible(true), 8);
      return () => clearTimeout(t);
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setSeniorId(assignment?.seniorId ?? '');
    setJuniorId(assignment?.juniorId ?? '');
  }, [isOpen, day, assignment?.seniorId, assignment?.juniorId]);

  if (!day) {
    return (
      <div className={`modal-backdrop${visible ? ' open' : ''}`} style={{ background: 'var(--overlay)', backdropFilter: 'none', transition: 'opacity 120ms ease' }} onClick={onClose}>
        <div className={`w-full max-w-sm rounded-t-2xl md:rounded-2xl overflow-hidden modal-panel${visible ? ' open' : ''}`} />
      </div>
    );
  }

  const seniors = residents.filter(r => r.residentRole === 'senior' && !r.isMedStudent);
  const juniors = residents.filter(r => r.residentRole === 'junior' || r.isMedStudent);
  const assignedSeniorMissing = assignment?.seniorId && !seniors.some(r => r.id === assignment.seniorId);
  const assignedJuniorMissing = assignment?.juniorId && !juniors.some(r => r.id === assignment.juniorId);

  const dayKey = toISODate(day);
  const warning = seniorId && juniorId && seniorId === juniorId
    ? 'The same resident cannot be assigned as both senior and junior on the same call day.'
    : null;

  const handleSave = () => {
    if (warning || saving) return;
    const seniorName = residents.find(r => r.id === seniorId)?.name ?? '';
    const juniorName = residents.find(r => r.id === juniorId)?.name ?? '';
    onSave({ senior: seniorName, junior: juniorName, seniorId, juniorId });
  };

  return (
    <div
      className={`modal-backdrop${visible ? ' open' : ''}`}
      style={{ background: 'var(--overlay)', backdropFilter: 'none', transition: 'opacity 120ms ease' }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`w-full max-w-sm rounded-t-2xl md:rounded-2xl overflow-hidden modal-panel outline-none${visible ? ' open' : ''}`}
        style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border-1)', transition: 'opacity 120ms ease, transform 120ms ease' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border-1)' }}>
          <div>
            <h2 id={headingId} style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}>{fmtFull(day)}</h2>
          </div>
          <button onClick={onClose} aria-label="Close day editor" className="rounded-lg"
            style={{ color: 'var(--ink-5)', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 36, minHeight: 36 }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-soft-2)'}
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

        <div className="px-5 py-4 space-y-4">
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--ink-4)', marginBottom: 4 }}>Senior resident</label>
            <select key={`senior-${dayKey}`} name="seniorId" className={modalSelectClass} value={seniorId} onChange={event => setSeniorId(event.target.value)}>
              <option value="">Unassigned</option>
              {assignedSeniorMissing && (
                <option value={assignment.seniorId}>{assignment.senior ?? 'Assigned senior'}</option>
              )}
              {seniors.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--ink-4)', marginBottom: 4 }}>Junior resident</label>
            <select key={`junior-${dayKey}`} name="juniorId" className={modalSelectClass} value={juniorId} onChange={event => setJuniorId(event.target.value)}>
              <option value="">Unassigned</option>
              {assignedJuniorMissing && (
                <option value={assignment.juniorId}>{assignment.junior ?? 'Assigned junior'}</option>
              )}
              {juniors.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          {warning && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger-border)' }}>
              <span style={{ fontSize: 12, color: 'var(--danger)' }}>Warning: {warning}</span>
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
            style={{ border: '1px solid var(--border-1)', color: 'var(--ink-4)', background: 'var(--surface-2)', cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-soft-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-2)'}>Cancel</button>
          <button
            onClick={handleSave}
            disabled={Boolean(warning) || saving}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-on-solid"
            style={{ background: 'var(--brand)', cursor: warning || saving ? 'not-allowed' : 'pointer', opacity: warning || saving ? 0.6 : 1, border: 'none' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--accent)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--brand)'}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// â”€â”€ GenSummaryModal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function GenSummaryModal({ summary, onClose }) {
  return (
    <Modal
      title="Schedule Generated"
      description="Auto-generation complete"
      onClose={onClose}
      maxWidth="max-w-sm"
      closeLabel="Close generation summary"
      footer={(
        <button type="button" onClick={onClose}
          style={{ width: '100%', padding: '10px', borderRadius: 10, border: 'none', background: 'var(--brand)', color: 'var(--ink-inverse)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          View Schedule
        </button>
      )}
    >
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: 'Work Days',  value: summary.workDays,   color: 'var(--ink-1)' },
              { label: 'Assigned',   value: summary.assigned,   color: 'var(--success)' },
              { label: 'Unassigned', value: summary.unassigned, color: summary.unassigned > 0 ? 'var(--warn)' : 'var(--ink-5)' },
            ].map(s => (
              <div key={s.label} className="text-center p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
                <p style={{ fontSize: 24, fontWeight: 700, color: s.color, margin: 0 }}>{s.value}</p>
                <p style={{ fontSize: 11, color: 'var(--ink-5)', marginTop: 2 }}>{s.label}</p>
              </div>
            ))}
          </div>

          {summary.callSummary?.length > 0 && (
            <div className="mb-4">
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                Call Distribution
              </p>
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {summary.callSummary.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span style={{ fontSize: 12, color: 'var(--ink-1)', flex: 1 }}>{r.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-5)', textTransform: 'capitalize' }}>{r.role}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: r.calls >= 9 ? 'var(--danger)' : r.calls >= 7 ? 'var(--warn)' : 'var(--success)', minWidth: 20, textAlign: 'right' }}>
                      {r.calls}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {summary.unassignedDates?.length > 0 && (
            <div className="mb-4 px-3 py-2 rounded-lg" style={{ background: 'var(--warn-soft)', border: '1px solid var(--warn-border)' }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--warn)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>
                Unassigned Dates ({summary.unassignedDates.length})
              </p>
              <p style={{ fontSize: 11, color: 'var(--warn-ink-strong)', lineHeight: 1.5 }}>
                {summary.unassignedDates.slice(0, 12).join(', ')}
                {summary.unassignedDates.length > 12 ? `, +${summary.unassignedDates.length - 12} more` : ''}
              </p>
            </div>
          )}

          {summary.warnings?.length > 0 && (
            <div className="mb-4 max-h-32 overflow-y-auto">
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--warn)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                Warnings ({summary.warnings.length})
              </p>
              {summary.warnings.map((w, i) => (
                <p key={i} style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 3 }}>
                  Warning: {w.date ? `${w.date}: ` : ''}{w.message}
                </p>
              ))}
            </div>
          )}

    </Modal>
  );
}

// â”€â”€ PublishConfirmModal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ValidationModal({ result, onClose, onEditDate }) {
  const violations = result?.violations ?? [];
  const warnings = result?.warnings ?? [];
  const unfilled = result?.unfilledSlots ?? [];
  const documented = violations.filter(item => item.isOverride);
  const outstanding = violations.filter(item => !item.isOverride);

  const open = (dateKey) => { onEditDate?.(dateKey); onClose(); };

  return (
    <Modal
      title={result?.compliant ? 'Schedule is compliant' : 'Schedule needs attention'}
      description={
        `${outstanding.length} outstanding violation${outstanding.length === 1 ? '' : 's'}, ` +
        `${documented.length} documented override${documented.length === 1 ? '' : 's'}, ` +
        `${unfilled.length} unfilled slot${unfilled.length === 1 ? '' : 's'}`
      }
      onClose={onClose}
      maxWidth="max-w-2xl"
      closeLabel="Close validation results"
    >
      {violations.length === 0 && (
        <div className="rounded-xl px-4 py-3 mb-4" data-testid="validation-clean"
          style={{ background: 'var(--success-soft)', color: 'var(--success-ink)', border: '1px solid var(--success-border)', fontSize: 13 }}>
          No scheduling-rule violations were found in the stored draft.
        </div>
      )}

      {outstanding.length > 0 && (
        <section className="mb-4">
          <h4 style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger-ink-strong)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Needs a decision ({outstanding.length})
          </h4>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {outstanding.map((item, index) => (
              <ViolationCard key={`${item.code}-${item.residentId}-${item.date}-${index}`} item={item} onEditDate={open} />
            ))}
          </ul>
        </section>
      )}

      {documented.length > 0 && (
        <section className="mb-4">
          <h4 style={{ fontSize: 11, fontWeight: 700, color: 'var(--warn-ink)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Accepted exceptions ({documented.length})
          </h4>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {documented.map((item, index) => (
              <ViolationCard key={`override-${item.code}-${item.residentId}-${item.date}-${index}`} item={item} onEditDate={open} />
            ))}
          </ul>
        </section>
      )}

      {warnings.length > 0 && (
        <section className="mb-4">
          <h4 style={{ fontSize: 11, fontWeight: 700, color: 'var(--warn-ink-strong)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Warnings ({warnings.length})
          </h4>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {warnings.map((item, index) => (
              <ViolationCard key={`warning-${item.code}-${item.residentId}-${index}`} item={item} onEditDate={open} />
            ))}
          </ul>
        </section>
      )}

      {unfilled.length > 0 && (
        <details data-testid="unfilled-slots" open={unfilled.length <= 3}>
          <summary style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-1)', textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer', marginBottom: 8 }}>
            Unfilled slots ({unfilled.length})
          </summary>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {unfilled.map(slot => (
              <UnfilledSlotCard key={`${slot.date}-${slot.roleOnDay}`} slot={slot} onEditDate={open} />
            ))}
          </ul>
        </details>
      )}
    </Modal>
  );
}

function OverrideConfirmModal({ violations, onConfirm, onClose, saving }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      title="Rule violation requires an override"
      description="Review the violations and record why this exception is necessary."
      onClose={onClose}
      maxWidth="max-w-lg"
      closeLabel="Close override confirmation"
      footer={(
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 py-2.5 rounded-lg"
            style={{ border: '1px solid var(--border-strong)', background: 'var(--surface-1)', color: 'var(--ink-3)', cursor: 'pointer', fontWeight: 700 }}>
            Cancel
          </button>
          <button type="button" onClick={() => onConfirm(reason)} disabled={saving || !reason.trim()} className="flex-1 py-2.5 rounded-lg"
            style={{ border: 0, background: 'var(--danger-hover)', color: 'var(--ink-inverse)', cursor: saving || !reason.trim() ? 'not-allowed' : 'pointer', opacity: saving || !reason.trim() ? 0.6 : 1, fontWeight: 750 }}>
            {saving ? 'Saving override...' : 'Confirm override'}
          </button>
        </div>
      )}
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
        {violations.map((item, index) => (
          <ViolationCard key={`${item.code}-${index}`} item={item} />
        ))}
      </ul>
      <label htmlFor="override-reason" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--ink-1)', marginTop: 14 }}>
        Override reason
      </label>
      <textarea
        id="override-reason" value={reason} onChange={event => setReason(event.target.value)} rows={3}
        placeholder="Explain the clinical or operational reason for this exception"
        style={{ width: '100%', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '10px 12px', fontSize: 13, resize: 'vertical', marginTop: 6 }}
      />
    </Modal>
  );
}

function LinkControlModal({ mode, onConfirm, onClose, busy }) {
  const isUnpublish = mode === 'unpublish';
  return (
    <Modal
      title={isUnpublish ? 'Unpublish this schedule?' : 'Generate a new public link?'}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={(
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" onClick={onClose} disabled={busy}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--surface-1)', color: 'var(--ink-4)', border: '1px solid var(--border-2)', cursor: busy ? 'not-allowed' : 'pointer' }}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            data-testid={isUnpublish ? 'confirm-unpublish' : 'confirm-rotate'}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-on-solid"
            style={{ background: 'var(--danger-hover)', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Working...' : (isUnpublish ? 'Unpublish' : 'Generate new link')}
          </button>
        </div>
      )}
    >
      {isUnpublish ? (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
          <p>The public link will stop working immediately, and anyone holding it will see an unavailable page.</p>
          <p style={{ marginTop: 8 }}>Your draft schedule is not changed, and the published version history is kept. You can publish again at any time.</p>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
          <p>A new link is created and the current one stops working immediately. Anyone who already has the old link will lose access.</p>
          <p style={{ marginTop: 8 }}>The published schedule itself does not change. You will need to share the new link with everyone who needs it.</p>
        </div>
      )}
    </Modal>
  );
}

function PublishConfirmModal({ onConfirm, onClose, publishing }) {
  return (
    <Modal
      title="Publish Schedule"
      onClose={onClose}
      maxWidth="max-w-sm"
      closeLabel="Close publish confirmation"
      footer={(
        <div className="flex gap-3">
          <button type="button" onClick={onClose} disabled={publishing}
            style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--border-1)', background: 'var(--surface-1)', color: 'var(--ink-4)', fontSize: 13, fontWeight: 500, cursor: publishing ? 'not-allowed' : 'pointer' }}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={publishing}
            style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: 'var(--success)', color: 'var(--ink-inverse)', fontSize: 13, fontWeight: 600, cursor: publishing ? 'not-allowed' : 'pointer', opacity: publishing ? 0.7 : 1 }}>
            {publishing ? 'Publishing...' : 'Publish'}
          </button>
        </div>
      )}
    >
      <p style={{ fontSize: 13, color: 'var(--ink-4)', lineHeight: 1.5 }}>
        This will make the schedule publicly viewable via a shareable link. Residents will be able to see their
        assignments without logging in.
      </p>
    </Modal>
  );
}

// â”€â”€ ClearConfirmModal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ClearConfirmModal({ blockNum, onConfirm, onClose, clearing }) {
  return (
    <Modal
      title="Clear schedule"
      onClose={onClose}
      maxWidth="max-w-sm"
      closeLabel="Close clear confirmation"
      footer={(
        <div className="flex gap-3">
          <button type="button" onClick={onClose} disabled={clearing}
            style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--border-1)', background: 'var(--surface-1)', color: 'var(--ink-4)', fontSize: 13, fontWeight: 500, cursor: clearing ? 'not-allowed' : 'pointer' }}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={clearing}
            style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: 'var(--danger)', color: 'var(--ink-inverse)', fontSize: 13, fontWeight: 600, cursor: clearing ? 'not-allowed' : 'pointer', opacity: clearing ? 0.7 : 1 }}>
            {clearing ? 'Clearing...' : 'Clear all assignments'}
          </button>
        </div>
      )}
    >
      <p style={{ fontSize: 13, color: 'var(--ink-4)', lineHeight: 1.5 }}>
        This will remove all resident call assignments for Block {blockNum}. Attending entries will not be
        affected. This cannot be undone.
      </p>
    </Modal>
  );
}

// â”€â”€ PublishSuccessModal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function PublishSuccessModal({ publicUrl, publishedAt, versionId, onClose }) {
  const [copied, setCopied] = useState(false);
  const publishedLabel = publishedAt
    ? new Date(publishedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  const handleCopy = () => {
    navigator.clipboard.writeText(publicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Modal
      title="Schedule published!"
      description="Share this read-only public link with your team."
      onClose={onClose}
      maxWidth="max-w-md"
      closeLabel="Close publish confirmation"
      footer={(
        <div className="flex gap-3">
          <button type="button" onClick={() => window.open(publicUrl, '_blank')}
            style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--accent-border-2)', background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            View published version
          </button>
          <button type="button" onClick={onClose}
            style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: 'var(--brand)', color: 'var(--ink-inverse)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Done
          </button>
        </div>
      )}
    >

          {(publishedLabel || versionId) && (
            <div className="rounded-lg px-3 py-2 mb-4" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-1)' }}>
              {publishedLabel && <p style={{ fontSize: 12, color: 'var(--ink-1)', margin: 0 }}>Published {publishedLabel}</p>}
              {versionId && <p style={{ fontSize: 11, color: 'var(--ink-5)', marginTop: 2 }}>Version {versionId.slice(0, 8)}</p>}
            </div>
          )}

          <label htmlFor="published-public-link" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 6 }}>
            Public link
          </label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              id="published-public-link"
              readOnly
              value={publicUrl}
              style={{
                flex: 1, padding: '9px 12px', borderRadius: 8,
                border: '1px solid var(--border-strong)', fontSize: 12, color: 'var(--accent)',
                background: 'var(--accent-soft-2)', fontFamily: 'monospace', outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={handleCopy}
              style={{
                padding: '9px 16px', borderRadius: 8,
                border: '1px solid var(--accent-border-2)', background: copied ? 'var(--success-soft-2)' : 'var(--accent-soft)',
                color: copied ? 'var(--success-ink)' : 'var(--accent)', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
    </Modal>
  );
}

// â”€â”€ CalendarTopBar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function Spinner() {
  return <div className="w-3.5 h-3.5 rounded-full border-2 animate-spin inline-block"
    style={{ borderColor: 'var(--on-brand-track)', borderTopColor: 'var(--on-brand)' }} />;
}

function BlockSettingsSummary({ settings, blockNum, loading }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-1)' }}>Block rules</p>
          <p style={{ fontSize: 11, color: 'var(--ink-5)' }}>{loading ? 'Loading...' : 'PARO rules plus local settings'}</p>
        </div>
        {!loading && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Resident cap: {settings.maxCallsPerResident > 0 ? settings.maxCallsPerResident : 'PARO only'}</span>}
        {!loading && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Med-student cap: {settings.maxCallsMedStudent}</span>}
        {!loading && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{settings.avoidAcademicDays ? 'Avoid academic days' : 'Academic days allowed'}</span>}
      </div>
      <Link to={`/blocks/${blockNum}/settings`} style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>Edit settings</Link>
    </div>
  );
}

const CalendarTopBar = memo(function CalendarTopBar({
  blockNum, blockStart, blockEnd, days, assignmentMap,
  onAutoGenerate, generating,
  onClearSchedule, clearingSchedule,
  onPublish, publishPulsing,
  isPublished, publicToken,
  publicUrl,
  onCopyLink,
  onUnpublish,
  onRotateLink,
  onExportExcel, exportingExcel,
  onPrintPdf, printingPdf,
  onViewPublished,
  onValidate, validating,
  blockId,
  canExportDraft,
  canClearSchedule,
  canGenerateSchedule,
  canPublishSchedule,
  canValidateSchedule,
}) {
  const assigned   = days.filter(d => { const a = assignmentMap[toISODate(d)]; return a?.seniorId || a?.juniorId; }).length;
  const unassigned = days.length - assigned;
  const warnings   = days.filter(d => assignmentMap[toISODate(d)]?.warning).length;

  const fmtRange = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  const stat = (label, value, color) => (
    <div className="flex flex-col items-center">
      <motion.span key={value} initial={{ scale: 1.2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1 }}>{value}</motion.span>
      <span style={{ fontSize: 11, color: 'var(--ink-5)', marginTop: 2 }}>{label}</span>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
      className="rounded-xl mb-4 overflow-hidden"
      style={{ border: '1px solid var(--border-1)', background: 'var(--surface-1)', boxShadow: 'var(--shadow-xs)' }}>
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4" style={{ borderBottom: '1px solid var(--border-1)' }}>
        <div className="flex items-center gap-3">
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-1)' }}>Block {blockNum} Calendar</h1>
            {blockStart && blockEnd && (
              <p style={{ fontSize: 12, color: 'var(--ink-5)', marginTop: 2 }}>
                {fmtRange(blockStart)} - {fmtRange(blockEnd)}
              </p>
            )}
          </div>
          {/* Published / Draft badge */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
            background: isPublished ? 'var(--success-soft-2)' : 'var(--surface-3)',
            color: isPublished ? 'var(--success-ink)' : 'var(--ink-5)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: isPublished ? 'var(--success)' : 'var(--border-strong)', display: 'inline-block' }} />
            {isPublished ? 'Published' : 'Draft'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
            onClick={onValidate}
            disabled={validating || !canValidateSchedule}
            className="px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5"
            style={{ background: 'var(--orange-soft)', color: 'var(--orange-ink)', border: '1px solid var(--orange-border)', cursor: validating ? 'not-allowed' : 'pointer' }}>
            {validating ? 'Validating...' : 'Validate schedule'}
          </motion.button>
          {/* Export Excel */}
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
            onClick={onExportExcel}
            disabled={exportingExcel || !blockId || !canExportDraft}
            className="px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5"
            style={{ background: 'var(--success-soft)', color: 'var(--success-ink)', border: '1px solid var(--success-border)', cursor: exportingExcel ? 'not-allowed' : 'pointer' }}
            onMouseEnter={e => { if (!exportingExcel) e.currentTarget.style.background = 'var(--success-soft-2)'; }}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--success-soft)'}>
            {exportingExcel ? <Spinner /> : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            )}
            Excel
          </motion.button>

          {/* Printable PDF */}
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
            onClick={onPrintPdf}
            disabled={printingPdf || !blockId || !canExportDraft}
            className="px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-border-2)', cursor: printingPdf ? 'not-allowed' : 'pointer' }}
            onMouseEnter={e => { if (!printingPdf) e.currentTarget.style.background = 'var(--border-3)'; }}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--accent-soft)'}>
            {printingPdf ? <Spinner /> : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
              </svg>
            )}
            Print / PDF
          </motion.button>

          {/* View published (only when published) */}
          {isPublished && publicToken && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
              onClick={onViewPublished}
              className="px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5"
              style={{ background: 'var(--success-soft)', color: 'var(--success-ink)', border: '1px solid var(--success-border)', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--success-soft-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--success-soft)'}>
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
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-border-2)', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--border-3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--accent-soft)'}>
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
            disabled={clearingSchedule || !canClearSchedule}
            className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
            style={{ background: 'var(--surface-1)', color: 'var(--danger)', border: '1px solid var(--danger-border)', cursor: clearingSchedule ? 'not-allowed' : 'pointer' }}
            onMouseEnter={e => { if (!clearingSchedule) { e.currentTarget.style.background = 'var(--danger-soft)'; e.currentTarget.style.borderColor = 'var(--danger)'; } }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-1)'; e.currentTarget.style.borderColor = 'var(--danger-border)'; }}>
            {clearingSchedule ? <><Spinner /><span style={{ color: 'var(--danger)' }}>Clearing...</span></> : 'Clear schedule'}
          </motion.button>

          {/* Auto-generate */}
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
            onClick={onAutoGenerate}
            disabled={generating || !canGenerateSchedule}
            className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-border-2)', cursor: generating ? 'not-allowed' : 'pointer' }}
            onMouseEnter={e => { if (!generating) e.currentTarget.style.background = 'var(--border-3)'; }}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--accent-soft)'}>
            {generating ? <><Spinner /><span style={{ color: 'var(--accent)' }}>Generating...</span></> : 'Auto-generate'}
          </motion.button>

          {/* Publish */}
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.95 }}
            animate={publishPulsing ? { boxShadow: ['0 0 0 0 var(--success-glow-0)', '0 0 0 8px var(--success-glow-1)', '0 0 0 0 var(--success-glow-0)'] } : {}}
            transition={publishPulsing ? { duration: 0.6, repeat: 2 } : {}}
            onClick={onPublish}
            disabled={!canPublishSchedule}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-on-solid"
            style={{ background: isPublished ? 'var(--success)' : 'var(--brand)', cursor: 'pointer', border: 'none' }}
            onMouseEnter={e => e.currentTarget.style.background = isPublished ? 'var(--success-hover)' : 'var(--accent)'}
            onMouseLeave={e => e.currentTarget.style.background = isPublished ? 'var(--success)' : 'var(--brand)'}>
            {isPublished ? 'Re-publish' : 'Publish'}
          </motion.button>
        </div>
      </div>
      {isPublished && publicToken && (
        <div className="flex flex-wrap items-center gap-3 px-5 py-3" style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border-1)' }}>
          <label htmlFor="calendar-public-link" style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>Public link</label>
          <input
            id="calendar-public-link"
            readOnly
            value={publicUrl}
            className="min-w-0 flex-1"
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--border-strong)',
              background: 'var(--surface-1)',
              color: 'var(--ink-1)',
              fontSize: 12,
              fontFamily: 'monospace',
              outline: 'none',
            }}
            onFocus={event => event.currentTarget.select()}
          />
          <button
            onClick={onCopyLink}
            className="px-3 py-2 rounded-lg text-sm font-semibold"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-border-2)', cursor: 'pointer' }}
            onMouseEnter={event => { event.currentTarget.style.background = 'var(--border-3)'; }}
            onMouseLeave={event => { event.currentTarget.style.background = 'var(--accent-soft)'; }}
          >
            Copy public link
          </button>
          {canPublishSchedule && (
            <>
              <button
                onClick={onRotateLink}
                data-testid="rotate-public-link"
                className="px-3 py-2 rounded-lg text-sm font-semibold"
                style={{ background: 'var(--surface-1)', color: 'var(--warn-ink)', border: '1px solid var(--warn-border)', cursor: 'pointer' }}
                onMouseEnter={event => { event.currentTarget.style.background = 'var(--warn-soft)'; }}
                onMouseLeave={event => { event.currentTarget.style.background = 'var(--surface-1)'; }}
              >
                New link
              </button>
              <button
                onClick={onUnpublish}
                data-testid="unpublish-schedule"
                className="px-3 py-2 rounded-lg text-sm font-semibold"
                style={{ background: 'var(--surface-1)', color: 'var(--danger)', border: '1px solid var(--danger-border)', cursor: 'pointer' }}
                onMouseEnter={event => { event.currentTarget.style.background = 'var(--danger-soft)'; }}
                onMouseLeave={event => { event.currentTarget.style.background = 'var(--surface-1)'; }}
              >
                Unpublish
              </button>
            </>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-6 px-6 py-3">
        {stat('Total days', days.length, 'var(--ink-1)')}
        {stat('Assigned', assigned, 'var(--success)')}
        {stat('Unassigned', unassigned, 'var(--warn)')}
        {stat('Warnings', warnings, 'var(--danger)')}
      </div>
    </motion.div>
  );
});

// â”€â”€ main page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function Calendar() {
  const { blockNumber } = useParams();
  const { currentProgram, refreshContext, can } = useUser();
  const { currentBlock, setCurrentBlock, currentAcademicYear } = useBlock();

  const blockNum  = parseInt(blockNumber ?? '1', 10);
  const programId = currentProgram?.programId ?? null;
  const routeBlock = blockNumber && currentAcademicYear?.blocks
    ? currentAcademicYear.blocks.find(b => b.number === blockNum)
    : null;
  const shownBlock = routeBlock ?? currentBlock;

  // Sync currentBlock from context when navigating directly to a block URL
  useEffect(() => {
    if (routeBlock && routeBlock.id !== currentBlock?.id) {
      setCurrentBlock(routeBlock);
    }
  }, [routeBlock, currentBlock?.id, setCurrentBlock]);

  const blockId = shownBlock?.id ?? null;

  const days = useMemo(() => {
    if (shownBlock?.startDate && shownBlock?.endDate) {
      return getDaysFromDateKeys(shownBlock.startDate, shownBlock.endDate);
    }
    return getDaysInBlock(blockNum);
  }, [shownBlock, blockNum]);

  const [attendingEntries, setAttendingEntries] = useState([]);
  const [assignmentsMap, setAssignmentsMap]     = useState({});
  const [residents, setResidents]               = useState([]);
  const [roster, setRoster]                     = useState([]);
  const [flags, setFlags]                       = useState([]);
  const [holidays, setHolidays]                 = useState([]);
  const [selectedDateKey, setSelectedDateKey]   = useState(null);
  const [loadingData, setLoadingData]           = useState(false);
  const [generating, setGenerating]             = useState(false);
  const [readiness, setReadiness]               = useState(null);
  const [genSummary, setGenSummary]             = useState(null);
  const [publishPulsing, setPublishPulsing]     = useState(false);
  const [showPublishModal, setShowPublishModal]     = useState(false);
  const [showPublishSuccess, setShowPublishSuccess] = useState(false);
  const [publishResult, setPublishResult]           = useState(null);
  const [publishing, setPublishing]                 = useState(false);
  const [publishBlockedBy, setPublishBlockedBy]     = useState(null);
  const [linkControlMode, setLinkControlMode]       = useState(null);
  const [linkControlBusy, setLinkControlBusy]       = useState(false);
  const [exportingExcel, setExportingExcel]         = useState(false);
  const [printingPdf, setPrintingPdf]               = useState(false);
  const [showClearModal, setShowClearModal]         = useState(false);
  const [clearing, setClearing]                     = useState(false);
  const [blockSettings, setBlockSettings]           = useState(DEFAULT_BLOCK_SETTINGS);
  const [settingsLoading, setSettingsLoading]       = useState(false);
  const [assignmentSaving, setAssignmentSaving]     = useState(false);
  const [validating, setValidating]                 = useState(false);
  const [validationResult, setValidationResult]     = useState(null);
  const [pendingOverride, setPendingOverride]       = useState(null);
  const [overrideSaving, setOverrideSaving]         = useState(false);
  const latestBlockIdRef = useRef(blockId);
  const canEditResidents = can('edit_residents');
  const canEditAttending = can('edit_attendings');
  const canEditSchedule = can('manual_assign_calls') || canEditAttending;
  const canGenerate = can('generate_schedule');

  useEffect(() => {
    latestBlockIdRef.current = blockId;
  }, [blockId]);

  useEffect(() => {
    if (!blockId || !can('edit_block_settings')) return;
    const currentBlockId = blockId;
    let cancelled = false;

    async function fetchSettings() {
      setSettingsLoading(true);
      try {
        const { data } = await api.get(`/blocks/${currentBlockId}/settings`);
        if (cancelled || latestBlockIdRef.current !== currentBlockId) return;
        setBlockSettings({ ...DEFAULT_BLOCK_SETTINGS, ...data });
      } catch (err) {
        if (!cancelled) toast.error(err.response?.data?.error ?? 'Failed to load block settings');
      } finally {
        if (!cancelled && latestBlockIdRef.current === currentBlockId) setSettingsLoading(false);
      }
    }

    fetchSettings();
    return () => { cancelled = true; };
  }, [blockId, can]);

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
        const [att, asgn, res, ros, fl, hol, ready] = await Promise.all([
          api.get(`/attending?blockId=${currentBlockId}`, { signal }),
          api.get(`/assignments?blockId=${currentBlockId}`, { signal }),
          programId && canEditResidents ? api.get(`/residents?programId=${programId}&blockId=${currentBlockId}`, { signal }) : Promise.resolve({ data: [] }),
          programId && canEditAttending ? api.get(`/attending/roster?programId=${programId}`, { signal }) : Promise.resolve({ data: [] }),
          api.get(`/flags?blockId=${currentBlockId}`, { signal }),
          api.get(`/blocks/${currentBlockId}/holidays`, { signal }),
          canGenerate
            ? api.get(`/blocks/${currentBlockId}/readiness`, { signal }).catch(() => ({ data: null }))
            : Promise.resolve({ data: null }),
        ]);

        if (cancelled || latestBlockIdRef.current !== currentBlockId) return;
        setAttendingEntries(att.data);
        setAssignmentsMap(buildAssignmentsMap(asgn.data));
        setResidents(res.data.filter(resident => resident.isEnrolledThisBlock).map(resident => ({ ...resident, name: resident.displayName || resident.name })));
        setRoster(ros.data.map(r => ({ id: r.id, name: r.attendingName, activities: r.typicalActivities })));
        setFlags(fl.data);
        setHolidays(hol.data);
        setReadiness(ready.data);
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
  }, [blockId, canEditAttending, canEditResidents, canGenerate, programId]);

  const attendingMap = useMemo(() => {
    const map = {};
    attendingEntries.forEach(e => {
      const iso = normalizeDateKey(e.date);
      if (!map[iso]) map[iso] = [];
      map[iso].push(e);
    });
    return map;
  }, [attendingEntries]);

  const flagsMap = useMemo(() => {
    const map = {};
    flags.forEach(f => { map[normalizeDateKey(f.date)] = f; });
    return map;
  }, [flags]);

  const holidaysMap = useMemo(() => {
    const map = {};
    holidays.forEach(holiday => { map[normalizeDateKey(holiday.date)] = holiday; });
    return map;
  }, [holidays]);

  const dayDataMap = useMemo(() => {
    const map = {};
    days.forEach(day => {
      const dateKey = normalizeDateKey(day);
      map[dateKey] = {
        dateKey,
        day,
        attendings: attendingMap[dateKey] ?? [],
        assignment: assignmentsMap[dateKey] ?? null,
        flag: flagsMap[dateKey] ?? null,
        isHoliday: Boolean(holidaysMap[dateKey]),
        holidayName: holidaysMap[dateKey]?.name ?? null,
      };
    });
    return map;
  }, [assignmentsMap, attendingMap, days, flagsMap, holidaysMap]);

  const dayDataList = useMemo(
    () => days.map(day => dayDataMap[normalizeDateKey(day)]),
    [dayDataMap, days]
  );

  const handleDayClick = useCallback((dayData) => {
    if (!canEditSchedule) return;
    setSelectedDateKey(dayData.dateKey);
  }, [canEditSchedule]);

  const closeDayModal = useCallback(() => {
    setSelectedDateKey(null);
  }, []);

  const handleAttendingChange = useCallback((iso, updatedEntries) => {
    setAttendingEntries(prev => [
      ...prev.filter(e => normalizeDateKey(e.date) !== iso),
      ...updatedEntries,
    ]);
  }, []);

  const handleFlagChange = useCallback((iso, flagOrNull) => {
    setFlags(prev => {
      const without = prev.filter(f => normalizeDateKey(f.date) !== iso);
      return flagOrNull ? [...without, flagOrNull] : without;
    });
  }, []);

  const handleSaveAssignment = useCallback(async ({ seniorId, juniorId, senior, junior }) => {
    if (!selectedDateKey) return;
    if (seniorId && juniorId && seniorId === juniorId) {
      toast.error('The same resident cannot be assigned as both senior and junior on the same call day.');
      return;
    }
    const iso      = selectedDateKey;
    setAssignmentSaving(true);
    try {
      const dayEntries       = attendingMap[iso] ?? [];
      const attendingEntryId = (dayEntries.find(e => e.isCallDay) ?? dayEntries[0])?.id ?? null;
      const payload = {
        blockId,
        date: iso,
        seniorId: seniorId || null,
        juniorId: juniorId || null,
        attendingEntryId,
      };
      const { data } = await api.put('/assignments/day', payload);
      const seniorAssignment = data.assignments.find(item => item.roleOnDay === 'senior');
      const juniorAssignment = data.assignments.find(item => item.roleOnDay === 'junior');

      setAssignmentsMap(prev => ({
        ...prev,
        [iso]: {
          callDayId: data.callDay.id,
          seniorId: seniorId || undefined, senior: senior || undefined, seniorAssignmentId: seniorAssignment?.id,
          juniorId: juniorId || undefined, junior: junior || undefined, juniorAssignmentId: juniorAssignment?.id,
        },
      }));
      setSelectedDateKey(null);
      toast.success(`${fmtShort(dateFromDateKey(iso))} saved`);
    } catch (err) {
      if (err.response?.data?.requiresOverrideConfirmation) {
        setPendingOverride({
          payload: {
            blockId,
            date: iso,
            seniorId: seniorId || null,
            juniorId: juniorId || null,
            attendingEntryId: (attendingMap[iso] ?? []).find(entry => entry.isCallDay)?.id
              ?? (attendingMap[iso] ?? [])[0]?.id
              ?? null,
          },
          display: { seniorId, juniorId, senior, junior },
          violations: err.response.data.violations ?? [],
        });
        return;
      }
      toast.error(err.response?.data?.error ?? 'Failed to save assignment');
    } finally {
      setAssignmentSaving(false);
    }
  }, [attendingMap, blockId, selectedDateKey]);

  const handleConfirmOverride = useCallback(async (reason) => {
    if (!pendingOverride || !reason.trim()) return;
    setOverrideSaving(true);
    try {
      const { data } = await api.put('/assignments/day', {
        ...pendingOverride.payload,
        confirmOverride: true,
        overrideReason: reason.trim(),
      });
      const seniorAssignment = data.assignments.find(item => item.roleOnDay === 'senior');
      const juniorAssignment = data.assignments.find(item => item.roleOnDay === 'junior');
      const iso = pendingOverride.payload.date;
      setAssignmentsMap(prev => ({
        ...prev,
        [iso]: {
          callDayId: data.callDay.id,
          seniorId: pendingOverride.display.seniorId || undefined,
          senior: pendingOverride.display.senior || undefined,
          seniorAssignmentId: seniorAssignment?.id,
          juniorId: pendingOverride.display.juniorId || undefined,
          junior: pendingOverride.display.junior || undefined,
          juniorAssignmentId: juniorAssignment?.id,
          warning: true,
        },
      }));
      setPendingOverride(null);
      setSelectedDateKey(null);
      toast.success('Manual override saved with reason');
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Failed to save override');
    } finally {
      setOverrideSaving(false);
    }
  }, [pendingOverride]);

  const handleValidateSchedule = useCallback(async () => {
    if (!blockId) return;
    setValidating(true);
    try {
      const { data } = await api.get(`/schedule/validate?blockId=${blockId}`);
      setValidationResult(data);
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Failed to validate schedule');
    } finally {
      setValidating(false);
    }
  }, [blockId]);

  const handleAutoGenerate = useCallback(async () => {
    if (!blockId) { toast.error('No block selected'); return; }
    const currentBlockId = blockId;
    setGenerating(true);
    try {
      const { data: summary } = await api.post('/schedule/generate', { blockId: currentBlockId });
      const { data: asgn } = await api.get(`/assignments?blockId=${currentBlockId}`);
      if (latestBlockIdRef.current !== currentBlockId) return;
      setAssignmentsMap(buildAssignmentsMap(asgn));
      setGenSummary(summary);
      const warningText = summary.warnings?.length ? ` (${summary.warnings.length} warning${summary.warnings.length === 1 ? '' : 's'})` : '';
      toast.success(`Schedule generated${warningText}!`);
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Failed to generate schedule');
    } finally {
      if (latestBlockIdRef.current === currentBlockId) setGenerating(false);
    }
  }, [blockId]);

  const handleClearSchedule = useCallback(async () => {
    if (!blockId) return;
    const currentBlockId = blockId;
    setClearing(true);
    try {
      await api.delete('/schedule/clear', { data: { blockId: currentBlockId } });
      const { data: asgn } = await api.get(`/assignments?blockId=${currentBlockId}`);
      if (latestBlockIdRef.current !== currentBlockId) return;
      setAssignmentsMap(buildAssignmentsMap(asgn));
      setGenSummary(null);
      setShowClearModal(false);
      toast.success('Schedule cleared successfully');
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Failed to clear schedule');
    } finally {
      if (latestBlockIdRef.current === currentBlockId) setClearing(false);
    }
  }, [blockId]);

  const handlePublish = useCallback(() => {
    if (!blockId) return;
    setShowPublishModal(true);
  }, [blockId]);

  const handleConfirmPublish = useCallback(async (acknowledgeViolations = false) => {
    setPublishing(true);
    try {
      const { data } = await api.post('/schedule/publish', { blockId, acknowledgeViolations });
      // Refresh context so isPublished + publicToken persist in AppContext
      await refreshContext();
      // Update currentBlock to the refreshed version with new publicToken
      setCurrentBlock(prev => prev ? { ...prev, isPublished: true, publicToken: data.publicToken } : prev);
      setPublishResult(data);
      setPublishPulsing(true);
      setTimeout(() => setPublishPulsing(false), 1200);
      setShowPublishModal(false);
      setShowPublishSuccess(true);
      setPublishBlockedBy(null);
      const publishedLabel = data.publishedAt ? new Date(data.publishedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'now';
      toast.success(`Schedule published ${publishedLabel}`);
    } catch (err) {
      // The server refuses to publish an unreviewed non-compliant schedule.
      if (err.response?.status === 409 && err.response.data?.requiresViolationAcknowledgement) {
        setShowPublishModal(false);
        setPublishBlockedBy(err.response.data.violations ?? []);
      } else {
        toast.error(err.response?.data?.error ?? 'Failed to publish');
        setShowPublishModal(false);
      }
    } finally {
      setPublishing(false);
    }
  }, [blockId, refreshContext, setCurrentBlock]);

  const handleUnpublish = useCallback(async () => {
    setLinkControlBusy(true);
    try {
      await api.post('/schedule/unpublish', { blockId });
      await refreshContext();
      setCurrentBlock(prev => (prev ? { ...prev, isPublished: false } : prev));
      setLinkControlMode(null);
      toast.success('Schedule unpublished. The public link no longer works.');
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Failed to unpublish');
    } finally {
      setLinkControlBusy(false);
    }
  }, [blockId, refreshContext, setCurrentBlock]);

  const handleRotateLink = useCallback(async () => {
    setLinkControlBusy(true);
    try {
      const { data } = await api.post('/schedule/rotate-link', { blockId });
      await refreshContext();
      setCurrentBlock(prev => (prev ? { ...prev, publicToken: data.publicToken } : prev));
      setLinkControlMode(null);
      toast.success('New public link generated. The previous link no longer works.');
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Failed to generate a new link');
    } finally {
      setLinkControlBusy(false);
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
      const res = await api.get('/schedule/export/excel', {
        params: { blockId },
        responseType: 'blob',
      });
      const blob = res.data;
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

  const handlePrintPdf = useCallback(async () => {
    if (!blockId) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Popup blocked. Please allow popups for printable export.');
      return;
    }
    printWindow.document.write('<!doctype html><title>Loading printable schedule...</title><p style="font-family: sans-serif; color: var(--ink-1);">Loading printable schedule...</p>');
    printWindow.document.close();
    setPrintingPdf(true);
    try {
      const { data: html } = await api.get('/schedule/export/pdf', {
        params: { blockId },
        responseType: 'text',
      });
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      toast.success('Printable schedule opened');
    } catch {
      printWindow.close();
      toast.error('Failed to open printable schedule');
    } finally {
      setPrintingPdf(false);
    }
  }, [blockId]);

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

  const selectedDayData = selectedDateKey ? dayDataMap[selectedDateKey] : null;

  return (
    <PageWrapper>
      <Layout>
        <CalendarTopBar
          blockNum={blockNum}
          blockStart={shownBlock?.startDate}
          blockEnd={shownBlock?.endDate}
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
          publicUrl={publicUrl}
          onCopyLink={handleCopyLink}
          onUnpublish={() => setLinkControlMode('unpublish')}
          onRotateLink={() => setLinkControlMode('rotate')}
          onExportExcel={handleExportExcel}
          exportingExcel={exportingExcel}
          onPrintPdf={handlePrintPdf}
          printingPdf={printingPdf}
          onViewPublished={handleViewPublished}
          onValidate={handleValidateSchedule}
          validating={validating}
          blockId={blockId}
          canExportDraft={can('export_draft_schedule')}
          canClearSchedule={can('clear_schedule')}
          canGenerateSchedule={can('generate_schedule')}
          canPublishSchedule={can('publish_schedule')}
          canValidateSchedule={can('view_draft_schedule')}
        />

        {canGenerate && readiness && !readiness.dismissed && (
          <ReadinessPanel
            readiness={readiness}
            onDismiss={() => setReadiness(current => (current ? { ...current, dismissed: true } : current))}
          />
        )}

        {can('edit_block_settings') && (
          <details className="mb-4 rounded-xl" style={{ border: '1px solid var(--border-1)', background: 'var(--surface-1)' }}>
            <summary style={{ padding: '12px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--ink-1)' }}>
              Block rules
            </summary>
            <BlockSettingsSummary
              settings={blockSettings}
              loading={settingsLoading}
              blockNum={blockNum}
            />
          </details>
        )}

        {can('view_draft_schedule') && blockId && programId && (
          <details className="mb-4 rounded-xl" data-testid="block-history"
            style={{ border: '1px solid var(--border-1)', background: 'var(--surface-1)' }}>
            <summary style={{ padding: '12px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--ink-1)' }}>
              Block history
            </summary>
            <div style={{ padding: '0 16px 16px' }}>
              <AuditHistory programId={programId} blockId={blockId} limit={30} />
            </div>
          </details>
        )}

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
                    style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
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
                            dayData={dayDataMap[normalizeDateKey(day)]}
                            onClick={handleDayClick}
                            canEdit={canEditSchedule}
                          />
                        ) : (
                          <div className="h-full rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', minHeight: 100 }} />
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Mobile list */}
            <div className="md:hidden rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-1)', boxShadow: 'var(--shadow-xs)' }}>
              <div className="px-4 py-3" style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border-1)' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-5)' }}>
                  {days.length} days - {canEditSchedule ? 'Tap a day to assign residents' : 'Read-only schedule'}
                </span>
              </div>
              {dayDataList.map((dayData, i) => (
                <DayRow
                  key={i}
                  dayData={dayData}
                  onClick={handleDayClick}
                  canEdit={canEditSchedule}
                />
              ))}
            </div>
          </>
        )}

        {/* Day edit modal */}
        <DayModal
          isOpen={canEditSchedule && selectedDateKey !== null}
          day={selectedDayData?.day ?? null}
          attendings={selectedDayData?.attendings ?? []}
          residents={residents}
          roster={roster}
          assignment={selectedDayData?.assignment ?? null}
          blockId={blockId}
          flag={selectedDayData?.flag ?? null}
          onSave={handleSaveAssignment}
          onClose={closeDayModal}
          onAttendingChange={handleAttendingChange}
          onFlagChange={handleFlagChange}
          saving={assignmentSaving}
        />

        {/* Generation summary modal */}
        <AnimatePresence>
          {genSummary && (
            <GenSummaryModal summary={genSummary} onClose={() => setGenSummary(null)} />
          )}
        </AnimatePresence>

        {validationResult && (
          <ValidationModal
            result={validationResult}
            onClose={() => setValidationResult(null)}
            onEditDate={canEditSchedule ? (dateKey) => {
              setValidationResult(null);
              setSelectedDateKey(dateKey);
            } : null}
          />
        )}

        {pendingOverride && (
          <OverrideConfirmModal
            violations={pendingOverride.violations}
            onConfirm={handleConfirmOverride}
            onClose={() => setPendingOverride(null)}
            saving={overrideSaving}
          />
        )}

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
              onConfirm={() => handleConfirmPublish(false)}
              onClose={() => setShowPublishModal(false)}
              publishing={publishing}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {linkControlMode && (
            <LinkControlModal
              mode={linkControlMode}
              busy={linkControlBusy}
              onConfirm={linkControlMode === 'unpublish' ? handleUnpublish : handleRotateLink}
              onClose={() => setLinkControlMode(null)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {publishBlockedBy && (
            <PublishBlockedModal
              violations={publishBlockedBy}
              publishing={publishing}
              onAcknowledge={() => handleConfirmPublish(true)}
              onClose={() => setPublishBlockedBy(null)}
              onEditDate={dateKey => { setPublishBlockedBy(null); setSelectedDateKey(dateKey); }}
            />
          )}
        </AnimatePresence>

        {/* Publish success modal */}
        <AnimatePresence>
          {showPublishSuccess && publicUrl && (
            <PublishSuccessModal
              publicUrl={publicUrl}
              publishedAt={publishResult?.publishedAt}
              versionId={publishResult?.versionId}
              onClose={() => setShowPublishSuccess(false)}
            />
          )}
        </AnimatePresence>
      </Layout>
    </PageWrapper>
  );
}
