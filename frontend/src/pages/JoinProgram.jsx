import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../api/axios';
import { useUser } from '../context/AppContext';

export default function JoinProgram() {
  const { token }       = useParams();
  const navigate        = useNavigate();
  const { currentUser, refreshContext } = useUser();
  const [status, setStatus] = useState('loading'); // loading | joining | success | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) { setStatus('error'); setMessage('Invalid invite link.'); return; }

    // If not logged in, redirect to register with the token
    if (!currentUser) {
      navigate(`/register?invite=${token}`, { replace: true });
      return;
    }

    // User is logged in — join directly
    setStatus('joining');
    api.get(`/programs/join/${token}`)
      .then(async ({ data }) => {
        // Create membership by using the invite
        // The backend's join route just looks it up — actual joining happens on register.
        // For logged-in users, call a dedicated endpoint:
        return api.post(`/programs/${data.programId}/join-with-token`, { token });
      })
      .then(async () => {
        await refreshContext();
        setStatus('success');
        setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
      })
      .catch(err => {
        const msg = err.response?.data?.error ?? 'Invalid or expired invite link.';
        setStatus('error');
        setMessage(msg);
      });
  }, [token, currentUser, navigate, refreshContext]);

  const content = {
    loading: { icon: null, title: 'Checking invite…', sub: '', spinner: true },
    joining: { icon: null, title: 'Joining program…', sub: 'Setting up your access.', spinner: true },
    success: { icon: '✅', title: 'Joined!', sub: 'Redirecting to dashboard…', spinner: false },
    error:   { icon: '❌', title: 'Could not join', sub: message, spinner: false },
  }[status];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-canvas)', fontFamily: 'Inter, sans-serif' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ background: 'var(--surface-1)', borderRadius: 20, border: '1px solid var(--border-1)', boxShadow: 'var(--shadow-lg)', padding: '40px 48px', textAlign: 'center', maxWidth: 360, width: '100%' }}
      >
        <p style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink-1)', marginBottom: 4 }}>MedRota</p>
        {content.spinner && (
          <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid var(--border-1)', borderTopColor: 'var(--brand)', animation: 'spin 0.8s linear infinite', margin: '20px auto 12px' }} />
        )}
        {content.icon && (
          <div style={{ fontSize: 36, margin: '16px 0 8px' }}>{content.icon}</div>
        )}
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-1)', margin: '8px 0 6px' }}>{content.title}</h2>
        {content.sub && <p style={{ fontSize: 13, color: 'var(--ink-5)' }}>{content.sub}</p>}
        {status === 'error' && (
          <button
            onClick={() => navigate('/dashboard')}
            style={{ marginTop: 20, padding: '9px 22px', borderRadius: 9, border: 'none', background: 'var(--brand)', color: 'var(--ink-inverse)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--accent)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--brand)'}
          >
            Go to Dashboard
          </button>
        )}
      </motion.div>
    </div>
  );
}
