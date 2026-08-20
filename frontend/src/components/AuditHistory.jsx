// Read-only program history.
//
// Deliberately plain: a reverse-chronological list of who changed what. The
// server decides which categories the reader is allowed to see, so a Viewer
// gets nothing and a Chief Resident gets scheduling history only.

import { useEffect, useState } from 'react';
import api from '../api/axios';

const CATEGORY_STYLE = {
  administrative: { bg: '#F3F0FF', color: '#6D28D9', label: 'Admin' },
  scheduling: { bg: '#EEF4FF', color: '#2C5F8A', label: 'Scheduling' },
};

function formatWhen(iso) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AuditHistory({ programId, blockId = null, limit = 50 }) {
  const [state, setState] = useState({ status: 'idle', events: [], error: null });

  useEffect(() => {
    if (!programId) return undefined;
    const controller = new AbortController();
    setState(current => ({ ...current, status: 'loading' }));

    const query = new URLSearchParams({ programId, limit: String(limit) });
    if (blockId) query.set('blockId', blockId);

    api.get(`/audit?${query.toString()}`, { signal: controller.signal })
      .then(({ data }) => setState({ status: 'ready', events: data.events, error: null }))
      .catch(err => {
        if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
        setState({
          status: 'error',
          events: [],
          error: err.response?.status === 403
            ? 'Your role cannot view program history.'
            : 'Could not load program history.',
        });
      });

    return () => controller.abort();
  }, [programId, blockId, limit]);

  if (state.status === 'loading' || state.status === 'idle') {
    return <p style={{ fontSize: 13, color: '#94A3B8' }}>Loading history…</p>;
  }
  if (state.status === 'error') {
    return <p style={{ fontSize: 13, color: '#B45309' }}>{state.error}</p>;
  }
  if (state.events.length === 0) {
    return <p style={{ fontSize: 13, color: '#94A3B8', fontStyle: 'italic' }}>No recorded changes yet.</p>;
  }

  return (
    <ul data-testid="audit-history" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {state.events.map(event => {
        const style = CATEGORY_STYLE[event.category] ?? CATEGORY_STYLE.scheduling;
        return (
          <li
            key={event.id}
            data-testid={`audit-${event.action}`}
            style={{ background: '#fff', border: '1px solid #E8EFF6', borderRadius: 11, padding: '10px 13px' }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: style.bg, color: style.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {style.label}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1A3A5C', flex: '1 1 220px', minWidth: 0 }}>
                {event.summary}
              </span>
              <span style={{ fontSize: 11, color: '#94A3B8', whiteSpace: 'nowrap' }}>
                {formatWhen(event.createdAt)}
              </span>
            </div>
            <p style={{ fontSize: 11.5, color: '#64748B', marginTop: 3 }}>
              {event.actorName ?? 'System'}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
