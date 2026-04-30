import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';

const API_BASE = 'http://localhost:3000/api';

// ── helpers ───────────────────────────────────────────────────────────────────

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function isWeekend(d) {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Chip ──────────────────────────────────────────────────────────────────────

function Chip({ label, color, bg }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 4,
      fontSize: 10, fontWeight: 600, background: bg, color,
      whiteSpace: 'nowrap', lineHeight: '16px',
    }}>
      {label}
    </span>
  );
}

// ── DayCell ───────────────────────────────────────────────────────────────────

function DayCell({ day, attendings, assignments, isHoliday, holidayName, flag }) {
  const weekend = isWeekend(day);
  const seniors = assignments.filter(a => a.roleOnDay === 'senior');
  const juniors = assignments.filter(a => a.roleOnDay === 'junior');

  // Split attendings: non-call top, call-day bottom
  const nonCallAtts = (attendings ?? []).filter(a => !a.isCallDay);
  const callAtts    = (attendings ?? []).filter(a => a.isCallDay);

  const hasTopSection    = nonCallAtts.length > 0;
  const hasBottomSection = callAtts.length > 0 || seniors.length > 0 || juniors.length > 0;
  const showDivider      = hasTopSection && hasBottomSection;

  const dayNum    = day.getDate();
  const monthAbbr = day.toLocaleDateString('en-GB', { month: 'short' });

  // Background: flag tint (12%) > holiday > weekend > white
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
    <div className="flex flex-col" style={{ background: bg, border, borderRadius: 8, padding: 8, minHeight: 90 }}>
      {/* Date header */}
      <div className="flex items-baseline gap-1 mb-1 flex-wrap">
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1E293B', lineHeight: 1 }}>{dayNum}</span>
        <span style={{ fontSize: 10, color: '#94A3B8', lineHeight: 1 }}>{monthAbbr}</span>
        {flag && (
          <span style={{ fontSize: 9, fontWeight: 600, color: flag.color, lineHeight: 1 }}>· {flag.label}</span>
        )}
        {isHoliday && !flag && (
          <span style={{ fontSize: 8, fontWeight: 700, color: '#DC2626', textTransform: 'uppercase', lineHeight: 1 }}>
            {holidayName ?? 'Holiday'}
          </span>
        )}
      </div>

      {/* TOP — non-call attendings as subtle gray chips */}
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

      {/* BOTTOM — call-day attendings (red chip) + resident chips */}
      {hasBottomSection && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {callAtts.map((a, i) => (
            <span key={`c${i}`} style={{ ...chipBase, background: '#FEF2F2', color: '#991B1B' }}>{a.attendingName}</span>
          ))}
          {seniors.map((a, i) => (
            <span key={`s${i}`} style={{ ...chipBase, background: '#F0FDF4', color: '#166534' }}>S: {a.resident.name}</span>
          ))}
          {juniors.map((a, i) => (
            <span key={`j${i}`} style={{ ...chipBase, background: '#FFFBEB', color: '#92400E' }}>J: {a.resident.name}</span>
          ))}
        </div>
      )}

      {!hasTopSection && !hasBottomSection && (
        <span style={{ fontSize: 9, color: '#CBD5E1', fontStyle: 'italic' }}>Unassigned</span>
      )}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function PublicSchedule() {
  const { token } = useParams();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [exporting, setExporting] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/public/${token}`)
      .then(r => {
        if (!r.ok) throw new Error('Schedule not found or not published');
        return r.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [token]);

  const { holidayMap, attendingMap, assignMap, flagMap, allDays, weeks } = useMemo(() => {
    if (!data) return { holidayMap: {}, attendingMap: {}, assignMap: {}, flagMap: {}, allDays: [], weeks: [] };

    const holidayMap = {};
    for (const h of data.block.holidays ?? []) {
      holidayMap[new Date(h.date).toISOString().slice(0, 10)] = h.name;
    }

    const attendingMap = {};
    for (const e of data.attendingEntries ?? []) {
      const iso = new Date(e.date).toISOString().slice(0, 10);
      if (!attendingMap[iso]) attendingMap[iso] = [];
      attendingMap[iso].push(e);
    }

    const assignMap = {};
    for (const cd of data.callDays ?? []) {
      const iso = new Date(cd.date).toISOString().slice(0, 10);
      assignMap[iso] = cd.assignments;
    }

    const flagMap = {};
    for (const f of data.flags ?? []) {
      flagMap[new Date(f.date).toISOString().slice(0, 10)] = f;
    }

    const start  = new Date(data.block.startDate);
    const end    = new Date(data.block.endDate);
    const allDays = [];
    const cursor  = new Date(start);
    while (cursor <= end) { allDays.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 1); }

    const padBefore = allDays[0] ? (allDays[0].getDay() + 6) % 7 : 0;
    const padded = [...Array(padBefore).fill(null), ...allDays];
    while (padded.length % 7 !== 0) padded.push(null);
    const weeks = [];
    for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

    return { holidayMap, attendingMap, assignMap, flagMap, allDays, weeks };
  }, [data]);

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const res = await fetch(`${API_BASE}/public/${token}/export/excel`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `block-${data.block.number}-schedule.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid #E8EFF6', borderTopColor: '#1A3A5C', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
          <p style={{ color: '#94A3B8', fontSize: 14 }}>Loading schedule…</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ textAlign: 'center', maxWidth: 380, padding: '0 24px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1A3A5C', marginBottom: 8 }}>Schedule Not Available</h1>
          <p style={{ color: '#94A3B8', fontSize: 14, lineHeight: 1.6 }}>{error}</p>
          <p style={{ color: '#CBD5E1', fontSize: 12, marginTop: 16 }}>Powered by MedRota</p>
        </div>
      </div>
    );
  }

  const { block } = data;

  // ── Render ────────────────────────────────────────────────────────────────

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

      {/* Header */}
      <div className="no-print" style={{ background: '#1A3A5C', padding: '16px 24px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <p style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>MedRota</p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', margin: '2px 0 0' }}>Read-only schedule view</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={handleExportExcel}
              disabled={exporting}
              style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: exporting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: exporting ? 0.7 : 1 }}
              onMouseEnter={e => { if (!exporting) e.currentTarget.style.background = 'rgba(255,255,255,0.2)'; }}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              {exporting ? 'Exporting…' : 'Excel'}
            </button>
            <button
              onClick={handlePrint}
              style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                <rect x="6" y="14" width="12" height="8"/>
              </svg>
              Print / PDF
            </button>
          </div>
        </div>
      </div>

      {/* Block info card */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px 0' }} className="print-page">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          style={{ background: '#fff', borderRadius: 16, border: '1px solid #E8EFF6', padding: '20px 24px', marginBottom: 20, boxShadow: '0 1px 3px rgba(26,58,92,0.05)' }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1A3A5C', margin: '0 0 4px' }}>
                Block {block.number} — {block.programName}
              </h1>
              <p style={{ fontSize: 13, color: '#94A3B8', margin: 0 }}>
                {block.specialty} · {fmtDate(block.startDate)} to {fmtDate(block.endDate)}
              </p>
            </div>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px',
              borderRadius: 99, background: '#DCFCE7', color: '#15803D', fontSize: 12, fontWeight: 700,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A', display: 'inline-block' }} />
              Published
            </span>
          </div>

          {/* Legend */}
          <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16, paddingTop: 16, borderTop: '1px solid #F1F5F9' }}>
            <span style={{ fontSize: 11, color: '#64748B', fontWeight: 500 }}>Legend:</span>
            <Chip label="Activity" color="#6D28D9" bg="#F3F0FF" />
            <Chip label="Attending" color="#1D4ED8" bg="#EFF6FF" />
            <Chip label="Call" color="#1A3A5C" bg="#EEF4FF" />
            <Chip label="S: Senior" color="#15803D" bg="#F0FDF4" />
            <Chip label="J: Junior" color="#B45309" bg="#FFFBEB" />
            <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: '#DBEAFE', color: '#1D4ED8' }}>Weekend</span>
            <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: '#FEE2E2', color: '#DC2626' }}>Holiday</span>
          </div>
        </motion.div>

        {/* Calendar — mobile list or desktop grid */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          {isMobile ? (
            /* ── Mobile: vertical day-card list ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {allDays.map(day => {
                const iso      = toISODate(day);
                const dow      = day.getDay();
                const isHol    = !!holidayMap[iso];
                const weekend  = dow === 0 || dow === 6;
                const atts     = attendingMap[iso] ?? [];
                const asgns    = assignMap[iso] ?? [];
                const flag     = flagMap[iso] ?? null;
                const seniors  = asgns.filter(a => a.roleOnDay === 'senior');
                const juniors  = asgns.filter(a => a.roleOnDay === 'junior');
                const nonCallAtts = atts.filter(a => !a.isCallDay);
                const callAtts    = atts.filter(a => a.isCallDay);
                const hasBottom   = callAtts.length > 0 || seniors.length > 0 || juniors.length > 0;
                const hasTop      = nonCallAtts.length > 0;
                const chipBase    = { display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 11, lineHeight: '18px', fontWeight: 500 };

                let bg     = '#fff';
                let accent = 'transparent';
                if (flag)    { bg = flag.color + '15'; accent = flag.color; }
                else if (isHol)  { bg = '#FFF5F5'; accent = '#FCA5A5'; }
                else if (weekend){ bg = '#F8FAFC'; accent = '#E2E8F0'; }

                const dayName = day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

                return (
                  <div key={iso} style={{ background: bg, borderRadius: 10, border: '1px solid #E8EFF6', borderLeft: `3px solid ${accent}`, overflow: 'hidden' }}>
                    {/* Header */}
                    <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: (hasTop || hasBottom) ? '1px solid #F1F5F9' : 'none' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: isHol ? '#DC2626' : '#1A3A5C' }}>{dayName}</span>
                      {flag && <span style={{ fontSize: 10, fontWeight: 600, color: flag.color }}>· {flag.label}</span>}
                      {isHol && !flag && <span style={{ fontSize: 10, fontWeight: 700, color: '#DC2626', textTransform: 'uppercase' }}>Holiday</span>}
                      {weekend && !isHol && !flag && <span style={{ fontSize: 10, color: '#94A3B8' }}>Weekend</span>}
                    </div>

                    {/* Attending (non-call) */}
                    {hasTop && (
                      <div style={{ padding: '6px 12px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {nonCallAtts.map((a, i) => {
                          const text = a.activityLabel ? `${a.attendingName} · ${a.activityLabel}` : a.attendingName;
                          return <span key={i} style={{ ...chipBase, background: '#F1F5F9', color: '#334155' }}>{text}</span>;
                        })}
                      </div>
                    )}

                    {/* Divider before call section */}
                    {hasTop && hasBottom && <div style={{ margin: '0 12px', borderTop: '1px solid #E8EFF6' }} />}

                    {/* Call attendings + residents */}
                    {hasBottom && (
                      <div style={{ padding: '6px 12px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {callAtts.map((a, i) => (
                          <span key={`c${i}`} style={{ ...chipBase, background: '#FEF2F2', color: '#991B1B', fontWeight: 600 }}>{a.attendingName}</span>
                        ))}
                        {seniors.map((a, i) => (
                          <span key={`s${i}`} style={{ ...chipBase, background: '#F0FDF4', color: '#166534' }}>S: {a.resident.name}</span>
                        ))}
                        {juniors.map((a, i) => (
                          <span key={`j${i}`} style={{ ...chipBase, background: '#FFFBEB', color: '#92400E' }}>J: {a.resident.name}</span>
                        ))}
                      </div>
                    )}

                    {!hasTop && !hasBottom && (
                      <div style={{ padding: '6px 12px' }}>
                        <span style={{ fontSize: 11, color: '#CBD5E1', fontStyle: 'italic' }}>Unassigned</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── Desktop: 7-column grid ── */
            <>
              {/* Day headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
                {DAYS_OF_WEEK.map(d => (
                  <div key={d} style={{ textAlign: 'center', padding: '6px 0', fontSize: 10, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {d}
                  </div>
                ))}
              </div>
              {/* Weeks */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {weeks.map((week, wi) => (
                  <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                    {week.map((day, di) => (
                      <div key={di} style={{ minHeight: 90 }}>
                        {day ? (
                          <DayCell
                            day={day}
                            attendings={attendingMap[toISODate(day)] ?? []}
                            assignments={assignMap[toISODate(day)] ?? []}
                            isHoliday={!!holidayMap[toISODate(day)]}
                            holidayName={holidayMap[toISODate(day)]}
                            flag={flagMap[toISODate(day)] ?? null}
                          />
                        ) : (
                          <div style={{ height: '100%', minHeight: 90, borderRadius: 12, background: '#F8FAFC', border: '1px solid #F1F5F9' }} />
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </motion.div>

        {/* Footer */}
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#CBD5E1', fontSize: 12 }}>
          Generated by MedRota · medrota.app
        </div>
      </div>
    </div>
  );
}
