import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { ResidentPanel } from '../components/ResidentPanels';
import api from '../api/axios';
import { useApp } from '../context/AppContext';

// Placeholder block date ranges (replace when real block data is wired up)
const BLOCK_DATES = {
  1:  { start: 'Jan 6',  end: 'Feb 2'  },
  2:  { start: 'Feb 3',  end: 'Mar 2'  },
  3:  { start: 'Mar 3',  end: 'Mar 30' },
  4:  { start: 'Mar 31', end: 'Apr 27' },
  5:  { start: 'Apr 28', end: 'May 25' },
  6:  { start: 'May 26', end: 'Jun 22' },
  7:  { start: 'Jun 23', end: 'Jul 20' },
  8:  { start: 'Jul 21', end: 'Aug 17' },
  9:  { start: 'Aug 18', end: 'Sep 14' },
  10: { start: 'Sep 15', end: 'Oct 12' },
  11: { start: 'Oct 13', end: 'Nov 9'  },
  12: { start: 'Nov 10', end: 'Dec 7'  },
  13: { start: 'Dec 8',  end: 'Jan 4'  },
};

const TABS = ['Schedule', 'Residents'];

// ── schedule placeholder ──────────────────────────────────────────────────────

function ScheduleTab({ blockNum }) {
  return (
    <div
      className="rounded-xl flex flex-col items-center justify-center py-20 gap-4"
      style={{ border: '1px solid #E8EFF6', background: '#fff' }}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center"
        style={{ background: '#EEF4FF' }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2C5F8A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </div>
      <div className="text-center">
        <p className="font-semibold" style={{ color: '#1A3A5C' }}>Calendar coming soon</p>
        <p className="text-sm mt-1" style={{ color: '#94A3B8' }}>
          The call schedule for Block {blockNum} will appear here
        </p>
      </div>
    </div>
  );
}

// ── residents tab ─────────────────────────────────────────────────────────────

function ResidentsTab() {
  const { currentProgram } = useApp();
  const programId = currentProgram?.programId ?? null;
  const [residents, setResidents] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!programId) return;
    setLoading(true);
    api.get(`/residents?programId=${programId}`)
      .then(r => setResidents(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [programId]);

  const handleRemove = async (id) => {
    setResidents(prev => prev.filter(r => r.id !== id));
    try { await api.delete(`/residents/${id}`); } catch { /* optimistic */ }
  };

  if (!programId) {
    return (
      <div
        className="rounded-xl flex flex-col items-center justify-center py-16 gap-2"
        style={{ border: '1px solid #FDE68A', background: '#FFFBEB' }}
      >
        <p className="text-sm font-semibold" style={{ color: '#92400E' }}>No program found</p>
        <p className="text-xs" style={{ color: '#B45309' }}>
          Your account is not linked to a program yet.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: '#D6E4F7', borderTopColor: '#2C5F8A' }} />
      </div>
    );
  }

  const seniors     = residents.filter(r => r.residentRole === 'senior' && !r.isMedStudent);
  const juniors     = residents.filter(r => r.residentRole === 'junior' && !r.isMedStudent);
  const medStudents = residents.filter(r => r.isMedStudent);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ResidentPanel title="Senior Residents" accent="#2C5F8A" residents={seniors} onRemove={handleRemove} emptyLabel="No senior residents" />
        <ResidentPanel title="Junior Residents"  accent="#16A34A" residents={juniors}  onRemove={handleRemove} emptyLabel="No junior residents" />
      </div>
      <ResidentPanel title="Medical Students" accent="#D97706" residents={medStudents} onRemove={handleRemove} emptyLabel="No medical students" />
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function BlockPage() {
  const { blockNumber } = useParams();
  const navigate = useNavigate();
  const num = parseInt(blockNumber, 10);
  const dates = BLOCK_DATES[num] ?? { start: '—', end: '—' };
  const [activeTab, setActiveTab] = useState('Residents');

  return (
    <Layout>
      {/* Block header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-[28px] font-semibold leading-tight" style={{ color: '#1A3A5C' }}>
            Block {num}
          </h1>
          {num === 3 && (
            <span
              className="text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ background: '#DCFCE7', color: '#15803D' }}
            >
              Current
            </span>
          )}
        </div>
        <p className="text-sm" style={{ color: '#94A3B8' }}>
          {dates.start} – {dates.end}, 2026
        </p>
        <div className="mt-4 h-px w-48" style={{ background: 'linear-gradient(90deg, #2C5F8A 0%, transparent 100%)' }} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit" style={{ background: '#F0F5FF' }}>
        {TABS.map(tab => {
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200"
              style={{
                background: active ? '#fff' : 'transparent',
                color: active ? '#1A3A5C' : '#5A7A9A',
                fontWeight: active ? 600 : 400,
                boxShadow: active ? '0 1px 3px rgba(26,58,92,0.08)' : '',
              }}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'Schedule' && (
        <div
          className="rounded-xl flex flex-col items-center justify-center py-20 gap-4"
          style={{ border: '1px solid #E8EFF6', background: '#fff' }}
        >
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: '#EEF4FF' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2C5F8A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div className="text-center">
            <p className="font-semibold" style={{ color: '#1A3A5C' }}>View the full calendar</p>
            <p className="text-sm mt-1" style={{ color: '#94A3B8' }}>Open the calendar view for Block {num}</p>
          </div>
          <button
            onClick={() => navigate(`/blocks/${num}/calendar`)}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all duration-200"
            style={{ background: '#1A3A5C' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#2C5F8A'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#1A3A5C'; }}
          >
            Open Calendar →
          </button>
        </div>
      )}
      {activeTab === 'Residents' && <ResidentsTab />}
    </Layout>
  );
}
