import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import Layout from '../components/Layout';
import PageWrapper from '../components/PageWrapper';
import BlockSelector from '../components/BlockSelector';
import api from '../api/axios';
import { useApp } from '../context/AppContext';
import {
  getDaysFromDates, getDaysInBlock, isWeekend,
  toISODate, fmtShort, fmtDay, DAYS_OF_WEEK,
} from '../lib/blockUtils';

// Mon=0 … Sun=6
function monBasedDow(date) { return (date.getDay() + 6) % 7; }

// ── shared styles ─────────────────────────────────────────────────────────────

const card    = { background: '#fff', border: '1px solid #E8EFF6', borderRadius: 16, boxShadow: '0 1px 3px rgba(26,58,92,0.05)' };
const inputSt = { padding: '6px 10px', borderRadius: 7, border: '1px solid #E2E8F0', fontSize: 12, color: '#1A3A5C', background: '#F8FAFC', outline: 'none', width: '100%', boxSizing: 'border-box' };
const label10 = { display: 'block', fontSize: 10, fontWeight: 500, color: '#64748B', marginBottom: 3 };

// ── SaveDot ───────────────────────────────────────────────────────────────────

function SaveDot({ status }) {
  if (!status) return null;
  const colors = { saving: '#D97706', saved: '#16A34A', error: '#DC2626' };
  return <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors[status], display: 'inline-block', flexShrink: 0 }} />;
}

// ── DayActivityInput — small input/select for the template grid ───────────────

function DayActivityInput({ value, activities, onChange }) {
  const [local, setLocal] = useState(value);
  const timer = useRef(null);

  // Sync when parent value changes (e.g., after apply template)
  useEffect(() => { setLocal(value); }, [value]);

  const handle = (v) => {
    setLocal(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(v), 700);
  };

  const baseStyle = { ...inputSt, padding: '4px 6px', fontSize: 11, height: 28 };

  if (activities.length > 0) {
    return (
      <select value={local} onChange={e => handle(e.target.value)} style={{ ...baseStyle, cursor: 'pointer' }}>
        <option value="">—</option>
        {activities.map(a => <option key={a} value={a}>{a}</option>)}
      </select>
    );
  }
  return (
    <input value={local} onChange={e => handle(e.target.value)}
      placeholder="—" style={baseStyle} />
  );
}

// ── AttendingTemplateRow — one row in the roster + pattern table ──────────────

function AttendingTemplateRow({ attending, template, onUpdateTemplate, onRemove }) {
  const [dotStatus, setDotStatus] = useState({});

  const handleChange = async (dowIndex, value) => {
    const existing = template[dowIndex];
    setDotStatus(s => ({ ...s, [dowIndex]: 'saving' }));
    try {
      await onUpdateTemplate(attending.name, dowIndex, value, existing ?? null);
      setDotStatus(s => ({ ...s, [dowIndex]: 'saved' }));
      setTimeout(() => setDotStatus(s => ({ ...s, [dowIndex]: null })), 1200);
    } catch {
      setDotStatus(s => ({ ...s, [dowIndex]: 'error' }));
    }
  };

  return (
    <tr style={{ borderTop: '1px solid #F1F5F9' }}>
      {/* Name */}
      <td style={{ padding: '7px 12px 7px 0', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(135deg, #1A3A5C, #2C5F8A)',
            color: '#fff', fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {attending.name.split(' ').filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#1A3A5C' }}>{attending.name}</span>
        </div>
      </td>

      {/* One cell per day of week */}
      {DAYS_OF_WEEK.map((_, di) => (
        <td key={di} style={{ padding: '6px 4px', verticalAlign: 'middle' }}>
          <div style={{ position: 'relative' }}>
            <DayActivityInput
              value={template[di]?.activityLabel ?? ''}
              activities={attending.activities}
              onChange={val => handleChange(di, val)}
            />
            {dotStatus[di] && (
              <span style={{ position: 'absolute', top: -3, right: -3 }}>
                <SaveDot status={dotStatus[di]} />
              </span>
            )}
          </div>
        </td>
      ))}

      {/* Remove button */}
      <td style={{ padding: '6px 0 6px 6px', verticalAlign: 'middle', textAlign: 'center' }}>
        <button onClick={onRemove} title="Remove attending"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#CBD5E1', padding: 4, borderRadius: 6, lineHeight: 1 }}
          onMouseEnter={e => { e.currentTarget.style.color = '#DC2626'; e.currentTarget.style.background = '#FEF2F2'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#CBD5E1'; e.currentTarget.style.background = 'none'; }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
          </svg>
        </button>
      </td>
    </tr>
  );
}

// ── Section 1: Roster & Weekly Pattern Panel ──────────────────────────────────

function RosterTemplatePanel({
  open, onToggle,
  roster, template,
  onAddAttending, onRemoveAttending,
  onUpdateTemplate,
}) {
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name || adding) return;
    setAdding(true);
    await onAddAttending(name);
    setNewName('');
    setAdding(false);
  };

  return (
    <div style={{ ...card, marginBottom: 16 }}>
      {/* Collapsible header */}
      <button
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '14px 20px', background: 'none', border: 'none',
          borderBottom: open ? '1px solid #E8EFF6' : 'none',
          borderRadius: open ? '16px 16px 0 0' : 16,
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 4, height: 20, borderRadius: 2, background: '#2C5F8A' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1A3A5C' }}>
            Attending Roster &amp; Weekly Pattern
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#F0F5FF', color: '#4A6FA5' }}>
            {roster.length}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: '#94A3B8' }}>Persists across all blocks</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {open && (
        <div style={{ padding: '20px 20px 24px' }}>
          {/* Add attending row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={label10}>New attending name</label>
              <input
                value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Dr. Hassan" style={inputSt}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <button
              onClick={handleAdd} disabled={!newName.trim() || adding}
              style={{
                padding: '7px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: '#1A3A5C', color: '#fff', fontSize: 12, fontWeight: 600,
                opacity: (!newName.trim() || adding) ? 0.5 : 1, whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { if (newName.trim() && !adding) e.currentTarget.style.background = '#2C5F8A'; }}
              onMouseLeave={e => e.currentTarget.style.background = '#1A3A5C'}
            >
              {adding ? 'Adding…' : '+ Add attending'}
            </button>
          </div>

          {roster.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#CBD5E1', fontSize: 13, padding: '20px 0' }}>
              No attendings yet — add one above
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 12px 10px 0', fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                      Attending
                    </th>
                    {DAYS_OF_WEEK.map(d => (
                      <th key={d} style={{ textAlign: 'center', padding: '4px 4px 10px', fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 90 }}>
                        {d}
                      </th>
                    ))}
                    <th style={{ width: 32 }} />
                  </tr>
                </thead>
                <tbody>
                  {roster.map(att => (
                    <AttendingTemplateRow
                      key={att.id}
                      attending={att}
                      template={template[att.name] ?? {}}
                      onUpdateTemplate={onUpdateTemplate}
                      onRemove={() => onRemoveAttending(att.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── EntryRow — one attending entry in an expanded day ────────────────────────

function EntryRow({ entry, roster, dow, template, onSave, onDelete }) {
  const [localName,     setLocalName]     = useState(entry.attendingName);
  const [localActivity, setLocalActivity] = useState(entry.activityLabel ?? '');
  const [localCall,     setLocalCall]     = useState(entry.isCallDay ?? false);
  const [status,        setStatus]        = useState(null);
  const saveTimer = useRef(null);
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);

  // Sync when parent entry changes (e.g. after a reset)
  useEffect(() => {
    setLocalName(entry.attendingName);
    setLocalActivity(entry.activityLabel ?? '');
    setLocalCall(entry.isCallDay ?? false);
  }, [entry.attendingName, entry.activityLabel, entry.isCallDay]);

  const triggerSave = (name, activity, call) => {
    clearTimeout(saveTimer.current);
    setStatus('saving');
    saveTimer.current = setTimeout(async () => {
      try {
        await onSaveRef.current({ attendingName: name, activityLabel: activity, isCallDay: call });
        setStatus('saved');
        setTimeout(() => setStatus(null), 1400);
      } catch { setStatus('error'); }
    }, 600);
  };

  const handleCallChange = (v) => {
    setLocalCall(v);
    clearTimeout(saveTimer.current);
    setStatus('saving');
    onSaveRef.current({ attendingName: localName, activityLabel: localActivity, isCallDay: v })
      .then(() => { setStatus('saved'); setTimeout(() => setStatus(null), 1400); })
      .catch(() => setStatus('error'));
  };

  const attendingInfo  = roster.find(r => r.name === localName);
  const activities     = attendingInfo?.activities ?? [];
  const templateAct    = template[localName]?.[dow]?.activityLabel ?? '';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 0', borderBottom: '1px solid #F8FAFC',
    }}>
      {/* Call stripe */}
      <div style={{ width: 3, height: 26, borderRadius: 2, background: localCall ? '#DC2626' : '#E2E8F0', flexShrink: 0 }} />

      {/* Attending name dropdown */}
      <select
        value={localName}
        onChange={e => { setLocalName(e.target.value); triggerSave(e.target.value, localActivity, localCall); }}
        style={{ ...inputSt, flex: '0 0 150px', fontSize: 12 }}
      >
        {roster.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
        {!roster.find(r => r.name === localName) && localName && (
          <option value={localName}>{localName}</option>
        )}
      </select>

      {/* Activity */}
      {activities.length > 0 ? (
        <select
          value={localActivity}
          onChange={e => { setLocalActivity(e.target.value); triggerSave(localName, e.target.value, localCall); }}
          style={{ ...inputSt, flex: 1, fontSize: 12 }}
        >
          <option value="">— Activity —</option>
          {activities.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      ) : (
        <input
          value={localActivity}
          onChange={e => { setLocalActivity(e.target.value); triggerSave(localName, e.target.value, localCall); }}
          placeholder={templateAct || 'Activity (optional)'}
          style={{ ...inputSt, flex: 1, fontSize: 12 }}
        />
      )}

      {/* On-call toggle */}
      <button
        onClick={() => handleCallChange(!localCall)}
        title={localCall ? 'On call — click to remove' : 'Mark as on call'}
        style={{
          width: 32, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer', flexShrink: 0,
          background: localCall ? '#DC2626' : '#E2E8F0', position: 'relative', transition: 'background 0.15s',
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: localCall ? 15 : 2,
          width: 14, height: 14, borderRadius: '50%', background: '#fff',
          transition: 'left 0.15s', display: 'block',
        }} />
      </button>
      <span style={{ fontSize: 10, fontWeight: 600, color: localCall ? '#DC2626' : '#CBD5E1', minWidth: 40, whiteSpace: 'nowrap' }}>
        {localCall ? 'On call' : 'Call'}
      </span>

      <SaveDot status={status} />

      {/* Delete */}
      <button
        onClick={onDelete}
        style={{ padding: '4px 5px', borderRadius: 6, border: 'none', background: 'none', cursor: 'pointer', color: '#CBD5E1', flexShrink: 0 }}
        onMouseEnter={e => { e.currentTarget.style.color = '#DC2626'; e.currentTarget.style.background = '#FEF2F2'; }}
        onMouseLeave={e => { e.currentTarget.style.color = '#CBD5E1'; e.currentTarget.style.background = 'none'; }}
        title="Remove"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

// ── DayRow — one collapsible day in the day list ──────────────────────────────

function DayRow({ day, iso, entries, roster, template, isExpanded, isLast, onToggle, onAddEntry, onSaveEntry, onDeleteEntry, onResetRow }) {
  const weekend  = isWeekend(day);
  const isOnCall = entries.some(e => e.isCallDay);
  const dow      = monBasedDow(day);

  return (
    <div style={{
      borderBottom: isLast ? 'none' : '1px solid #F1F5F9',
      borderLeft: `3px solid ${isOnCall ? '#DC2626' : 'transparent'}`,
      background: weekend ? '#FAFBFD' : '#fff',
    }}>
      {/* Clickable header row */}
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = '#F8FAFC'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
      >
        {/* Date */}
        <div style={{ minWidth: 56, flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#1E293B' }}>{day.getDate()}</span>
          <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 4 }}>
            {fmtShort(day).split(' ')[1]}
          </span>
        </div>

        {/* Day of week */}
        <span style={{ fontSize: 12, fontWeight: weekend ? 700 : 500, color: weekend ? '#D97706' : '#64748B', minWidth: 32, flexShrink: 0 }}>
          {fmtDay(day)}
        </span>

        {/* Entry chips (collapsed summary) */}
        <div style={{ flex: 1, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', overflow: 'hidden' }}>
          {entries.length === 0 ? (
            <span style={{ fontSize: 11, color: '#CBD5E1', fontStyle: 'italic' }}>No entries — click to add</span>
          ) : entries.map((e, i) => (
            <span key={i} style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap',
              background: e.isCallDay ? '#FEF2F2' : '#F1F5F9',
              color: e.isCallDay ? '#991B1B' : '#334155',
              fontWeight: e.isCallDay ? 600 : 400,
              border: e.isCallDay ? '1px solid #FECACA' : '1px solid transparent',
            }}>
              {e.attendingName}
              {e.isCallDay && ' ●'}
              {e.activityLabel && <span style={{ color: '#94A3B8', fontWeight: 400 }}> · {e.activityLabel}</span>}
            </span>
          ))}
        </div>

        {/* Chevron */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.18s', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div style={{ padding: '2px 16px 14px', borderTop: '1px solid #F1F5F9' }}>
          {entries.length === 0 && (
            <p style={{ fontSize: 12, color: '#CBD5E1', fontStyle: 'italic', padding: '8px 0' }}>
              No attending entries for this day yet.
            </p>
          )}
          {entries.map((entry, i) => (
            <EntryRow
              key={entry.id ?? `new-${i}`}
              entry={entry}
              roster={roster}
              dow={dow}
              template={template}
              onSave={(updates) => onSaveEntry(i, updates)}
              onDelete={() => onDeleteEntry(i)}
            />
          ))}

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <button
              onClick={onAddEntry}
              disabled={roster.length === 0}
              style={{
                padding: '5px 14px', borderRadius: 7, border: '1px dashed #C0D5EB',
                background: '#F8FAFC', color: '#2C5F8A', fontSize: 12, fontWeight: 600,
                cursor: roster.length === 0 ? 'default' : 'pointer', opacity: roster.length === 0 ? 0.4 : 1,
              }}
              onMouseEnter={e => { if (roster.length > 0) { e.currentTarget.style.background = '#EEF4FF'; e.currentTarget.style.borderColor = '#2C5F8A'; } }}
              onMouseLeave={e => { e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.borderColor = '#C0D5EB'; }}
            >
              + Add attending
            </button>
            <button
              onClick={onResetRow}
              title="Reset to weekly template"
              style={{
                padding: '5px 10px', borderRadius: 7, border: '1px solid #E2E8F0',
                background: 'none', color: '#94A3B8', fontSize: 11, cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#EEF4FF'; e.currentTarget.style.color = '#1A3A5C'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#94A3B8'; }}
            >
              ↺ Reset to template
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section 2: Day list (accordion) ──────────────────────────────────────────

function DayList({ days, schedule, roster, template, onAddEntry, onSaveEntry, onDeleteEntry, onResetRow }) {
  const [expandedDays, setExpandedDays] = useState(new Set());

  const toggleDay = (iso) => setExpandedDays(prev => {
    const next = new Set(prev);
    if (next.has(iso)) next.delete(iso); else next.add(iso);
    return next;
  });

  return (
    <div style={{ ...card, overflow: 'hidden', marginBottom: 16 }}>
      {days.map((day, idx) => {
        const iso = toISODate(day);
        return (
          <DayRow
            key={iso}
            day={day}
            iso={iso}
            entries={schedule[iso] ?? []}
            roster={roster}
            template={template}
            isExpanded={expandedDays.has(iso)}
            isLast={idx === days.length - 1}
            onToggle={() => toggleDay(iso)}
            onAddEntry={() => onAddEntry(iso)}
            onSaveEntry={(i, updates) => onSaveEntry(iso, i, updates)}
            onDeleteEntry={(i) => onDeleteEntry(iso, i)}
            onResetRow={() => onResetRow(day)}
          />
        );
      })}
    </div>
  );
}

// ── Section 3: On-call summary ────────────────────────────────────────────────

function OnCallSummary({ days, schedule }) {
  // schedule[iso] is now an array of { id, attendingName, activityLabel, isCallDay }
  const covered   = days.filter(d => (schedule[toISODate(d)] ?? []).some(e => e.isCallDay));
  const uncovered = days.length - covered.length;

  return (
    <div style={card}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #E8EFF6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 4, height: 20, borderRadius: 2, background: '#DC2626' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1A3A5C' }}>On-call Summary</span>
          <span style={{ fontSize: 11, color: '#94A3B8' }}>Read-only</span>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#16A34A' }}>{covered.length} covered</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: uncovered > 0 ? '#D97706' : '#94A3B8' }}>
            {uncovered} uncovered
          </span>
        </div>
      </div>

      <div style={{ padding: '12px 20px', maxHeight: 320, overflowY: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
          {days.map(d => {
            const iso       = toISODate(d);
            const entries   = schedule[iso] ?? [];
            const callEntry = entries.find(e => e.isCallDay);
            const weekend   = isWeekend(d);
            return (
              <div key={iso} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 10px', borderRadius: 8,
                background: callEntry ? '#FFF5F5' : '#FFFBEB',
                border: `1px solid ${callEntry ? '#FECACA' : '#FDE68A'}`,
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: weekend ? '#D97706' : '#1E293B', minWidth: 52, whiteSpace: 'nowrap' }}>
                  {fmtShort(d)}
                </span>
                <span style={{ fontSize: 10, color: '#94A3B8', minWidth: 26 }}>{fmtDay(d)}</span>
                {callEntry ? (
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#991B1B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {callEntry.attendingName}
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: '#92400E', fontStyle: 'italic' }}>No attending</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AttendingSchedule() {
  const { blockNumber } = useParams();
  const { currentBlock, setCurrentBlock, currentProgram, currentAcademicYear } = useApp();

  const blockNum  = blockNumber ? parseInt(blockNumber, 10) : (currentBlock?.number ?? 1);
  const blockId   = currentBlock?.id ?? null;
  const programId = currentProgram?.programId ?? null;

  const days = (currentBlock?.startDate && currentBlock?.endDate)
    ? getDaysFromDates(currentBlock.startDate, currentBlock.endDate)
    : getDaysInBlock(blockNum);

  // ── State ──────────────────────────────────────────────────────────────────
  // roster: { id, name, activities: string[] }[]
  const [roster, setRoster] = useState([]);
  // template: { attendingName: { dowIndex: { id, activityLabel } } }
  const [template, setTemplate] = useState({});
  // schedule: { iso: { id, attendingName, activityLabel, isCallDay }[] }
  const [schedule, setSchedule] = useState({});
  const scheduleRef = useRef({});
  useEffect(() => { scheduleRef.current = schedule; }, [schedule]);

  const [rosterOpen, setRosterOpen]         = useState(false);
  const [applying, setApplying]             = useState(false);
  const [applyScope, setApplyScope]         = useState(false);
  const [loading, setLoading]               = useState(true);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [resetting, setResetting]           = useState(false);

  // ── Fetch helpers ──────────────────────────────────────────────────────────

  const fetchRoster = useCallback(async () => {
    if (!programId) return;
    const { data } = await api.get(`/attending/roster?programId=${programId}`);
    setRoster(data.map(r => ({ id: r.id, name: r.attendingName, activities: r.typicalActivities })));
  }, [programId]);

  const fetchTemplate = useCallback(async () => {
    if (!programId) return;
    const { data } = await api.get(`/attending-template?programId=${programId}`);
    // data: [{ attendingName, days: [{ id, dayOfWeek, activityLabel }] }]
    const map = {};
    for (const att of data) {
      map[att.attendingName] = {};
      for (const d of att.days) {
        map[att.attendingName][d.dayOfWeek] = { id: d.id, activityLabel: d.activityLabel };
      }
    }
    setTemplate(map);
  }, [programId]);

  const fetchSchedule = useCallback(async () => {
    if (!blockId) return;
    const { data } = await api.get(`/attending?blockId=${blockId}`);
    const map = {};
    for (const e of data) {
      const iso = toISODate(new Date(e.date));
      if (!map[iso]) map[iso] = [];
      map[iso].push({ id: e.id, attendingName: e.attendingName, activityLabel: e.activityLabel ?? '', isCallDay: e.isCallDay ?? false });
    }
    setSchedule(map);
  }, [blockId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchRoster(), fetchTemplate(), fetchSchedule()])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fetchRoster, fetchTemplate, fetchSchedule]);

  // ── Roster handlers ────────────────────────────────────────────────────────

  const handleAddAttending = async (name) => {
    try {
      const { data } = await api.post('/attending/roster', { programId, attendingName: name, typicalActivities: [] });
      setRoster(prev => [...prev, { id: data.id, name: data.attendingName, activities: data.typicalActivities }]);
    } catch { toast.error('Failed to add attending'); }
  };

  const handleRemoveAttending = async (id) => {
    setRoster(prev => prev.filter(a => a.id !== id));
    try { await api.delete(`/attending/roster/${id}`); }
    catch { toast.error('Failed to remove attending'); fetchRoster(); }
  };

  // ── Template handlers ──────────────────────────────────────────────────────

  const handleUpdateTemplate = useCallback(async (attendingName, dowIndex, value, existing) => {
    if (!value) {
      // Clear: delete existing entry
      if (existing?.id) {
        await api.delete(`/attending-template/entry/${existing.id}`);
        setTemplate(prev => {
          const next = { ...prev, [attendingName]: { ...(prev[attendingName] ?? {}) } };
          delete next[attendingName][dowIndex];
          return next;
        });
      }
    } else if (existing?.id) {
      // Update
      await api.put(`/attending-template/entry/${existing.id}`, { activityLabel: value });
      setTemplate(prev => ({
        ...prev,
        [attendingName]: { ...(prev[attendingName] ?? {}), [dowIndex]: { id: existing.id, activityLabel: value } },
      }));
    } else {
      // Create
      const { data } = await api.post(`/attending-template/${programId}`, { attendingName, dayOfWeek: dowIndex, activityLabel: value });
      setTemplate(prev => ({
        ...prev,
        [attendingName]: { ...(prev[attendingName] ?? {}), [dowIndex]: { id: data.id, activityLabel: data.activityLabel } },
      }));
    }
  }, [programId]);

  // ── Entry handlers (for new array-per-day schedule) ───────────────────────

  const handleAddEntry = useCallback((iso) => {
    const defaultName = roster[0]?.name ?? '';
    if (!defaultName) return;
    setSchedule(prev => ({
      ...prev,
      [iso]: [...(prev[iso] ?? []), { id: null, attendingName: defaultName, activityLabel: '', isCallDay: false }],
    }));
  }, [roster]);

  const handleSaveEntry = useCallback(async (iso, entryIdx, { attendingName, activityLabel, isCallDay }) => {
    const entries = scheduleRef.current[iso] ?? [];
    const entry   = entries[entryIdx];

    if (entry?.id) {
      await api.put(`/attending/${entry.id}`, { attendingName, activityLabel, isCallDay });
      setSchedule(prev => ({
        ...prev,
        [iso]: (prev[iso] ?? []).map((e, i) =>
          i === entryIdx ? { ...e, attendingName, activityLabel, isCallDay } : e
        ),
      }));
    } else {
      const { data } = await api.post('/attending', { blockId, attendingName, date: iso, activityLabel, isCallDay });
      setSchedule(prev => ({
        ...prev,
        [iso]: (prev[iso] ?? []).map((e, i) =>
          i === entryIdx ? { id: data.id, attendingName: data.attendingName, activityLabel: data.activityLabel ?? '', isCallDay: data.isCallDay ?? false } : e
        ),
      }));
    }
  }, [blockId]);

  const handleDeleteEntry = useCallback(async (iso, entryIdx) => {
    const entry = (scheduleRef.current[iso] ?? [])[entryIdx];
    if (entry?.id) {
      await api.delete(`/attending/${entry.id}`);
    }
    setSchedule(prev => ({
      ...prev,
      [iso]: (prev[iso] ?? []).filter((_, i) => i !== entryIdx),
    }));
  }, []);

  // ── Reset a single day to template ────────────────────────────────────────

  const handleResetRow = useCallback(async (day) => {
    const iso = toISODate(day);
    const dow = monBasedDow(day);
    const existing = scheduleRef.current[iso] ?? [];

    // Delete all current entries
    await Promise.all(existing.filter(e => e.id).map(e => api.delete(`/attending/${e.id}`).catch(() => {})));

    // Create entries from template
    const newEntries = [];
    for (const att of roster) {
      const tplAct = template[att.name]?.[dow]?.activityLabel;
      if (tplAct) {
        try {
          const { data } = await api.post('/attending', { blockId, attendingName: att.name, date: iso, activityLabel: tplAct, isCallDay: false });
          newEntries.push({ id: data.id, attendingName: att.name, activityLabel: tplAct, isCallDay: false });
        } catch { /* skip */ }
      }
    }
    setSchedule(prev => ({ ...prev, [iso]: newEntries }));
  }, [blockId, roster, template]);

  // ── Apply full template to block (and optionally all blocks in the year) ──────

  const handleApplyTemplate = async (scope = 'this') => {
    if (!programId || !blockId) return;
    setApplying(true);
    setApplyScope(false);
    try {
      const extraBlockIds = scope === 'all'
        ? (currentAcademicYear?.blocks ?? []).map(b => b.id).filter(id => id !== blockId)
        : [];
      const { data } = await api.post(`/attending-template/${programId}/apply/${blockId}`, { extraBlockIds });
      const scopeLabel = scope === 'all' ? ` (${data.blocks} block${data.blocks !== 1 ? 's' : ''})` : '';
      toast.success(`Template applied${scopeLabel} — ${data.created} created, ${data.updated} updated`);
      await fetchSchedule();
    } catch { toast.error('Failed to apply template'); }
    finally { setApplying(false); }
  };

  // ── Reset block — clear all + reapply template ───────────────────────────────

  const handleResetBlock = async () => {
    if (!programId || !blockId) return;
    setResetting(true);
    try {
      await api.delete(`/attending?blockId=${blockId}`);
      await api.post(`/attending-template/${programId}/apply/${blockId}`, { extraBlockIds: [] });
      await fetchSchedule();
      setShowResetModal(false);
      toast.success('Block reset to template');
    } catch { toast.error('Failed to reset block'); }
    finally { setResetting(false); }
  };

  // ── Clear block — delete all entries only ────────────────────────────────────

  const handleClearBlock = async () => {
    if (!blockId) return;
    setResetting(true);
    try {
      await api.delete(`/attending?blockId=${blockId}`);
      await fetchSchedule();
      setShowClearModal(false);
      toast.success('Block cleared');
    } catch { toast.error('Failed to clear block'); }
    finally { setResetting(false); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const allYearBlocks = currentAcademicYear?.blocks ?? [];

  return (
    <Layout>
      <PageWrapper>
        <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 32 }}>

          {/* Page header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1A3A5C', margin: '0 0 10px' }}>Attending Schedule</h1>

              {/* Block selector */}
              {allYearBlocks.length > 0 && (
                <BlockSelector
                  blocks={allYearBlocks}
                  activeBlockId={currentBlock?.id ?? null}
                  onSelect={setCurrentBlock}
                />
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0, alignItems: 'flex-start' }}>

              {/* Clear block */}
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                onClick={() => setShowClearModal(true)}
                disabled={resetting || !blockId}
                style={{
                  padding: '9px 14px', borderRadius: 10, cursor: (resetting || !blockId) ? 'not-allowed' : 'pointer',
                  background: '#fff', color: '#DC2626', border: '1.5px solid #FCA5A5',
                  fontSize: 13, fontWeight: 600, opacity: (!blockId) ? 0.5 : 1,
                }}
                onMouseEnter={e => { if (blockId && !resetting) { e.currentTarget.style.background = '#FEF2F2'; e.currentTarget.style.borderColor = '#EF4444'; } }}
                onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#FCA5A5'; }}
              >
                Clear block
              </motion.button>

              {/* Reset to template */}
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                onClick={() => setShowResetModal(true)}
                disabled={resetting || !blockId || !programId}
                style={{
                  padding: '9px 14px', borderRadius: 10, cursor: (resetting || !blockId) ? 'not-allowed' : 'pointer',
                  background: '#FFF7ED', color: '#C2410C', border: '1.5px solid #FED7AA',
                  fontSize: 13, fontWeight: 600, opacity: (!blockId || !programId) ? 0.5 : 1,
                }}
                onMouseEnter={e => { if (blockId && programId && !resetting) { e.currentTarget.style.background = '#FFEDD5'; e.currentTarget.style.borderColor = '#FB923C'; } }}
                onMouseLeave={e => { e.currentTarget.style.background = '#FFF7ED'; e.currentTarget.style.borderColor = '#FED7AA'; }}
              >
                Reset to template
              </motion.button>

              {/* Apply template button + scope chooser */}
              <div style={{ position: 'relative' }}>
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                onClick={() => setApplyScope(v => !v)}
                disabled={applying || !blockId || !programId}
                style={{
                  padding: '9px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: '#7C3AED', color: '#fff', fontSize: 13, fontWeight: 600,
                  opacity: (applying || !blockId) ? 0.5 : 1,
                }}
                onMouseEnter={e => { if (!applying && blockId) e.currentTarget.style.background = '#6D28D9'; }}
                onMouseLeave={e => e.currentTarget.style.background = '#7C3AED'}
              >
                {applying ? 'Applying…' : 'Apply template to block'}
              </motion.button>

              {applyScope && !applying && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                  background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.08)', padding: 8, zIndex: 50,
                  minWidth: 220,
                }}>
                  <p style={{ fontSize: 11, color: '#64748B', margin: '0 0 8px', padding: '0 6px' }}>
                    Apply weekly template to:
                  </p>
                  {[
                    { scope: 'this', label: 'This block only', sub: `Block ${blockNum}` },
                    ...(allYearBlocks.length > 1 ? [{ scope: 'all', label: 'All blocks in academic year', sub: `${allYearBlocks.length} blocks` }] : []),
                  ].map(opt => (
                    <button key={opt.scope} onClick={() => handleApplyTemplate(opt.scope)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', background: 'none', fontSize: 13, fontWeight: 600, color: '#1A3A5C' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#F0F5FF'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                      {opt.label}
                      <span style={{ display: 'block', fontSize: 11, fontWeight: 400, color: '#94A3B8' }}>{opt.sub}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            </div>
          </div>

          {/* Section 1 — Roster & Weekly Pattern */}
          <RosterTemplatePanel
            open={rosterOpen}
            onToggle={() => setRosterOpen(o => !o)}
            roster={roster}
            template={template}
            onAddAttending={handleAddAttending}
            onRemoveAttending={handleRemoveAttending}
            onUpdateTemplate={handleUpdateTemplate}
          />

          {/* Section 2 — Day-by-day accordion */}
          {loading ? (
            <div style={{ ...card, padding: '40px 0', textAlign: 'center', color: '#94A3B8', fontSize: 13, marginBottom: 16 }}>
              Loading schedule…
            </div>
          ) : !blockId ? (
            <div style={{ ...card, padding: '48px 24px', textAlign: 'center', color: '#94A3B8', fontSize: 14, marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: 13 }}>Select a block above to view and edit the attending schedule.</p>
            </div>
          ) : (
            <DayList
              days={days}
              schedule={schedule}
              roster={roster}
              template={template}
              onAddEntry={handleAddEntry}
              onSaveEntry={handleSaveEntry}
              onDeleteEntry={handleDeleteEntry}
              onResetRow={handleResetRow}
            />
          )}

          {/* Section 3 — On-call summary */}
          {!loading && blockId && days.length > 0 && (
            <OnCallSummary days={days} schedule={schedule} />
          )}

        </div>

        {/* Reset block confirmation modal */}
        {showResetModal && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)' }}
            onClick={() => setShowResetModal(false)}>
            <div style={{ background: '#fff', borderRadius: 16, maxWidth: 400, width: '100%', overflow: 'hidden', boxShadow: '0 20px 60px rgba(26,58,92,0.18)' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ height: 4, background: '#C2410C' }} />
              <div style={{ padding: '24px 24px 20px' }}>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1A3A5C', margin: '0 0 8px' }}>Reset block to template</h2>
                <p style={{ fontSize: 13, color: '#64748B', marginBottom: 20, lineHeight: 1.5 }}>
                  This will clear all attending entries for Block {blockNum} and reapply the weekly pattern. Any manual changes will be lost.
                </p>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setShowResetModal(false)} disabled={resetting}
                    style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid #E8EFF6', background: '#F8FAFC', color: '#64748B', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button onClick={handleResetBlock} disabled={resetting}
                    style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#C2410C', color: '#fff', fontSize: 13, fontWeight: 600, cursor: resetting ? 'not-allowed' : 'pointer', opacity: resetting ? 0.7 : 1 }}>
                    {resetting ? 'Resetting…' : 'Reset to template'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Clear block confirmation modal */}
        {showClearModal && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)' }}
            onClick={() => setShowClearModal(false)}>
            <div style={{ background: '#fff', borderRadius: 16, maxWidth: 400, width: '100%', overflow: 'hidden', boxShadow: '0 20px 60px rgba(26,58,92,0.18)' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ height: 4, background: '#DC2626' }} />
              <div style={{ padding: '24px 24px 20px' }}>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1A3A5C', margin: '0 0 8px' }}>Clear block</h2>
                <p style={{ fontSize: 13, color: '#64748B', marginBottom: 20, lineHeight: 1.5 }}>
                  This will delete all attending entries for Block {blockNum}. The weekly template pattern will not be affected. This cannot be undone.
                </p>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setShowClearModal(false)} disabled={resetting}
                    style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid #E8EFF6', background: '#F8FAFC', color: '#64748B', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button onClick={handleClearBlock} disabled={resetting}
                    style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: '#DC2626', color: '#fff', fontSize: 13, fontWeight: 600, cursor: resetting ? 'not-allowed' : 'pointer', opacity: resetting ? 0.7 : 1 }}>
                    {resetting ? 'Clearing…' : 'Clear all entries'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </PageWrapper>
    </Layout>
  );
}
