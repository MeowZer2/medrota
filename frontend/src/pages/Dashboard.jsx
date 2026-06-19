import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../api/axios';
import { useApp } from '../context/AppContext';
import Layout from '../components/Layout';
import PageWrapper from '../components/PageWrapper';
import EmptyState from '../components/EmptyState';
import BlockSelector from '../components/BlockSelector';

// ── helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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

function callColor(n) {
  if (n >= 9) return { bar: '#DC2626', bg: '#FEF2F2' };
  if (n >= 7) return { bar: '#D97706', bg: '#FFFBEB' };
  return { bar: '#2C5F8A', bg: '#EEF4FF' };
}

// ── skeleton ──────────────────────────────────────────────────────────────────

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-white rounded-xl p-5" style={{ border: '1px solid #E8EFF6', borderLeft: '4px solid #E8EFF6' }}>
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
    accent: '#2C5F8A', iconBg: '#EEF4FF',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2C5F8A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    key: 'residents', label: 'Residents',
    accent: '#16A34A', iconBg: '#F0FDF4',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    key: 'avgCalls', label: 'Avg calls',
    accent: '#D97706', iconBg: '#FFFBEB',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    key: 'warnings', label: 'Warnings',
    accent: '#DC2626', iconBg: '#FEF2F2',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  const { currentUser, currentProgram, currentBlock, setCurrentBlock, currentAcademicYear } = useApp();

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
          <h1 className="md:text-[28px] text-[22px] font-semibold leading-tight" style={{ color: '#1A3A5C' }}>
            {getGreeting()}{userName ? `, ${userName}` : ''}
          </h1>
          <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>{todayLabel()}</p>
          <motion.div
            className="mt-4 h-px"
            initial={{ width: 0 }}
            animate={{ width: 192 }}
            transition={{ duration: 0.16, delay: 0.04, ease: 'easeOut' }}
            style={{ background: 'linear-gradient(90deg, #2C5F8A 0%, transparent 100%)' }}
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
              <p className="mt-2 text-xs font-medium" style={{ color: '#94A3B8' }}>
                Showing stats for Block {blockNum} — {formatDate(stats.block.startDate)} to {formatDate(stats.block.endDate)}
              </p>
            )}
          </motion.div>
        )}

        {/* Stats cards */}
        {loadingStats ? <StatsSkeleton /> : (
          <motion.div
            className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6"
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
                  className="bg-white rounded-xl p-5 flex flex-col"
                  style={{
                    border: '1px solid #E8EFF6',
                    borderLeft: `4px solid ${s.accent}`,
                    boxShadow: '0 1px 3px rgba(26,58,92,0.05)',
                    cursor: 'default',
                  }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: s.iconBg }}>
                      {s.icon}
                    </div>
                  </div>
                  <p className="text-[13px] font-medium" style={{ color: '#94A3B8' }}>{s.label}</p>
                  <p style={{ fontSize: 36, fontWeight: 700, color: '#1A3A5C', lineHeight: 1.1, marginTop: 4 }}>
                    {value}
                  </p>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* Bottom grid */}
        <motion.div
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
          variants={staggerContainer}
          initial="initial"
          animate="animate"
        >
          {/* Current block card */}
          <motion.div
            variants={fadeSlideUp}
            className="md:col-span-2 rounded-xl p-6 flex flex-col"
            style={{
              background: 'linear-gradient(135deg, #EEF4FF 0%, #ffffff 60%)',
              border: '1px solid #D6E4F7',
              boxShadow: '0 1px 3px rgba(26,58,92,0.06)',
            }}
          >
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 600, color: '#1A3A5C' }}>Current Block</h2>
                <p className="mt-0.5 text-sm" style={{ color: '#5A7A9A' }}>
                  {stats
                    ? `Block ${blockNum} — ${formatDate(stats.block.startDate)} → ${formatDate(stats.block.endDate)}`
                    : `Block ${blockNum}`}
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: '#DCFCE7', color: '#15803D' }}>
                Active
              </span>
            </div>

            <div className="mb-6">
              <div className="flex justify-between text-xs mb-2" style={{ color: '#94A3B8' }}>
                <span>{progressPct}% complete</span>
                <span>{daysRemaining} days remaining</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: '#D6E4F7' }}>
                <motion.div
                  className="h-full rounded-full"
                  initial={{ width: '0%' }}
                  animate={{ width: `${barProgress}%` }}
                  transition={{ duration: 0.18, delay: 0.04, ease: 'easeOut' }}
                  style={{ background: 'linear-gradient(90deg, #1A3A5C 0%, #2C5F8A 100%)' }}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3 mt-auto">
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
                style={{ background: '#1A3A5C' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#2C5F8A'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#1A3A5C'; }}
              >
                Auto-generate
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                onClick={() => currentBlock && navigate(`/blocks/${blockNum}/calendar`)}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold"
                style={{ background: 'white', color: '#2C5F8A', border: '1px solid #C0D5EB' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#EEF4FF'; e.currentTarget.style.borderColor = '#2C5F8A'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#C0D5EB'; }}
              >
                View calendar
              </motion.button>
            </div>
          </motion.div>

          {/* Activity feed */}
          <motion.div
            variants={fadeSlideUp}
            className="rounded-xl p-5"
            style={{ background: '#ffffff', border: '1px solid #E8EFF6', boxShadow: '0 1px 3px rgba(26,58,92,0.05)' }}
          >
            <h2 className="mb-4" style={{ fontSize: 15, fontWeight: 600, color: '#1A3A5C' }}>Recent activity</h2>
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
                      <div style={{ position: 'absolute', left: 11, top: 26, bottom: 0, width: 1, background: '#E8EFF6' }} />
                    )}
                    <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 z-10"
                      style={{ background: (a.color ?? '#2C5F8A') + '18', border: `1.5px solid ${(a.color ?? '#2C5F8A')}30`, fontSize: 11 }}>
                      <span>{a.icon ?? '📋'}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: '#1A3A5C' }}>{a.description}</p>
                      <p className="text-xs truncate" style={{ color: '#94A3B8' }}>{a.type?.replace('_', ' ')}</p>
                    </div>
                    <span className="text-xs shrink-0 mt-0.5" style={{ color: '#CBD5E1' }}>
                      {fmtActivityTime(a.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ fontSize: 13, color: '#94A3B8', paddingTop: 8 }}>No recent activity yet.</p>
            )}
          </motion.div>

          {/* Call distribution */}
          <motion.div
            variants={fadeSlideUp}
            className="md:col-span-3 rounded-xl p-6"
            style={{ background: '#ffffff', border: '1px solid #E8EFF6', boxShadow: '0 1px 3px rgba(26,58,92,0.05)' }}
          >
            <h2 className="mb-5" style={{ fontSize: 15, fontWeight: 600, color: '#1A3A5C' }}>
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
                <div className="flex items-end gap-3">
                  {stats.callDistribution.map((r, i) => {
                    const heightPx = Math.round((r.callCount / maxCalls) * 100) * 0.7;
                    const { bar } = callColor(r.callCount);
                    return (
                      <div key={r.residentName} className="flex flex-col items-center gap-1.5 flex-1">
                        <span className="text-xs font-semibold" style={{ color: '#1A3A5C' }}>{r.callCount}</span>
                        <motion.div
                          className="w-full rounded-t-md"
                          initial={{ height: 0 }}
                          animate={barsVisible ? { height: Math.max(heightPx, 4) } : { height: 0 }}
                          transition={{ duration: 0.16, delay: i * 0.015, ease: 'easeOut' }}
                          style={{
                            background: r.callCount === maxCalls
                              ? 'linear-gradient(180deg, #2C5F8A 0%, #1A3A5C 100%)'
                              : bar === '#DC2626' ? '#FECACA' : bar === '#D97706' ? '#FDE68A' : '#D6E4F7',
                          }}
                        />
                        <span className="text-xs truncate w-full text-center" style={{ color: '#94A3B8', fontSize: 11 }}>
                          {r.residentName.split(' ').pop()}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-4 mt-4">
                  {[
                    { color: '#D6E4F7', label: '0–6 calls (normal)' },
                    { color: '#FDE68A', label: '7–8 calls (high)' },
                    { color: '#FECACA', label: '9+ calls (over)' },
                  ].map(l => (
                    <div key={l.label} className="flex items-center gap-1.5">
                      <div style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />
                      <span style={{ fontSize: 11, color: '#94A3B8' }}>{l.label}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p style={{ fontSize: 13, color: '#94A3B8' }}>
                No residents enrolled in this block yet.
              </p>
            )}
          </motion.div>
        </motion.div>
      </Layout>
    </PageWrapper>
  );
}
