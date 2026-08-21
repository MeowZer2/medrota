import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import api from '../api/axios';
import { useUser } from '../context/AppContext';

// Registration asks for a name, an email and a password. Everything else about
// a user comes from their invitation or from the program they create, so it is
// not guessed at here.
export default function Register() {
  const navigate = useNavigate();
  const { refreshContext } = useUser();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite') ?? '';
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 10) {
      setError('Password must be at least 10 characters');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', { ...form, ...(inviteToken ? { inviteToken } : {}) });
      // Sign straight in rather than asking for the same credentials again.
      localStorage.setItem('token', data.token);
      const hasProgram = await refreshContext();
      navigate(hasProgram ? '/dashboard' : '/setup');
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>MedRota</h1>
        <h2 style={styles.subtitle}>Create an account</h2>

        {error && <p style={styles.error}>{error}</p>}

        <form onSubmit={handleSubmit} style={styles.form}>
          <label htmlFor="rg-name" style={styles.label}>Name</label>
          <input
            id="rg-name"
            style={styles.input}
            type="text"
            name="name"
            value={form.name}
            onChange={handleChange}
            required
            autoComplete="name"
          />

          <label htmlFor="rg-email" style={styles.label}>Email</label>
          <input
            id="rg-email"
            style={styles.input}
            type="email"
            name="email"
            value={form.email}
            onChange={handleChange}
            required
            autoComplete="email"
          />

          <label htmlFor="rg-password" style={styles.label}>Password</label>
          <input
            id="rg-password"
            style={styles.input}
            type="password"
            name="password"
            value={form.password}
            onChange={handleChange}
            required
            minLength={10}
            autoComplete="new-password"
          />
          <p style={styles.note}>Use at least 10 characters.</p>

          {inviteToken ? (
            <p style={styles.note} data-testid="invite-note">
              You are joining an existing program. Your access level is set by the invitation.
            </p>
          ) : (
            <p style={styles.note} data-testid="no-invite-note">
              No invitation? You can create a new program after registering, or ask your Program Admin to
              send you an invite link.
            </p>
          )}

          <button style={styles.button} type="submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Register'}
          </button>
        </form>

        <p style={styles.footer}>
          Already have an account?{' '}
          <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-canvas)',
  },
  card: {
    background: 'var(--surface-1)',
    borderRadius: 8,
    padding: '2.5rem 2rem',
    width: '100%',
    maxWidth: 460,
    boxShadow: 'var(--shadow-md)',
  },
  title: { margin: 0, fontSize: '1.8rem', color: 'var(--ink-1)' },
  subtitle: { margin: '0.25rem 0 1.5rem', fontWeight: 400, color: 'var(--ink-3)', fontSize: '1rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  label: { fontWeight: 500, fontSize: '0.9rem', color: 'var(--ink-2)' },
  input: {
    padding: '0.6rem 0.75rem',
    borderRadius: 6,
    border: '1px solid var(--border-strong)',
    fontSize: '1rem',
    marginBottom: '0.5rem',
  },
  button: {
    marginTop: '0.5rem',
    padding: '0.7rem',
    borderRadius: 6,
    border: 'none',
    background: 'var(--indigo)',
    color: 'var(--ink-inverse)',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: { color: 'var(--danger-ink)', background: 'var(--danger-soft-3)', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '0.5rem' },
  note: { fontSize: '0.82rem', color: 'var(--ink-4)', margin: '0 0 0.5rem' },
  footer: { marginTop: '1.25rem', textAlign: 'center', fontSize: '0.9rem', color: 'var(--ink-3)' },
};
