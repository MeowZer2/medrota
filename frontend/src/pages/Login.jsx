import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import api from '../api/axios';
import { useApp } from '../context/AppContext';

// ── Floating background shapes ─────────────────────────────────────────────

function FloatingShape({ size, x, y, delay, duration }) {
  return (
    <motion.div
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: '40%',
        background: 'linear-gradient(135deg, rgba(44,95,138,0.08) 0%, rgba(26,58,92,0.04) 100%)',
        left: x,
        top: y,
        pointerEvents: 'none',
      }}
      animate={{ y: [0, -20, 0], rotate: [0, 10, 0] }}
      transition={{ duration, delay, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

// ── Spinner ────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div
      className="w-4 h-4 rounded-full border-2 animate-spin inline-block"
      style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }}
    />
  );
}

// ── Eye icon for password toggle ───────────────────────────────────────────

function EyeIcon({ open }) {
  if (open) return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const { refreshContext } = useApp();
  const [form, setForm]     = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [focusedField, setFocusedField] = useState(null);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', form);
      localStorage.setItem('token', data.token);
      refreshContext();
      toast.success('Welcome back!');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #F8FBFF 0%, #EEF4FF 40%, #F0F7FF 100%)' }}
    >
      {/* Floating background shapes */}
      <FloatingShape size={200} x="5%"  y="10%" delay={0}   duration={7} />
      <FloatingShape size={140} x="80%" y="5%"  delay={1.5} duration={9} />
      <FloatingShape size={100} x="70%" y="70%" delay={0.8} duration={8} />
      <FloatingShape size={160} x="10%" y="65%" delay={2}   duration={10} />
      <FloatingShape size={80}  x="50%" y="85%" delay={0.3} duration={6} />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="w-full max-w-sm relative z-10"
        style={{ padding: '0 16px' }}
      >
        {/* Card */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: '#fff',
            boxShadow: '0 20px 60px rgba(26,58,92,0.12), 0 4px 16px rgba(26,58,92,0.06)',
            border: '1px solid rgba(214,228,247,0.8)',
          }}
        >
          {/* Header gradient bar */}
          <div style={{ height: 4, background: 'linear-gradient(90deg, #1A3A5C 0%, #2C5F8A 50%, #4A8FC0 100%)' }} />

          <div style={{ padding: '36px 32px 32px' }}>
            {/* Logo */}
            <div className="text-center mb-8">
              <div
                className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-4"
                style={{ background: 'linear-gradient(135deg, #1A3A5C 0%, #2C5F8A 100%)', boxShadow: '0 8px 24px rgba(26,58,92,0.25)' }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1A3A5C', letterSpacing: '-0.5px', margin: 0 }}>MedRota</h1>
              <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>Smart scheduling for modern residency programs</p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Email */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                  Email address
                </label>
                <motion.div
                  animate={{ scale: focusedField === 'email' ? 1.005 : 1 }}
                  transition={{ duration: 0.15 }}
                  style={{ position: 'relative' }}
                >
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    onFocus={() => setFocusedField('email')}
                    onBlur={() => setFocusedField(null)}
                    placeholder="dr.name@hospital.com"
                    required
                    autoComplete="email"
                    className="premium-input"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: focusedField === 'email' ? '1.5px solid #2C5F8A' : '1.5px solid #E2E8F0',
                      fontSize: 13,
                      color: '#1A3A5C',
                      background: focusedField === 'email' ? '#fff' : '#F8FAFC',
                      outline: 'none',
                      boxShadow: focusedField === 'email' ? '0 0 0 3px rgba(44,95,138,0.12)' : 'none',
                      transition: 'border-color 0.15s, box-shadow 0.15s, background 0.15s',
                      boxSizing: 'border-box',
                    }}
                  />
                </motion.div>
              </div>

              {/* Password */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                  Password
                </label>
                <motion.div
                  animate={{ scale: focusedField === 'password' ? 1.005 : 1 }}
                  transition={{ duration: 0.15 }}
                  style={{ position: 'relative' }}
                >
                  <input
                    type={showPwd ? 'text' : 'password'}
                    name="password"
                    value={form.password}
                    onChange={handleChange}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    style={{
                      width: '100%',
                      padding: '10px 40px 10px 14px',
                      borderRadius: 10,
                      border: focusedField === 'password' ? '1.5px solid #2C5F8A' : '1.5px solid #E2E8F0',
                      fontSize: 13,
                      color: '#1A3A5C',
                      background: focusedField === 'password' ? '#fff' : '#F8FAFC',
                      outline: 'none',
                      boxShadow: focusedField === 'password' ? '0 0 0 3px rgba(44,95,138,0.12)' : 'none',
                      transition: 'border-color 0.15s, box-shadow 0.15s, background 0.15s',
                      boxSizing: 'border-box',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(v => !v)}
                    style={{
                      position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 2,
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#2C5F8A'}
                    onMouseLeave={e => e.currentTarget.style.color = '#94A3B8'}
                  >
                    <EyeIcon open={showPwd} />
                  </button>
                </motion.div>
              </div>

              {/* Submit */}
              <motion.button
                type="submit"
                disabled={loading}
                whileHover={!loading ? { scale: 1.02 } : {}}
                whileTap={!loading ? { scale: 0.97 } : {}}
                style={{
                  marginTop: 4,
                  padding: '12px',
                  borderRadius: 10,
                  border: 'none',
                  background: loading
                    ? 'linear-gradient(135deg, #4A7FA8 0%, #6A9FC8 100%)'
                    : 'linear-gradient(135deg, #1A3A5C 0%, #2C5F8A 100%)',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: loading ? 'none' : '0 4px 16px rgba(26,58,92,0.3)',
                  transition: 'background 0.2s, box-shadow 0.2s',
                }}
              >
                {loading ? <><Spinner /> Signing in…</> : 'Sign in'}
              </motion.button>
            </form>

            <p style={{ textAlign: 'center', fontSize: 13, color: '#64748B', marginTop: 20 }}>
              Don&apos;t have an account?{' '}
              <Link to="/register" style={{ color: '#2C5F8A', fontWeight: 600, textDecoration: 'none' }}
                onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                Register
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p style={{ textAlign: 'center', fontSize: 11, color: '#CBD5E1', marginTop: 20 }}>
          Powered by <span style={{ fontWeight: 600, color: '#94A3B8' }}>MedRota</span> · Secure scheduling platform
        </p>
      </motion.div>
    </div>
  );
}
