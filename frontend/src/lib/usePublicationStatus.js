import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/axios';

export function notifyScheduleChanged(blockId) {
  window.dispatchEvent(new CustomEvent('medrota:schedule-changed', { detail: { blockId } }));
}

export function usePublicationStatus(blockId, enabled = true) {
  const [status, setStatus] = useState(null);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    if (!blockId || !enabled) { setStatus(null); return; }
    try {
      const response = await api.get(`/schedule/publication-status?blockId=${encodeURIComponent(blockId)}`);
      if (request === requestId.current) setStatus(response.data);
    } catch { if (request === requestId.current) setStatus(null); }
  }, [blockId, enabled]);
  useEffect(() => {
    refresh();
    const onChange = event => { if (event.detail?.blockId === blockId) refresh(); };
    window.addEventListener('medrota:schedule-changed', onChange);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('medrota:schedule-changed', onChange); window.removeEventListener('focus', refresh); };
  }, [blockId, refresh]);
  return { status, refresh };
}
