import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import api from '../api/axios';
import { useUser } from '../context/AppContext';
import './Login.css';

// ── icons ─────────────────────────────────────────────────────

const Sun = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);
const Moon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);
const Arrow = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);
const EyeOpen = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EyeOff = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

// ── Mini preview calendar (decorative — fixed June 2026 layout) ─

const MINI_DAYS = [
  { kind: 'outside' },
  { d: '02', pips: true },
  { d: '03', pips: true },
  { d: '04', pips: true },
  { d: '05', pips: true },
  { d: '06', kind: 'weekend', pips: true },
  { d: '07', kind: 'weekend', pips: true },

  { d: '08', pips: true },
  { d: '09', pips: true },
  { d: '10', pips: true },
  { d: '11', pips: true },
  { d: '12', pips: true },
  { d: '13', kind: 'weekend', pips: true },
  { d: '14', kind: 'weekend', pips: true },

  { d: '15', pips: true },
  { d: '16', pips: true },
  { d: '17', kind: 'today', pips: true },
  { d: '18', pips: true },
  { d: '19', pips: true },
  { d: '20', kind: 'weekend', pips: true },
  { d: '21', kind: 'unassigned-weekend' },

  { d: '22', kind: 'unassigned' },
  { d: '23', kind: 'unassigned' },
  { d: '24', kind: 'holiday' },
  { d: '25', pips: true },
  { d: '26', pips: true },
  { d: '27', kind: 'weekend', pips: true },
  { d: '28', kind: 'weekend', pips: true },
];

function miniDayClass(k) {
  switch (k) {
    case 'outside':            return 'lg-mini-day outside';
    case 'weekend':            return 'lg-mini-day weekend';
    case 'today':              return 'lg-mini-day today';
    case 'holiday':            return 'lg-mini-day holiday';
    case 'unassigned-weekend': return 'lg-mini-day weekend unassigned';
    case 'unassigned':         return 'lg-mini-day unassigned';
    default:                   return 'lg-mini-day';
  }
}

// ── Theme — local to this page, persisted to its own key ────

const THEME_KEY = 'medrota-login-theme';
function readStoredTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'dark' || v === 'light' ? v : 'light';
  } catch {
    return 'light';
  }
}

// ── Page ──────────────────────────────────────────────────────

export default function Login() {
  const navigate = useNavigate();
  const { refreshContext } = useUser();

  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [theme, setTheme] = useState(readStoredTheme);

  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', form);
      localStorage.setItem('token', data.token);
      const hasProgram = await refreshContext();
      toast.success('Welcome back');
      navigate(hasProgram ? '/dashboard' : '/setup');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lg-page" data-theme={theme}>
      {/* Theme toggle */}
      <div className="lg-theme">
        <div className="lg-theme-pill" role="tablist" aria-label="Color theme">
          <button
            type="button"
            className={theme === 'light' ? 'on' : ''}
            onClick={() => setTheme('light')}
            aria-label="Light theme"
            aria-pressed={theme === 'light'}
            title="Light"
          ><Sun /></button>
          <button
            type="button"
            className={theme === 'dark' ? 'on' : ''}
            onClick={() => setTheme('dark')}
            aria-label="Dark theme"
            aria-pressed={theme === 'dark'}
            title="Dark"
          ><Moon /></button>
        </div>
      </div>

      {/* ── Left: form ─────────────────────────────────────── */}
      <div className="lg-left">
        <div className="lg-brand">
          <div className="lg-mark">M</div>
          <div>
            <div className="lg-brand-name">MedRota</div>
            <div className="lg-brand-sub">Residency scheduling</div>
          </div>
        </div>

        <div className="lg-form-wrap">
          <h1 className="lg-title">Welcome back.</h1>
          <p className="lg-sub">
            Sign in to manage your residency schedule.<br />
            New here? <Link to="/register">Create an account.</Link>
          </p>

          <form onSubmit={handleSubmit} noValidate>
            <div className="lg-field">
              <label className="lg-label" htmlFor="lg-email">Email</label>
              <input
                id="lg-email"
                name="email"
                type="email"
                className="lg-input"
                placeholder="you@hospital.org"
                autoComplete="email"
                value={form.email}
                onChange={handleChange}
                required
              />
            </div>

            <div className="lg-field">
              <div className="lg-field-head">
                <label className="lg-label" htmlFor="lg-password">Password</label>
                <button
                  type="button"
                  className="lg-forgot"
                  onClick={() => toast('Password reset coming soon')}
                >
                  Forgot?
                </button>
              </div>
              <div className="lg-input-wrap">
                <input
                  id="lg-password"
                  name="password"
                  type={showPwd ? 'text' : 'password'}
                  className="lg-input has-toggle"
                  placeholder="••••••••••"
                  autoComplete="current-password"
                  value={form.password}
                  onChange={handleChange}
                  required
                />
                <button
                  type="button"
                  className="lg-eye"
                  onClick={() => setShowPwd((v) => !v)}
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                  title={showPwd ? 'Hide password' : 'Show password'}
                >
                  {showPwd ? <EyeOff /> : <EyeOpen />}
                </button>
              </div>
            </div>

            <button type="submit" className="lg-submit" disabled={loading}>
              {loading ? <><span className="lg-spinner" /> Signing in…</> : <>Sign in <Arrow /></>}
            </button>
          </form>

          <div className="lg-divider">or continue with</div>

          <button
            type="button"
            className="lg-sso"
            onClick={() => toast('Google SSO not configured yet')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M21.35 11.1H12v2.83h5.36c-.23 1.5-1.62 4.4-5.36 4.4-3.23 0-5.86-2.67-5.86-5.96s2.63-5.96 5.86-5.96c1.84 0 3.07.78 3.77 1.45l2.57-2.47C16.78 4.04 14.6 3 12 3 6.99 3 3 6.99 3 12s3.99 9 9 9c5.19 0 8.64-3.65 8.64-8.78 0-.59-.06-1.04-.14-1.49z" />
            </svg>
            Sign in with Google
          </button>
          <button
            type="button"
            className="lg-sso"
            onClick={() => toast('Open the invite link your program shared with you')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8"  x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
            Join with invite link
          </button>

          <p className="lg-foot-text">
            Need a hand? <a href="mailto:support@medrota.app">Talk to support</a>
          </p>
        </div>

        <div className="lg-legal">
          <span>© 2026 MedRota · v1.0</span>
          <span>
            <a href="#" onClick={(e) => e.preventDefault()}>Privacy</a>
            {' · '}
            <a href="#" onClick={(e) => e.preventDefault()}>Terms</a>
          </span>
        </div>
      </div>

      {/* ── Right: pitch + calendar preview ────────────────── */}
      <div className="lg-right" aria-hidden="true">
        <div className="lg-pitch">
          <div className="lg-pitch-eyebrow">
            <span className="pip" />
            Now serving residency programs everywhere
          </div>
          <h2>Schedules residents can trust. Done in minutes, not weekends.</h2>
          <p>
            Generate a balanced call rotation in seconds. Resolve conflicts before they
            happen. Share read-only links your team can check from a phone.
          </p>
          <div className="lg-stats">
            <div className="lg-stat"><div className="v">98%</div><div className="l">Auto-fill on first try</div></div>
            <div className="lg-stat"><div className="v">12s</div><div className="l">Avg generation time</div></div>
            <div className="lg-stat"><div className="v">0</div><div className="l">Spreadsheets harmed</div></div>
          </div>
        </div>

        <div className="lg-preview">
          <div className="lg-preview-head">
            <div className="name">Block 3 · June 2026</div>
            <div className="meta">28 days · 9 residents</div>
          </div>

          <div className="lg-mini-grid">
            {['M','T','W','T','F','S','S'].map((d, i) => (
              <div key={`wd-${i}`} className="lg-mini-wd">{d}</div>
            ))}
            {MINI_DAYS.map((cell, i) => (
              <div key={`d-${i}`} className={miniDayClass(cell.kind)}>
                {cell.d && <span className="n">{cell.d}</span>}
                {cell.pips && (
                  <div className="pips">
                    <span className="pip s" />
                    <span className="pip j" />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="lg-preview-foot">
            <span>● 25 assigned · 3 unassigned</span>
            <span>Published 12m ago</span>
          </div>
        </div>
      </div>
    </div>
  );
}
