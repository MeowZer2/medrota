import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getApiBase } from '../api/base';

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const API_BASE = getApiBase();

function dateKey(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function dateFromKey(key) {
  if (!key) return null;
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function addDays(date, count) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

function toISODate(date) {
  return dateKey(date);
}

function fmtDate(value) {
  const key = dateKey(value);
  const date = dateFromKey(key);
  return date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function fmtDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function isWeekend(date) {
  const dow = date.getDay();
  return dow === 0 || dow === 6;
}

function buildApiUrl(path) {
  return `${API_BASE}${path}`;
}

function mapByDate(items, getValue) {
  const map = {};
  for (const item of items ?? []) {
    const key = item.dateKey ?? dateKey(item.date);
    if (!key) continue;
    const value = getValue ? getValue(item) : item;
    if (Array.isArray(value)) map[key] = value;
    else {
      if (!map[key]) map[key] = [];
      map[key].push(value);
    }
  }
  return map;
}

function Chip({ label, color, bg, strong = false }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        maxWidth: '100%',
        padding: '2px 7px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: strong ? 700 : 600,
        background: bg,
        color,
        lineHeight: '16px',
        overflowWrap: 'anywhere',
      }}
    >
      {label}
    </span>
  );
}

function StateShell({ title, body, children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', fontFamily: 'Inter, sans-serif', padding: 24 }}>
      <div style={{ maxWidth: 420, width: '100%', textAlign: 'center', background: '#fff', border: '1px solid #E8EFF6', borderRadius: 14, padding: '28px 24px', boxShadow: '0 1px 3px rgba(26,58,92,0.05)' }}>
        <div style={{ width: 42, height: 42, borderRadius: '50%', background: '#EEF4FF', margin: '0 auto 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2C5F8A', fontWeight: 800 }}>
          MR
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1A3A5C', margin: '0 0 8px' }}>{title}</h1>
        <p style={{ color: '#64748B', fontSize: 14, lineHeight: 1.55, margin: 0 }}>{body}</p>
        {children}
        <p style={{ color: '#CBD5E1', fontSize: 12, marginTop: 18 }}>Powered by MedRota</p>
      </div>
    </div>
  );
}

function DayCell({ day, attendings, assignments, holidayName, flag }) {
  const seniors = assignments.filter(a => a.roleOnDay === 'senior');
  const juniors = assignments.filter(a => a.roleOnDay === 'junior');
  const nonCallAtts = attendings.filter(a => !a.isCallDay);
  const callAtts = attendings.filter(a => a.isCallDay);
  const weekend = isWeekend(day);
  const hasTop = nonCallAtts.length > 0;
  const hasCall = callAtts.length > 0 || seniors.length > 0 || juniors.length > 0;
  const hasContent = hasTop || hasCall;

  let bg = '#fff';
  let border = '1px solid #E2E8F0';
  if (flag) {
    bg = `${flag.color}1A`;
    border = `1px solid ${flag.color}55`;
  } else if (holidayName) {
    bg = '#FFF5F5';
    border = '1px solid #FCA5A5';
  } else if (weekend) {
    bg = '#F8FAFC';
  }

  return (
    <div style={{ background: bg, border, borderRadius: 8, padding: 8, minHeight: 96, display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: holidayName ? '#DC2626' : '#1E293B', lineHeight: 1 }}>{day.getDate()}</span>
        <span style={{ fontSize: 10, color: '#94A3B8', lineHeight: 1 }}>{day.toLocaleDateString('en-GB', { month: 'short' })}</span>
        {flag && <span style={{ fontSize: 9, fontWeight: 700, color: flag.color, lineHeight: 1 }}>{flag.label}</span>}
        {holidayName && !flag && <span style={{ fontSize: 9, fontWeight: 800, color: '#DC2626', textTransform: 'uppercase', lineHeight: 1 }}>{holidayName}</span>}
      </div>

      {hasTop && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {nonCallAtts.map((a, index) => {
            const label = [a.attendingName, a.activityLabel].filter(Boolean).join(' - ');
            return label ? <Chip key={index} label={label} color="#334155" bg="#F1F5F9" /> : null;
          })}
        </div>
      )}

      {hasTop && hasCall && <div style={{ borderTop: '1px solid #E2E8F0' }} />}

      {hasCall && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {callAtts.map((a, index) => (
            <Chip key={`call-${index}`} label={a.attendingName} color="#991B1B" bg="#FEF2F2" strong />
          ))}
          {seniors.map((a, index) => (
            <Chip key={`senior-${index}`} label={`S: ${a.resident?.name ?? 'Assigned'}`} color="#166534" bg="#F0FDF4" />
          ))}
          {juniors.map((a, index) => (
            <Chip key={`junior-${index}`} label={`J: ${a.resident?.name ?? 'Assigned'}`} color="#92400E" bg="#FFFBEB" />
          ))}
        </div>
      )}

      {!hasContent && <span style={{ fontSize: 10, color: '#94A3B8', fontStyle: 'italic' }}>No call assignment</span>}
    </div>
  );
}

function MobileDayRow({ day, attendings, assignments, holidayName, flag }) {
  const seniors = assignments.filter(a => a.roleOnDay === 'senior');
  const juniors = assignments.filter(a => a.roleOnDay === 'junior');
  const nonCallAtts = attendings.filter(a => !a.isCallDay);
  const callAtts = attendings.filter(a => a.isCallDay);
  const weekend = isWeekend(day);
  const hasContent = attendings.length > 0 || seniors.length > 0 || juniors.length > 0;

  let bg = '#fff';
  let accent = 'transparent';
  if (flag) {
    bg = `${flag.color}14`;
    accent = flag.color;
  } else if (holidayName) {
    bg = '#FFF5F5';
    accent = '#FCA5A5';
  } else if (weekend) {
    bg = '#F8FAFC';
    accent = '#E2E8F0';
  }

  return (
    <div style={{ background: bg, border: '1px solid #E8EFF6', borderLeft: `3px solid ${accent}`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: hasContent ? 8 : 0 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: holidayName ? '#DC2626' : '#1A3A5C' }}>
          {day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
        </span>
        {flag && <span style={{ fontSize: 11, color: flag.color, fontWeight: 700 }}>{flag.label}</span>}
        {holidayName && !flag && <span style={{ fontSize: 10, color: '#DC2626', fontWeight: 800, textTransform: 'uppercase' }}>{holidayName}</span>}
        {weekend && !holidayName && !flag && <span style={{ fontSize: 10, color: '#94A3B8' }}>Weekend</span>}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {nonCallAtts.map((a, index) => {
          const label = [a.attendingName, a.activityLabel].filter(Boolean).join(' - ');
          return label ? <Chip key={index} label={label} color="#334155" bg="#F1F5F9" /> : null;
        })}
        {callAtts.map((a, index) => <Chip key={`call-${index}`} label={a.attendingName} color="#991B1B" bg="#FEF2F2" strong />)}
        {seniors.map((a, index) => <Chip key={`senior-${index}`} label={`S: ${a.resident?.name ?? 'Assigned'}`} color="#166534" bg="#F0FDF4" />)}
        {juniors.map((a, index) => <Chip key={`junior-${index}`} label={`J: ${a.resident?.name ?? 'Assigned'}`} color="#92400E" bg="#FFFBEB" />)}
        {!hasContent && <span style={{ fontSize: 11, color: '#94A3B8', fontStyle: 'italic' }}>No call assignment</span>}
      </div>
    </div>
  );
}

export default function PublicSchedule() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = event => setIsMobile(event.matches);
    mq.addEventListener('change', handler);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(buildApiUrl(`/public/${token}`), { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('This schedule link is unavailable or has not been published yet.');
        return response.json();
      })
      .then(schedule => setData(schedule))
      .catch(err => {
        if (err.name !== 'AbortError') setError(err.message || 'This schedule is unavailable.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [token]);

  const schedule = useMemo(() => {
    if (!data?.block) return null;
    const block = data.block;
    const startKey = block.startDateKey ?? dateKey(block.startDate);
    const endKey = block.endDateKey ?? dateKey(block.endDate);
    const start = dateFromKey(startKey);
    const end = dateFromKey(endKey);
    const days = [];
    if (start && end) {
      for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
        days.push(new Date(cursor));
      }
    }

    const holidayMap = {};
    for (const holiday of block.holidays ?? []) {
      const key = holiday.dateKey ?? dateKey(holiday.date);
      if (key) holidayMap[key] = holiday.name || 'Holiday';
    }

    const attendingMap = mapByDate(data.attendingEntries);
    const flagMap = {};
    for (const flag of data.flags ?? []) {
      const key = flag.dateKey ?? dateKey(flag.date);
      if (key) flagMap[key] = flag;
    }

    const assignmentMap = {};
    for (const callDay of data.callDays ?? []) {
      const key = callDay.dateKey ?? dateKey(callDay.date);
      if (!key) continue;
      assignmentMap[key] = callDay.assignments ?? [];
      if (callDay.holidayName && !holidayMap[key]) holidayMap[key] = callDay.holidayName;
    }

    const padBefore = days[0] ? (days[0].getDay() + 6) % 7 : 0;
    const padded = [...Array(padBefore).fill(null), ...days];
    while (padded.length % 7 !== 0) padded.push(null);
    const weeks = [];
    for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

    return { block, days, weeks, holidayMap, attendingMap, assignmentMap, flagMap };
  }, [data]);

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const response = await fetch(buildApiUrl(`/public/${token}/export/excel`));
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `block-${data?.block?.number ?? 'schedule'}-schedule.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch {
      window.alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handlePrintPdf = () => {
    window.open(buildApiUrl(`/public/${token}/export/pdf`), '_blank', 'noopener,noreferrer');
  };

  if (loading) {
    return (
      <StateShell title="Loading schedule" body="Fetching the published read-only schedule.">
        <div style={{ width: 34, height: 34, borderRadius: '50%', border: '3px solid #E8EFF6', borderTopColor: '#2C5F8A', animation: 'spin 0.8s linear infinite', margin: '18px auto 0' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </StateShell>
    );
  }

  if (error || !schedule) {
    return (
      <StateShell
        title="Schedule not available"
        body={error || 'This public schedule link could not be loaded. It may be unpublished or no longer available.'}
      />
    );
  }

  const { block, days, weeks, holidayMap, attendingMap, assignmentMap, flagMap } = schedule;
  const publishedLabel = fmtDateTime(data.publishedAt);

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'Inter, sans-serif' }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
          .print-page { padding: 0 !important; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="no-print" style={{ background: '#1A3A5C', padding: '16px 24px' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <p style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0 }}>MedRota</p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.68)', margin: '2px 0 0' }}>Read-only published schedule</p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={handleExportExcel}
              disabled={exporting}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.22)', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: exporting ? 'not-allowed' : 'pointer', opacity: exporting ? 0.7 : 1 }}
              onMouseEnter={event => { if (!exporting) event.currentTarget.style.background = 'rgba(255,255,255,0.18)'; }}
              onMouseLeave={event => { event.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
            >
              {exporting ? 'Exporting...' : 'Excel'}
            </button>
            <button
              onClick={handlePrintPdf}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.22)', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
              onMouseEnter={event => { event.currentTarget.style.background = 'rgba(255,255,255,0.18)'; }}
              onMouseLeave={event => { event.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
            >
              Print / Save PDF
            </button>
          </div>
        </div>
      </div>

      <main className="print-page" style={{ maxWidth: 1120, margin: '0 auto', padding: '24px 16px 28px' }}>
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
          style={{ background: '#fff', border: '1px solid #E8EFF6', borderRadius: 12, padding: '20px 22px', marginBottom: 18, boxShadow: '0 1px 3px rgba(26,58,92,0.05)' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1A3A5C', margin: '0 0 5px' }}>
                Block {block.number} - {block.programName}
              </h1>
              <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
                {[block.specialty, `${fmtDate(block.startDateKey ?? block.startDate)} to ${fmtDate(block.endDateKey ?? block.endDate)}`].filter(Boolean).join(' - ')}
              </p>
              {publishedLabel && (
                <p style={{ fontSize: 12, color: '#94A3B8', margin: '6px 0 0' }}>Published {publishedLabel}</p>
              )}
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 99, background: '#DCFCE7', color: '#15803D', fontSize: 12, fontWeight: 800 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A' }} />
              Published
            </span>
          </div>

          <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16, paddingTop: 16, borderTop: '1px solid #F1F5F9' }}>
            <span style={{ fontSize: 11, color: '#64748B', fontWeight: 700 }}>Legend:</span>
            <Chip label="Activity" color="#334155" bg="#F1F5F9" />
            <Chip label="Attending call" color="#991B1B" bg="#FEF2F2" />
            <Chip label="S: Senior" color="#166534" bg="#F0FDF4" />
            <Chip label="J: Junior / med student" color="#92400E" bg="#FFFBEB" />
            <Chip label="Holiday" color="#DC2626" bg="#FEE2E2" />
          </div>
        </motion.section>

        {days.length === 0 ? (
          <div style={{ background: '#fff', border: '1px solid #E8EFF6', borderRadius: 12, padding: 24, color: '#64748B', textAlign: 'center' }}>
            No schedule dates are available for this published block.
          </div>
        ) : isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {days.map(day => {
              const key = toISODate(day);
              return (
                <MobileDayRow
                  key={key}
                  day={day}
                  attendings={attendingMap[key] ?? []}
                  assignments={assignmentMap[key] ?? []}
                  holidayName={holidayMap[key]}
                  flag={flagMap[key] ?? null}
                />
              );
            })}
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 5, marginBottom: 5 }}>
              {DAYS_OF_WEEK.map(day => (
                <div key={day} style={{ textAlign: 'center', padding: '6px 0', fontSize: 10, fontWeight: 800, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{day}</div>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {weeks.map((week, weekIndex) => (
                <div key={weekIndex} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 5 }}>
                  {week.map((day, dayIndex) => {
                    const key = day ? toISODate(day) : `blank-${weekIndex}-${dayIndex}`;
                    return (
                      <div key={key} style={{ minHeight: 96 }}>
                        {day ? (
                          <DayCell
                            day={day}
                            attendings={attendingMap[key] ?? []}
                            assignments={assignmentMap[key] ?? []}
                            holidayName={holidayMap[key]}
                            flag={flagMap[key] ?? null}
                          />
                        ) : (
                          <div style={{ height: '100%', minHeight: 96, borderRadius: 8, background: '#F8FAFC', border: '1px solid #F1F5F9' }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ textAlign: 'center', padding: '24px 0 0', color: '#CBD5E1', fontSize: 12 }}>
          Generated by MedRota
        </div>
      </main>
    </div>
  );
}
