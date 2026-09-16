import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import api from '../api/axios';
import { useUser } from '../context/AppContext';
import { MEDICAL_SPECIALTIES } from '../constants/medicalSpecialties';

// ── helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Spinner ────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="w-4 h-4 rounded-full border-2 animate-spin inline-block"
      style={{ borderColor: 'var(--on-brand-track)', borderTopColor: 'var(--on-brand)' }} />
  );
}

// ── Step indicator ─────────────────────────────────────────────────────────────

function StepDots({ step }) {
  if (step < 1) return null;
  return (
    <div className="flex items-center gap-2 justify-center mb-8">
      {[1, 2, 3].map(s => (
        <motion.div
          key={s}
          animate={{
            width: s === step ? 24 : 8,
            background: s === step ? 'var(--brand)' : s < step ? 'var(--accent-bright)' : 'var(--border-strong)',
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
          style={{ background: 'var(--accent-soft-2)', border: '1px solid var(--accent-border)' }}
        >
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--brand), var(--accent))', color: 'var(--ink-inverse)' }}
          >
            {b.number}
          </span>
          <span className="text-[13px] font-medium flex-1" style={{ color: 'var(--ink-1)' }}>Block {b.number}</span>
          <span className="text-[11px]" style={{ color: 'var(--ink-4)' }}>
            {fmtDate(b.startDate)} – {fmtDate(b.endDate)}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Setup() {
  const navigate = useNavigate();
  const { refreshContext } = useUser();

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

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
      setStep(3);
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
    const first = [...createdBlocks].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))[0];
    navigate(first ? `/blocks/${first.number}?blockId=${encodeURIComponent(first.id)}` : '/dashboard');
  }

  // ── Shared input style ───────────────────────────────────────────────────────

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 10,
    border: '1.5px solid var(--border-2)', fontSize: 13, color: 'var(--ink-1)',
    background: 'var(--surface-2)', outline: 'none', boxSizing: 'border-box',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  };
  const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ background: 'linear-gradient(135deg, var(--accent-soft-2) 0%, var(--accent-soft) 40%, var(--accent-soft-2) 100%)' }}
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
            background: 'var(--surface-1)',
            boxShadow: 'var(--shadow-lg)',
            border: '1px solid var(--accent-border)',
          }}
        >
          {/* Gradient bar */}
          <div style={{ height: 4, background: 'linear-gradient(90deg, var(--brand) 0%, var(--accent) 50%, var(--accent-bright) 100%)' }} />

          <div style={{ padding: '36px 32px 32px' }}>
            {/* Header */}
            <div className="text-center mb-2">
              <div
                className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-4"
                style={{ background: 'linear-gradient(135deg, var(--brand) 0%, var(--accent) 100%)', boxShadow: 'var(--shadow-md)' }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--on-brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink-1)', letterSpacing: '-0.5px', margin: 0 }}>
                {step === 0 ? 'You are not in a program yet' : step === 3 ? 'Program created' : 'Set up MedRota'}
              </h1>
              <p style={{ fontSize: 12, color: 'var(--ink-5)', marginTop: 4 }}>
                {step === 0 && 'Choose how you want to get started'}
                {step === 1 && 'Create your organization'}
                {step === 2 && 'Set up your residency program'}
                {step === 3 && 'Empty blocks are ready for schedule preparation'}
              </p>
            </div>

            <StepDots step={step} />

            <AnimatePresence mode="wait">
              {/* ── Step 0: how do you want to get started? ── */}
              {step === 0 && (
                <motion.div
                  key="step0"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.22 }}
                  data-testid="setup-choice"
                  style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                >
                  <div style={{ padding: 16, borderRadius: 12, background: 'var(--accent-soft-2)', border: '1px solid var(--accent-border)' }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-1)', margin: 0 }}>
                      Your program already uses MedRota?
                    </p>
                    <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.55 }}>
                      Ask your Program Admin for an invitation link. Opening it will add you to the program with
                      the right level of access, and nothing needs setting up here.
                    </p>
                  </div>

                  <div style={{ padding: 16, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border-1)' }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-1)', margin: 0 }}>
                      Starting a new program?
                    </p>
                    <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.55 }}>
                      Create your organization and residency program. You will become its Program Admin and can
                      invite everyone else.
                    </p>
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      data-testid="setup-create-program"
                      style={{
                        marginTop: 12, width: '100%', padding: '11px', borderRadius: 10, border: 'none',
                        background: 'var(--brand)', color: 'var(--ink-inverse)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      Create a new program
                    </button>
                  </div>
                </motion.div>
              )}

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
                      onFocus={e => { e.target.style.border = '1.5px solid var(--accent)'; e.target.style.boxShadow = 'var(--focus-ring)'; }}
                      onBlur={e => { e.target.style.border = '1.5px solid var(--border-2)'; e.target.style.boxShadow = 'none'; }}
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
                      onFocus={e => { e.target.style.border = '1.5px solid var(--accent)'; e.target.style.boxShadow = 'var(--focus-ring)'; }}
                      onBlur={e => { e.target.style.border = '1.5px solid var(--border-2)'; e.target.style.boxShadow = 'none'; }}
                    />
                  </div>
                  <motion.button
                    type="submit"
                    disabled={loading}
                    whileHover={!loading ? { scale: 1.02 } : {}}
                    whileTap={!loading ? { scale: 0.97 } : {}}
                    style={{
                      marginTop: 4, padding: '12px', borderRadius: 10, border: 'none',
                      background: 'linear-gradient(135deg, var(--brand) 0%, var(--accent) 100%)',
                      color: 'var(--ink-inverse)', fontSize: 14, fontWeight: 600,
                      cursor: loading ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      boxShadow: 'var(--shadow-md)',
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
                    <label style={labelStyle}>Program display name</label>
                    <input
                      style={inputStyle}
                      value={programName}
                      onChange={e => setProgramName(e.target.value)}
                      placeholder="e.g. Internal Medicine Residency"
                      required
                      onFocus={e => { e.target.style.border = '1.5px solid var(--accent)'; e.target.style.boxShadow = 'var(--focus-ring)'; }}
                      onBlur={e => { e.target.style.border = '1.5px solid var(--border-2)'; e.target.style.boxShadow = 'none'; }}
                    />
                    <p style={{ fontSize: 11, color: 'var(--ink-5)', marginTop: 4 }}>
                      The name used throughout MedRota, such as “McMaster Vascular Surgery Residency.”
                    </p>
                  </div>
                  <div>
                    <label style={labelStyle}>Primary specialty</label>
                    <select
                      style={{ ...inputStyle, appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748B' strokeWidth='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                      value={specialty}
                      onChange={e => {
                        const value = e.target.value;
                        setSpecialty(value);
                        if (!programName.trim() && value) setProgramName(`${value} Residency`);
                      }}
                      onFocus={e => { e.target.style.border = '1.5px solid var(--accent)'; e.target.style.boxShadow = 'var(--focus-ring)'; }}
                      onBlur={e => { e.target.style.border = '1.5px solid var(--border-2)'; e.target.style.boxShadow = 'none'; }}
                    >
                      <option value="">Select specialty…</option>
                      {MEDICAL_SPECIALTIES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <p style={{ fontSize: 11, color: 'var(--ink-5)', marginTop: 4 }}>The program’s main specialty.</p>
                  </div>
                  <div>
                    <label style={labelStyle}>Academic year start date</label>
                    <input
                      type="date"
                      style={inputStyle}
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      required
                      onFocus={e => { e.target.style.border = '1.5px solid var(--accent)'; e.target.style.boxShadow = 'var(--focus-ring)'; }}
                      onBlur={e => { e.target.style.border = '1.5px solid var(--border-2)'; e.target.style.boxShadow = 'none'; }}
                    />
                    <p style={{ fontSize: 11, color: 'var(--ink-5)', marginTop: 4 }}>
                      13 blocks × 4 weeks will be generated from this date
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      style={{
                        flex: '0 0 auto', padding: '12px 16px', borderRadius: 10,
                        border: '1.5px solid var(--border-2)', background: 'var(--surface-2)',
                        color: 'var(--ink-4)', fontSize: 14, fontWeight: 500, cursor: 'pointer',
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
                        background: 'linear-gradient(135deg, var(--brand) 0%, var(--accent) 100%)',
                        color: 'var(--ink-inverse)', fontSize: 14, fontWeight: 600,
                        cursor: loading ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        boxShadow: 'var(--shadow-md)',
                      }}
                    >
                      {loading ? <><Spinner /> Creating blocks…</> : 'Create program and blocks →'}
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
                  <div
                    className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: 'var(--success-soft)', border: '1px solid var(--success-border)' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span style={{ fontSize: 13, color: 'var(--success-ink)', fontWeight: 500 }}>
                      {createdBlocks.length} blocks created successfully
                    </span>
                  </div>

                  <BlockGrid blocks={createdBlocks} />
                  <p style={{ color: 'var(--ink-3)', fontSize: 13, lineHeight: 1.5 }}>Next: add or confirm residents, set up your attending roster and weekly pattern, then prepare your first block. No call schedule has been generated yet.</p>

                  <motion.button
                    onClick={handleDone}
                    disabled={loading}
                    whileHover={!loading ? { scale: 1.02 } : {}}
                    whileTap={!loading ? { scale: 0.97 } : {}}
                    style={{
                      marginTop: 4, padding: '12px', borderRadius: 10, border: 'none',
                      background: 'linear-gradient(135deg, var(--brand) 0%, var(--accent) 100%)',
                      color: 'var(--ink-inverse)', fontSize: 14, fontWeight: 600,
                      cursor: loading ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      boxShadow: 'var(--shadow-md)',
                    }}
                  >
                    {loading ? <><Spinner /> Loading…</> : 'Prepare first block →'}
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
