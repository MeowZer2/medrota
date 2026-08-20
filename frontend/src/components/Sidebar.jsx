import { memo, useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useBlock, useUser } from '../context/AppContext';
import api from '../api/axios';

// â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getInitials(name) {
  if (!name) return 'DR';
  const parts = name.split(/[@.\s]/);
  return parts.filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
}

function yearLabel(ay) {
  const start = new Date(ay.startDate);
  const end   = new Date(ay.endDate);
  return `${start.getFullYear()}-${end.getFullYear()}`;
}

function isBlockCurrent(block) {
  const today = new Date();
  return today >= new Date(block.startDate) && today <= new Date(block.endDate);
}

function fmtBlockDateRange(block) {
  const opts = { month: 'short', day: 'numeric' };
  const s = new Date(block.startDate).toLocaleDateString('en-GB', opts);
  const e = new Date(block.endDate).toLocaleDateString('en-GB', opts);
  return `${s} - ${e}`;
}

// â”€â”€ icons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function GearIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function PlusSmIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function PeopleIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// â”€â”€ nav data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const NAV_LINKS = [
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
];

const PROGRAM_LINKS = [
  {
    label: 'Residents',
    path: '/residents',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    label: 'Attending Schedule',
    path: '/attending',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
];

// â”€â”€ NavItem â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function NavItem({ label, icon, isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 rounded-lg relative overflow-hidden"
      style={{
        height: 36,
        paddingLeft: 12,
        paddingRight: 12,
        fontSize: 13,
        fontWeight: isActive ? 600 : 400,
        color: isActive ? '#1A3A5C' : '#5A7A9A',
        background: isActive ? '#EEF4FF' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#F0F5FF'; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
    >
      <AnimatePresence>
        {isActive && (
          <motion.div
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: 1, opacity: 1 }}
            exit={{ scaleY: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            style={{
              position: 'absolute', left: 0, top: '15%', bottom: '15%',
              width: 3, borderRadius: '0 3px 3px 0',
              background: 'linear-gradient(180deg, #2C5F8A 0%, #1A3A5C 100%)',
              transformOrigin: 'center',
            }}
          />
        )}
      </AnimatePresence>
      <span style={{ paddingLeft: isActive ? 5 : 0, transition: 'padding 0.15s' }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// â”€â”€ YearSwitcher (dropdown, always visible) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function YearSwitcher({ years, current, onChange, onAddYear, addingYear }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!years || years.length === 0) return null;

  return (
    <div ref={ref} className="relative px-2 mb-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5"
        style={{
          background: '#F0F5FF', border: '1px solid #D6E4F7',
          cursor: 'pointer', fontSize: 11, fontWeight: 600,
          color: '#4A6FA5', letterSpacing: '0.02em',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#E4EDFF'}
        onMouseLeave={e => e.currentTarget.style.background = '#F0F5FF'}
      >
        <span>{current ? yearLabel(current) : '-'}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'absolute', top: '110%', left: 8, right: 8, zIndex: 50,
              background: '#fff', borderRadius: 10, border: '1px solid #E8EFF6',
              boxShadow: '0 8px 24px rgba(26,58,92,0.12)',
              overflow: 'hidden',
            }}
          >
            {years.map(ay => (
              <button
                key={ay.id}
                onClick={() => { onChange(ay); setOpen(false); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 12px',
                  fontSize: 12, fontWeight: ay.id === current?.id ? 700 : 400,
                  color: ay.id === current?.id ? '#1A3A5C' : '#5A7A9A',
                  background: ay.id === current?.id ? '#EEF4FF' : 'transparent',
                  border: 'none', cursor: 'pointer', display: 'block',
                }}
                onMouseEnter={e => { if (ay.id !== current?.id) e.currentTarget.style.background = '#F0F5FF'; }}
                onMouseLeave={e => { if (ay.id !== current?.id) e.currentTarget.style.background = 'transparent'; }}
              >
                {yearLabel(ay)}
                {ay.id === current?.id && <span style={{ marginLeft: 6, fontSize: 10, color: '#2C5F8A' }}>*</span>}
              </button>
            ))}
            {onAddYear && (
            <div style={{ borderTop: '1px solid #E8EFF6' }}>
              <button
                onClick={() => { setOpen(false); onAddYear(); }}
                disabled={addingYear}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 12px',
                  fontSize: 11, fontWeight: 600, color: addingYear ? '#CBD5E1' : '#2C5F8A',
                  background: 'transparent', border: 'none', cursor: addingYear ? 'default' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
                onMouseEnter={e => { if (!addingYear) e.currentTarget.style.background = '#F0F5FF'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <PlusSmIcon />
                {addingYear ? 'Adding...' : '+ Add year'}
              </button>
            </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// â”€â”€ Sidebar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const Sidebar = memo(function Sidebar({ userName }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentProgram, currentUser, currentRoleLabel, refreshContext, can } = useUser();
  const { currentBlock, setCurrentBlock, academicYears, currentAcademicYear, setCurrentAcademicYear } = useBlock();

  const [programOpen, setProgramOpen] = useState(false);
  const [tooltip, setTooltip] = useState(null);
  const [addingYear, setAddingYear] = useState(false);
  const [hoveredBlock, setHoveredBlock] = useState(null);

  const displayName = userName || currentUser?.name || '';
  const blocks = currentAcademicYear?.blocks ?? [];
  const programLinks = PROGRAM_LINKS.filter(link => (
    link.path === '/residents' ? can('edit_residents') :
    link.path === '/attending' ? can('edit_attendings') :
    true
  ));

  // Derive next year's start date from the last academic year
  async function handleAddYear() {
    if (!currentProgram?.programId || !can('create_academic_year')) return;
    setAddingYear(true);
    try {
      const lastYear = academicYears[academicYears.length - 1];
      const nextStart = lastYear
        ? new Date(new Date(lastYear.startDate).setFullYear(new Date(lastYear.startDate).getFullYear() + 1))
        : new Date();
      await api.post('/programs/academic-year', {
        programId: currentProgram.programId,
        startDate: nextStart.toISOString().slice(0, 10),
      });
      await refreshContext();
    } catch (err) {
      console.error('Failed to add year:', err);
    } finally {
      setAddingYear(false);
    }
  }

  return (
    <aside
      className="w-[220px] h-screen bg-white flex flex-col fixed top-0 left-0 z-20"
      style={{ borderRight: '1px solid #E8EFF6' }}
    >
      {/* Logo + program selector */}
      <div className="px-4 pt-5 pb-4" style={{ borderBottom: '1px solid #E8EFF6' }}>
        <button
          onClick={() => navigate('/dashboard')}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          <p style={{ fontSize: 18, fontWeight: 700, color: '#1A3A5C', lineHeight: 1.2 }}>MedRota</p>
        </button>

        <button
          onClick={() => setProgramOpen(o => !o)}
          className="mt-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg w-full transition-colors duration-100"
          style={{ background: '#F0F5FF', color: '#4A6FA5', border: 'none', cursor: 'pointer' }}
          onMouseEnter={e => e.currentTarget.style.background = '#E4EDFF'}
          onMouseLeave={e => e.currentTarget.style.background = '#F0F5FF'}
        >
          <span style={{ fontSize: 12, fontWeight: 500, flex: 1, textAlign: 'left' }}>
            {currentProgram?.programName ?? 'No program'}
          </span>
          <motion.span animate={{ rotate: programOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown />
          </motion.span>
        </button>

        <AnimatePresence>
          {programOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
              style={{ overflow: 'hidden' }}
            >
              <div className="mt-1.5 px-1">
                <p className="px-2 py-1.5 text-xs rounded-lg" style={{ color: '#5A7A9A', background: '#F8FAFC' }}>
                  {currentProgram?.specialty ?? '—'} · {currentRoleLabel ?? '—'}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Top nav */}
      <nav className="px-3 pt-3 pb-2" style={{ borderBottom: '1px solid #E8EFF6' }}>
        <ul className="space-y-0.5">
          {NAV_LINKS.map(link => (
            <li key={link.path}>
              <NavItem
                {...link}
                isActive={location.pathname === link.path}
                onClick={() => navigate(link.path)}
              />
            </li>
          ))}
        </ul>
      </nav>

      {/* Program nav */}
      <nav className="px-3 pt-3 pb-2" style={{ borderBottom: '1px solid #E8EFF6' }}>
        <p className="px-2 mb-1.5" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A0AEBF' }}>
          Program
        </p>
        <ul className="space-y-0.5">
          {programLinks.map(link => (
            <li key={link.path}>
              <NavItem
                {...link}
                isActive={location.pathname === link.path}
                onClick={() => navigate(link.path)}
              />
            </li>
          ))}
        </ul>
      </nav>

      {/* Block navigation */}
      <div className="flex-1 relative min-h-0">
        <nav className="h-full overflow-y-auto py-3 px-3 sidebar-scroll sidebar-fade-bottom">
          <p className="px-2 mb-1" style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A0AEBF' }}>
            Blocks
          </p>

          {/* Year switcher â€” always shown when any years exist */}
          <YearSwitcher
            years={academicYears}
            current={currentAcademicYear}
            onChange={setCurrentAcademicYear}
            onAddYear={can('create_academic_year') ? handleAddYear : undefined}
            addingYear={addingYear}
          />

          <ul className="space-y-0.5">
            {blocks.map((block) => {
              const isUrlMatch =
                location.pathname === `/blocks/${block.number}` ||
                location.pathname.startsWith(`/blocks/${block.number}/`);
              const isContextMatch = currentBlock?.id === block.id;
              const isActive  = isUrlMatch || isContextMatch;
              const isCurrent = isBlockCurrent(block);
              const isHovered = hoveredBlock === block.id;

              return (
                <li key={block.id}
                  onMouseEnter={() => setHoveredBlock(block.id)}
                  onMouseLeave={() => setHoveredBlock(null)}
                >
                  <button
                    onClick={() => {
                      setCurrentBlock(block);
                      navigate(`/blocks/${block.number}/calendar`);
                    }}
                    className="w-full flex items-start justify-between rounded-lg relative overflow-hidden"
                    style={{
                      minHeight: 42,
                      paddingLeft: 12,
                      paddingRight: 12,
                      paddingTop: 6,
                      paddingBottom: 6,
                      fontSize: 13,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? '#1A3A5C' : '#5A7A9A',
                      background: isActive ? '#EEF4FF' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'color 0.15s, background 0.15s',
                      textAlign: 'left',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#F0F5FF'; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <AnimatePresence>
                      {isActive && (
                        <motion.div
                          initial={{ scaleY: 0, opacity: 0 }}
                          animate={{ scaleY: 1, opacity: 1 }}
                          exit={{ scaleY: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          style={{
                            position: 'absolute', left: 0, top: '15%', bottom: '15%',
                            width: 3, borderRadius: '0 3px 3px 0',
                            background: 'linear-gradient(180deg, #2C5F8A 0%, #1A3A5C 100%)',
                          }}
                        />
                      )}
                    </AnimatePresence>
                    <div style={{ paddingLeft: isActive ? 5 : 0, transition: 'padding 0.15s', flex: 1 }}>
                      <span style={{ display: 'block' }}>Block {block.number}</span>
                      <span style={{ display: 'block', fontSize: 10, color: isActive ? '#4A6FA5' : '#A0AEBF', fontWeight: 400, marginTop: 1 }}>
                        {fmtBlockDateRange(block)}
                      </span>
                    </div>
                    {isCurrent && (
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 99, background: '#DCFCE7', color: '#15803D', marginTop: 2, flexShrink: 0 }}>
                        Now
                      </span>
                    )}
                    {/* People icon â€” view residents for this block */}
                    {can('edit_residents') && (isActive || isHovered) && (
                      <span
                        onClick={e => { e.stopPropagation(); setCurrentBlock(block); navigate('/residents'); }}
                        title="View residents for this block"
                        style={{ marginLeft: 2, color: '#A0AEBF', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', padding: '2px 3px', borderRadius: 5 }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#16A34A'; e.currentTarget.style.background = '#DCFCE7'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#A0AEBF'; e.currentTarget.style.background = 'transparent'; }}
                      >
                        <PeopleIcon size={12} />
                      </span>
                    )}
                    {can('edit_block_settings') && isActive && (
                      <span
                        onClick={e => { e.stopPropagation(); navigate(`/blocks/${block.number}/settings`); }}
                        title="Block settings"
                        style={{ marginLeft: 2, color: '#A0AEBF', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', padding: '2px 3px', borderRadius: 5 }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#2C5F8A'; e.currentTarget.style.background = '#E4EDFF'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#A0AEBF'; e.currentTarget.style.background = 'transparent'; }}
                      >
                        <GearIcon size={12} />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}

            {blocks.length === 0 && (
              <li>
                <p style={{ fontSize: 12, color: '#CBD5E1', padding: '8px 12px' }}>No blocks yet</p>
              </li>
            )}
          </ul>
        </nav>
      </div>

      {/* User section */}
      <div className="px-4 py-4" style={{ borderTop: '1px solid #E8EFF6' }}>
        <div className="flex items-center gap-2.5">
          {/* Avatar */}
          <div className="relative">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 cursor-default"
              style={{ background: 'linear-gradient(135deg, #1A3A5C 0%, #2C5F8A 100%)', color: '#fff', fontSize: 11, fontWeight: 700 }}
              onMouseEnter={() => setTooltip('avatar')}
              onMouseLeave={() => setTooltip(null)}
            >
              {getInitials(displayName)}
            </div>
            <AnimatePresence>
              {tooltip === 'avatar' && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  style={{
                    position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)',
                    background: '#1A3A5C', color: '#fff', fontSize: 11, fontWeight: 500,
                    padding: '5px 10px', borderRadius: 8, whiteSpace: 'nowrap',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 100,
                  }}
                >
                  {displayName || 'User'}
                  <div style={{ position: 'absolute', bottom: -4, left: '50%', transform: 'translateX(-50%)', width: 8, height: 8, background: '#1A3A5C', clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex-1 min-w-0">
            <p className="truncate" style={{ fontSize: 13, fontWeight: 500, color: '#1A3A5C', lineHeight: 1.3 }}>
              {displayName || 'User'}
            </p>
            <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>
              {currentRoleLabel ?? 'Member'}
            </p>
          </div>

          {/* Settings */}
          {(can('view_draft_schedule') || can('edit_program_settings') || can('manage_clinical_services') || can('manage_attending_roster')) && (
          <div className="relative shrink-0">
            <button
              aria-label="Program settings"
              className="rounded-lg transition-colors duration-100"
              style={{ color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 34, minHeight: 34 }}
              onMouseEnter={e => { e.currentTarget.style.background = '#F0F5FF'; e.currentTarget.style.color = '#2C5F8A'; setTooltip('settings'); }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94A3B8'; setTooltip(null); }}
              onClick={() => navigate('/settings')}
            >
              <GearIcon />
            </button>
            <AnimatePresence>
              {tooltip === 'settings' && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  style={{
                    position: 'absolute', bottom: 38, right: 0,
                    background: '#1A3A5C', color: '#fff', fontSize: 11, fontWeight: 500,
                    padding: '5px 10px', borderRadius: 8, whiteSpace: 'nowrap',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 100,
                  }}
                >
                  Program settings
                  <div style={{ position: 'absolute', bottom: -4, right: 10, width: 8, height: 8, background: '#1A3A5C', clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          )}

          {/* Logout */}
          <div className="relative shrink-0">
            <button
              aria-label="Log out"
              className="rounded-lg transition-colors duration-100"
              style={{ color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 34, minHeight: 34 }}
              onMouseEnter={e => { e.currentTarget.style.background = '#FEF2F2'; e.currentTarget.style.color = '#DC2626'; setTooltip('logout'); }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94A3B8'; setTooltip(null); }}
              onClick={() => { localStorage.clear(); window.location.href = '/login'; }}
            >
              <LogoutIcon />
            </button>
            <AnimatePresence>
              {tooltip === 'logout' && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  style={{
                    position: 'absolute', bottom: 38, right: 0,
                    background: '#1A3A5C', color: '#fff', fontSize: 11, fontWeight: 500,
                    padding: '5px 10px', borderRadius: 8, whiteSpace: 'nowrap',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 100,
                  }}
                >
                  Log out
                  <div style={{ position: 'absolute', bottom: -4, right: 10, width: 8, height: 8, background: '#1A3A5C', clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </aside>
  );
});

export default Sidebar;
