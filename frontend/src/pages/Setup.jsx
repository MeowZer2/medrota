import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import api from '../api/axios';
import { useUser } from '../context/AppContext';

// ── helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const SPECIALTIES = [
  'Internal Medicine', 'Surgery', 'Pediatrics', 'Emergency Medicine',
  'Obstetrics & Gynecology', 'Psychiatry', 'Family Medicine', 'Anesthesiology',
  'Radiology', 'Neurology', 'Orthopedics', 'Cardiology', 'Other',
];

// ── Spinner ────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="w-4 h-4 rounded-full border-2 animate-spin inline-block"
      style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
  );
}

// ── Step indicator ─────────────────────────────────────────────────────────────

function StepDots({ step }) {
  return (
    <div className="flex items-center gap-2 justify-center mb-8">
      {[1, 2, 3].map(s => (
        <motion.div
          key={s}
          animate={{
            width: s === step ? 24 : 8,
            background: s === step ? '#1A3A5C' : s < step ? '#4A8FC0' : '#CBD5E1',
          }}
          transition={{ duration: 0.3 }}
          style={{ height: 8, borderRadius: 4 }}
        />
      ))}
    </div>
  );
}

// ── Block list (Step 3) ────────────────────────────────────────────────────────

function BlockGrid({ blocks }) {
  return (
    <div className="grid grid-cols-1 gap-2 max-h-72 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
      {blocks.map((b, i) => (
        <motion.div
          key={b.id}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.04, duration: 0.2 }}
          className="flex items-center gap-3 px-3 py-2 rounded-lg"
          style={{ background: '#F0F5FF', border: '1px solid #D6E4F7' }}
        >
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
            style={{ background: 'linear-gradient(135deg, #1A3A5C, #2C5F8A)', color: '#fff' }}
          >
            {b.number}
          </span>
          <span className="text-[13px] font-medium flex-1" style={{ color: '#1A3A5C' }}>Block {b.number}</span>
          <span className="text-[11px]" style={{ color: '#64748B' }}>
            {fmtDate(b.startDate)} – {fmtDate(b.endDate)}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

// ── Celebration confetti burst ─────────────────────────────────────────────────

function Confetti() {
  const pieces = Array.from({ length: 18 }, (_, i) => ({
    id: i,
    x: Math.random() * 360 - 180,
    y: -(80 + Math.random() * 120),
    rotate: Math.random() * 360,
    color: ['#1A3A5C', '#4A8FC0', '#16A34A', '#D97706', '#7C3AED', '#DC2626'][i % 6],
  }));
  return (
    <div style={{ position: 'absolute', top: '50%', left: '50%', pointerEvents: 'none' }}>
      {pieces.map(p => (
        <motion.div
          key={p.id}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
          animate={{ x: p.x, y: p.y, opacity: 0, rotate: p.rotate, scale: 0.3 }}
          transition={{ duration: 1.2, ease: 'easeOut', delay: p.id * 0.03 }}
          style={{
            position: 'absolute',
            width: 8, height: 8,
            borderRadius: 2,
            background: p.color,
          }}
        />
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Setup() {
  const navigate = useNavigate();
  const { refreshContext } = useUser();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  // Step 1 fields
  const [orgName, setOrgName] = useState('');
  const [country, setCountry] = useState('');

  // Step 2 fields
  const [programName, setProgramName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(6); d.setDate(1);
    return d.toISOString().slice(0, 10);
  });

  // Created data
  const [orgId, setOrgId] = useState(null);
  const [createdBlocks, setCreatedBlocks] = useState([]);

  // ── Step 1: create org ───────────────────────────────────────────────────────

  async function handleCreateOrg(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/organizations', { name: orgName, country });
      setOrgId(data.organization.id);
      setStep(2);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create organization');
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: create program ───────────────────────────────────────────────────

  async function handleCreateProgram(e) {
    e.preventDefault();
    if (!specialty) { toast.error('Please select a specialty'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/programs', { name: programName, specialty, orgId, startDate });
      setCreatedBlocks(data.blocks);
      setShowConfetti(true);
      setStep(3);
      setTimeout(() => setShowConfetti(false), 1500);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create program');
    } finally {
      setLoading(false);
    }
  }

  // ── Go to dashboard ──────────────────────────────────────────────────────────

  async function handleDone() {
    setLoading(true);
    try {
      await refreshContext();
    } finally {
      setLoading(false);
    }
    navigate('/dashboard');
  }

  // ── Shared input style ───────────────────────────────────────────────────────

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 10,
    border: '1.5px solid #E2E8F0', fontSize: 13, color: '#1A3A5C',
    background: '#F8FAFC', outline: 'none', boxSizing: 'border-box',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  };
  const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #F8FBFF 0%, #EEF4FF 40%, #F0F7FF 100%)' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="w-full max-w-md"
        style={{ padding: '0 16px' }}
      >
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: '#fff',
            boxShadow: '0 20px 60px rgba(26,58,92,0.12), 0 4px 16px rgba(26,58,92,0.06)',
            border: '1px solid rgba(214,228,247,0.8)',
          }}
        >
          {/* Gradient bar */}
          <div style={{ height: 4, background: 'linear-gradient(90deg, #1A3A5C 0%, #2C5F8A 50%, #4A8FC0 100%)' }} />

          <div style={{ padding: '36px 32px 32px' }}>
            {/* Header */}
            <div className="text-center mb-2">
              <div
                className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-4"
                style={{ background: 'linear-gradient(135deg, #1A3A5C 0%, #2C5F8A 100%)', boxShadow: '0 8px 24px rgba(26,58,92,0.25)' }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1A3A5C', letterSpacing: '-0.5px', margin: 0 }}>
                {step === 3 ? "You're all set!" : 'Set up MedRota'}
              </h1>
              <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>
                {step === 1 && 'Create your organization'}
                {step === 2 && 'Set up your residency program'}
                {step === 3 && '13 blocks are ready to go'}
              </p>
            </div>

            <StepDots step={step} />

            <AnimatePresence mode="wait">
              {/* ── Step 1 ── */}
              {step === 1 && (
                <motion.form
                  key="step1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.22 }}
                  onSubmit={handleCreateOrg}
                  style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                >
                  <div>
                    <label style={labelStyle}>Organization / Hospital name</label>
                    <input
                      style={inputStyle}
                      value={orgName}
                      onChange={e => setOrgName(e.target.value)}
                      placeholder="e.g. St. Mary's Medical Center"
                      required
                      onFocus={e => { e.target.style.border = '1.5px solid #2C5F8A'; e.target.style.boxShadow = '0 0 0 3px rgba(44,95,138,0.12)'; }}
                      onBlur={e => { e.target.style.border = '1.5px solid #E2E8F0'; e.target.style.boxShadow = 'none'; }}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Country</label>
                    <input
                      style={inputStyle}
                      value={country}
                      onChange={e => setCountry(e.target.value)}
                      placeholder="e.g. United States"
                      required
                      onFocus={e => { e.target.style.border = '1.5px solid #2C5F8A'; e.target.style.boxShadow = '0 0 0 3px rgba(44,95,138,0.12)'; }}
                      onBlur={e => { e.target.style.border = '1.5px solid #E2E8F0'; e.target.style.boxShadow = 'none'; }}
                    />
                  </div>
                  <motion.button
                    type="submit"
                    disabled={loading}
                    whileHover={!loading ? { scale: 1.02 } : {}}
                    whileTap={!loading ? { scale: 0.97 } : {}}
                    style={{
                      marginTop: 4, padding: '12px', borderRadius: 10, border: 'none',
                      background: 'linear-gradient(135deg, #1A3A5C 0%, #2C5F8A 100%)',
                      color: '#fff', fontSize: 14, fontWeight: 600,
                      cursor: loading ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      boxShadow: '0 4px 16px rgba(26,58,92,0.3)',
                    }}
                  >
                    {loading ? <><Spinner /> Creating…</> : 'Continue →'}
                  </motion.button>
                </motion.form>
              )}

              {/* ── Step 2 ── */}
              {step === 2 && (
                <motion.form
                  key="step2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.22 }}
                  onSubmit={handleCreateProgram}
                  style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                >
                  <div>
                    <label style={labelStyle}>Program name</label>
                    <input
                      style={inputStyle}
                      value={programName}
                      onChange={e => setProgramName(e.target.value)}
                      placeholder="e.g. Internal Medicine Residency"
                      required
                      onFocus={e => { e.target.style.border = '1.5px solid #2C5F8A'; e.target.style.boxShadow = '0 0 0 3px rgba(44,95,138,0.12)'; }}
                      onBlur={e => { e.target.style.border = '1.5px solid #E2E8F0'; e.target.style.boxShadow = 'none'; }}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Specialty</label>
                    <select
                      style={{ ...inputStyle, appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748B' strokeWidth='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                      value={specialty}
                      onChange={e => setSpecialty(e.target.value)}
                      onFocus={e => { e.target.style.border = '1.5px solid #2C5F8A'; e.target.style.boxShadow = '0 0 0 3px rgba(44,95,138,0.12)'; }}
                      onBlur={e => { e.target.style.border = '1.5px solid #E2E8F0'; e.target.style.boxShadow = 'none'; }}
                    >
                      <option value="">Select specialty…</option>
                      {SPECIALTIES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Academic year start date</label>
                    <input
                      type="date"
                      style={inputStyle}
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      required
                      onFocus={e => { e.target.style.border = '1.5px solid #2C5F8A'; e.target.style.boxShadow = '0 0 0 3px rgba(44,95,138,0.12)'; }}
                      onBlur={e => { e.target.style.border = '1.5px solid #E2E8F0'; e.target.style.boxShadow = 'none'; }}
                    />
                    <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                      13 blocks × 4 weeks will be generated from this date
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      style={{
                        flex: '0 0 auto', padding: '12px 16px', borderRadius: 10,
                        border: '1.5px solid #E2E8F0', background: '#F8FAFC',
                        color: '#64748B', fontSize: 14, fontWeight: 500, cursor: 'pointer',
                      }}
                    >
                      ← Back
                    </button>
                    <motion.button
                      type="submit"
                      disabled={loading}
                      whileHover={!loading ? { scale: 1.02 } : {}}
                      whileTap={!loading ? { scale: 0.97 } : {}}
                      style={{
                        flex: 1, padding: '12px', borderRadius: 10, border: 'none',
                        background: 'linear-gradient(135deg, #1A3A5C 0%, #2C5F8A 100%)',
                        color: '#fff', fontSize: 14, fontWeight: 600,
                        cursor: loading ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        boxShadow: '0 4px 16px rgba(26,58,92,0.3)',
                      }}
                    >
                      {loading ? <><Spinner /> Creating blocks…</> : 'Generate schedule →'}
                    </motion.button>
                  </div>
                </motion.form>
              )}

              {/* ── Step 3 ── */}
              {step === 3 && (
                <motion.div
                  key="step3"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.22 }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'relative' }}
                >
                  {showConfetti && <Confetti />}

                  <div
                    className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span style={{ fontSize: 13, color: '#15803D', fontWeight: 500 }}>
                      {createdBlocks.length} blocks created successfully
                    </span>
                  </div>

                  <BlockGrid blocks={createdBlocks} />

                  <motion.button
                    onClick={handleDone}
                    disabled={loading}
                    whileHover={!loading ? { scale: 1.02 } : {}}
                    whileTap={!loading ? { scale: 0.97 } : {}}
                    style={{
                      marginTop: 4, padding: '12px', borderRadius: 10, border: 'none',
                      background: 'linear-gradient(135deg, #1A3A5C 0%, #2C5F8A 100%)',
                      color: '#fff', fontSize: 14, fontWeight: 600,
                      cursor: loading ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      boxShadow: '0 4px 16px rgba(26,58,92,0.3)',
                    }}
                  >
                    {loading ? <><Spinner /> Loading…</> : 'Go to Dashboard →'}
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
