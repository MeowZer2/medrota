import { blockPath } from '../lib/blockNavigation';
import { formatBlockDate } from '../lib/blockUtils';
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../api/axios';
import { useBlock, useUser } from '../context/AppContext';
import Layout from '../components/Layout';
import PageWrapper from '../components/PageWrapper';
import EmptyState from '../components/EmptyState';
import BlockSelector from '../components/BlockSelector';

// ── helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso) {
  return formatBlockDate(iso);
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function todayLabel() {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function blockProgress(startIso, endIso) {
  const start = new Date(startIso);
  const end   = new Date(endIso);
  const today = new Date();
  const total   = end - start;
  const elapsed = Math.min(Math.max(today - start, 0), total);
  return Math.round((elapsed / total) * 100);
}

/*
 * A pastel fill alone sits at about 1.3:1 against the card, which is below the
 * 3:1 WCAG 1.4.11 asks of a graphical object. Darkening the fills to 3:1 would
 * have replaced the chart's palette outright, so each band instead carries a
 * 3:1 edge: the bar stays the colour it was and the mark is still clearly
 * bounded. The same pair is used for the legend swatch.
 */
const CHART_BANDS = {
  'var(--danger)': { fill: 'var(--chart-over)', edge: 'var(--chart-over-edge)' },
  'var(--warn)': { fill: 'var(--chart-high)', edge: 'var(--chart-high-edge)' },
  'var(--accent)': { fill: 'var(--chart-normal)', edge: 'var(--chart-normal-edge)' },
};

function callColor(n) {
  if (n >= 9) return { bar: 'var(--danger)', bg: 'var(--danger-soft)' };
  if (n >= 7) return { bar: 'var(--warn)', bg: 'var(--warn-soft)' };
  return { bar: 'var(--accent)', bg: 'var(--accent-soft)' };
}

// ── skeleton ──────────────────────────────────────────────────────────────────

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 min-w-0">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-surface-1 rounded-xl p-5 min-w-0" style={{ border: '1px solid var(--border-1)', borderLeft: '4px solid var(--border-1)' }}>
          <div className="skeleton-shimmer h-8 w-8 rounded-lg mb-3" />
          <div className="skeleton-shimmer h-3 w-20 rounded mb-2" />
          <div className="skeleton-shimmer h-9 w-12 rounded" />
        </div>
      ))}
    </div>
  );
}

// ── animation variants ────────────────────────────────────────────────────────

const staggerContainer = {
  animate: { transition: { staggerChildren: 0.02 } },
};

const fadeSlideUp = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.14, ease: 'easeOut' } },
};

// ── stat card icons ───────────────────────────────────────────────────────────

const STAT_META = [
  {
    key: 'daysInBlock', label: 'Days in block',
    accent: 'var(--accent)', iconBg: 'var(--accent-soft)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    key: 'residents', label: 'Residents',
    accent: 'var(--success)', iconBg: 'var(--success-soft)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    key: 'avgCalls', label: 'Avg calls',
    accent: 'var(--warn)', iconBg: 'var(--warn-soft)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    key: 'warnings', label: 'Warnings',
    accent: 'var(--danger)', iconBg: 'var(--danger-soft)',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
];

// ── helpers for activity feed ─────────────────────────────────────────────────

function fmtActivityTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── component ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate = useNavigate();
  const { currentUser, currentProgram } = useUser();
  const { currentBlock, setCurrentBlock, currentAcademicYear } = useBlock();

  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [barProgress, setBarProgress] = useState(0);
  const [barsVisible, setBarsVisible] = useState(false);

  const fetchStats = useCallback(async (blockId) => {
    setLoadingStats(true);
    setBarsVisible(false);
    try {
      const { data } = await api.get(`/programs/stats?blockId=${blockId}`);
      setStats(data);
      const pct = blockProgress(data.block.startDate, data.block.endDate);
      setTimeout(() => setBarProgress(pct), 50);
      setTimeout(() => setBarsVisible(true), 120);
    } catch {
      setStats(null);
    } finally {
      setLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    if (currentBlock?.id) fetchStats(currentBlock.id);
  }, [currentBlock?.id, fetchStats]);

  const userName = currentUser?.name ?? '';
  const blockNum = currentBlock?.number ?? '—';

  // No program yet
  if (!currentProgram) {
    return (
      <PageWrapper>
        <Layout>
          <EmptyState
            title="No program found"
            description="Complete setup to create your residency program and blocks."
            cta="Go to Setup"
            onCta={() => navigate('/setup')}
          />
        </Layout>
      </PageWrapper>
    );
  }

  const maxCalls = stats?.callDistribution?.length
    ? Math.max(...stats.callDistribution.map(r => r.callCount), 1)
    : 1;

  const progressPct = stats
    ? blockProgress(stats.block.startDate, stats.block.endDate)
    : 0;

  const daysRemaining = stats
    ? stats.daysInBlock - Math.round(stats.daysInBlock * progressPct / 100)
    : 0;

  return (
    <PageWrapper>
      <Layout>
        {/* Hero greeting */}
        <motion.div className="mb-6" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.14, ease: 'easeOut' }}>
          <h1 className="md:text-[28px] text-[22px] font-semibold leading-tight" style={{ color: 'var(--ink-1)' }}>
            {getGreeting()}{userName ? `, ${userName}` : ''}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-5)' }}>{todayLabel()}</p>
          <motion.div
            className="mt-4 h-px"
            initial={{ width: 0 }}
            animate={{ width: 192 }}
            transition={{ duration: 0.16, delay: 0.04, ease: 'easeOut' }}
            style={{ background: 'linear-gradient(90deg, var(--accent) 0%, transparent 100%)' }}
          />
        </motion.div>

        {/* Block selector */}
        {currentAcademicYear?.blocks?.length > 0 && (
          <motion.div className="mb-6" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.14, delay: 0.02, ease: 'easeOut' }}>
            <BlockSelector
              blocks={currentAcademicYear.blocks}
              activeBlockId={currentBlock?.id}
              onSelect={setCurrentBlock}
            />
            {stats && (
              <p className="mt-2 text-xs font-medium" style={{ color: 'var(--ink-5)' }}>
                Showing stats for Block {blockNum} — {formatDate(stats.block.startDate)} to {formatDate(stats.block.endDate)}
              </p>
            )}
          </motion.div>
        )}

        {/* Stats cards */}
        {loadingStats ? <StatsSkeleton /> : (
          <motion.div
            className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 min-w-0"
            variants={staggerContainer}
            initial="initial"
            animate="animate"
          >
            {STAT_META.map((s) => {
              const value = stats ? stats[s.key] : '—';
              return (
                <motion.div
                  key={s.key}
                  variants={fadeSlideUp}
                  whileHover={{ y: -1 }}
                  className="bg-surface-1 rounded-xl p-5 flex flex-col min-w-0"
                  style={{
                    border: '1px solid var(--border-1)',
                    borderLeft: `4px solid ${s.accent}`,
                    boxShadow: 'var(--shadow-xs)',
                    cursor: 'default',
                  }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: s.iconBg }}>
                      {s.icon}
                    </div>
                  </div>
                  <p className="text-[13px] font-medium" style={{ color: 'var(--ink-5)' }}>{s.label}</p>
                  <p style={{ fontSize: 36, fontWeight: 700, color: 'var(--ink-1)', lineHeight: 1.1, marginTop: 4 }}>
                    {value}
                  </p>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* Bottom grid */}
        <motion.div
          className="grid grid-cols-1 md:grid-cols-3 gap-4 min-w-0"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
        >
          {/* Current block card */}
          <motion.div
            variants={fadeSlideUp}
            className="md:col-span-2 rounded-xl p-6 flex flex-col min-w-0"
            style={{
              background: 'linear-gradient(135deg, var(--accent-soft) 0%, var(--surface-1) 60%)',
              border: '1px solid var(--accent-border)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-2 mb-5 min-w-0">
              <div className="min-w-0">
                <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-1)' }}>Current Block</h2>
                <p className="mt-0.5 text-sm" style={{ color: 'var(--accent-muted-2)' }}>
                  {stats
                    ? `Block ${blockNum} — ${formatDate(stats.block.startDate)} → ${formatDate(stats.block.endDate)}`
                    : `Block ${blockNum}`}
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: 'var(--success-soft-2)', color: 'var(--success-ink)' }}>
                Active
              </span>
            </div>

            <div className="mb-6">
              <div className="flex justify-between text-xs mb-2" style={{ color: 'var(--ink-5)' }}>
                <span>{progressPct}% complete</span>
                <span>{daysRemaining} days remaining</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--accent-border)' }}>
                <motion.div
                  className="h-full rounded-full"
                  initial={{ width: '0%' }}
                  animate={{ width: `${barProgress}%` }}
                  transition={{ duration: 0.18, delay: 0.04, ease: 'easeOut' }}
                  style={{ background: 'linear-gradient(90deg, var(--brand) 0%, var(--accent) 100%)' }}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3 mt-auto">
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-on-solid"
                onClick={() => currentBlock && navigate(blockPath(currentBlock))}
                style={{ background: 'var(--brand)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--brand)'; }}
              >
                Prepare block
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                onClick={() => currentBlock && navigate(blockPath(currentBlock, 'calendar'))}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold"
                style={{ background: 'var(--surface-1)', color: 'var(--accent)', border: '1px solid var(--accent-border-3)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-soft)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-1)'; e.currentTarget.style.borderColor = 'var(--accent-border-3)'; }}
              >
                View calendar
              </motion.button>
            </div>
          </motion.div>

          {/* Activity feed */}
          <motion.div
            variants={fadeSlideUp}
            className="rounded-xl p-5 min-w-0"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-1)', boxShadow: 'var(--shadow-xs)' }}
          >
            <h2 className="mb-4" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-1)' }}>Recent activity</h2>
            {loadingStats ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="skeleton-shimmer w-6 h-6 rounded-full shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="skeleton-shimmer h-3 w-3/4 rounded" />
                      <div className="skeleton-shimmer h-2.5 w-1/2 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : stats?.recentActivity?.length ? (
              <ul className="space-y-0">
                {stats.recentActivity.map((a, i) => (
                  <li key={i} className="flex gap-3 relative" style={{ paddingBottom: i < stats.recentActivity.length - 1 ? 16 : 0 }}>
                    {i < stats.recentActivity.length - 1 && (
                      <div style={{ position: 'absolute', left: 11, top: 26, bottom: 0, width: 1, background: 'var(--surface-2)' }} />
                    )}
                    <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 z-10"
                      style={{ background: (a.color ?? 'var(--accent)') + '18', border: `1.5px solid ${(a.color ?? 'var(--accent)')}30`, fontSize: 11 }}>
                      <span>{a.icon ?? '📋'}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--ink-1)' }}>{a.description}</p>
                      <p className="text-xs truncate" style={{ color: 'var(--ink-5)' }}>{a.type?.replace('_', ' ')}</p>
                    </div>
                    <span className="text-xs shrink-0 mt-0.5" style={{ color: 'var(--ink-5)' }}>
                      {fmtActivityTime(a.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--ink-5)', paddingTop: 8 }}>No recent activity yet.</p>
            )}
          </motion.div>

          {/* Call distribution */}
          <motion.div
            variants={fadeSlideUp}
            className="md:col-span-3 rounded-xl p-6 min-w-0"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-1)', boxShadow: 'var(--shadow-xs)' }}
          >
            <h2 className="mb-5" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-1)' }}>
              Call distribution — Block {blockNum}
            </h2>

            {loadingStats ? (
              <div className="flex items-end gap-3">
                {[...Array(7)].map((_, i) => (
                  <div key={i} className="flex flex-col items-center gap-1.5 flex-1">
                    <div className="skeleton-shimmer w-full rounded-t-md" style={{ height: Math.random() * 60 + 20 }} />
                    <div className="skeleton-shimmer h-3 w-10 rounded" />
                  </div>
                ))}
              </div>
            ) : stats?.callDistribution?.length ? (
              <>
                <div className="flex items-end gap-3 min-w-0">
                  {stats.callDistribution.map((r, i) => {
                    const heightPx = Math.round((r.callCount / maxCalls) * 100) * 0.7;
                    const { bar } = callColor(r.callCount);
                    return (
                      <div key={r.residentName} className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                        <span className="text-xs font-semibold" style={{ color: 'var(--ink-1)' }}>{r.callCount}</span>
                        <motion.div
                          className="w-full rounded-t-md"
                          initial={{ height: 0 }}
                          animate={barsVisible ? { height: Math.max(heightPx, 4) } : { height: 0 }}
                          transition={{ duration: 0.16, delay: i * 0.015, ease: 'easeOut' }}
                          style={{
                            background: r.callCount === maxCalls
                              ? 'linear-gradient(180deg, var(--accent) 0%, var(--brand) 100%)'
                              : CHART_BANDS[bar].fill,
                            border: r.callCount === maxCalls ? 'none' : `1px solid ${CHART_BANDS[bar].edge}`,
                          }}
                        />
                        <span className="text-xs truncate w-full text-center" style={{ color: 'var(--ink-5)', fontSize: 11 }}>
                          {r.residentName.split(' ').pop()}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-2 mt-4">
                  {[
                    { band: 'var(--accent)', label: '0–6 calls (normal)' },
                    { band: 'var(--warn)', label: '7–8 calls (high)' },
                    { band: 'var(--danger)', label: '9+ calls (over)' },
                  ].map(l => (
                    <div key={l.label} className="flex items-center gap-1.5">
                      <div style={{
                        width: 10, height: 10, borderRadius: 3,
                        background: CHART_BANDS[l.band].fill,
                        border: `1px solid ${CHART_BANDS[l.band].edge}`,
                      }} />
                      <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>{l.label}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--ink-5)' }}>
                No residents enrolled in this block yet.
              </p>
            )}
          </motion.div>
        </motion.div>
      </Layout>
    </PageWrapper>
  );
}
