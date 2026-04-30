import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/axios';

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/register', form);
      navigate('/login');
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
          <label style={styles.label}>Name</label>
          <input
            style={styles.input}
            type="text"
            name="name"
            value={form.name}
            onChange={handleChange}
            required
            autoComplete="name"
          />

          <label style={styles.label}>Email</label>
          <input
            style={styles.input}
            type="email"
            name="email"
            value={form.email}
            onChange={handleChange}
            required
            autoComplete="email"
          />

          <label style={styles.label}>Password</label>
          <input
            style={styles.input}
            type="password"
            name="password"
            value={form.password}
            onChange={handleChange}
            required
            autoComplete="new-password"
          />

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
    background: '#f5f6fa',
  },
  card: {
    background: '#fff',
    borderRadius: 8,
    padding: '2.5rem 2rem',
    width: '100%',
    maxWidth: 400,
    boxShadow: '0 2px 16px rgba(0,0,0,0.08)',
  },
  title: { margin: 0, fontSize: '1.8rem', color: '#1a1a2e' },
  subtitle: { margin: '0.25rem 0 1.5rem', fontWeight: 400, color: '#555', fontSize: '1rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  label: { fontWeight: 500, fontSize: '0.9rem', color: '#333' },
  input: {
    padding: '0.6rem 0.75rem',
    borderRadius: 6,
    border: '1px solid #ddd',
    fontSize: '1rem',
    marginBottom: '0.5rem',
  },
  button: {
    marginTop: '0.5rem',
    padding: '0.7rem',
    borderRadius: 6,
    border: 'none',
    background: '#4f46e5',
    color: '#fff',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: { color: '#c0392b', background: '#fdecea', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '0.5rem' },
  footer: { marginTop: '1.25rem', textAlign: 'center', fontSize: '0.9rem', color: '#555' },
};
