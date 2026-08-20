// Shared accessible dialog shell.
//
// Every modal in the app should use this so the accessibility behaviour is
// written once: labelled dialog role, Escape to close, focus moved in on open
// and returned to the invoking control on close, and Tab kept inside.

import { useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true" focusable="false">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export default function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  maxWidth = 'max-w-md',
  closeLabel = 'Close dialog',
  labelledById,
}) {
  const panelRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  const headingId = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`).current;
  const descriptionId = useRef(`modal-desc-${Math.random().toString(36).slice(2, 9)}`).current;

  // Remember what had focus so it can be handed back on close.
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement;
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector(FOCUSABLE);
      (first ?? panel).focus({ preventScroll: true });
    }
    return () => {
      const target = previouslyFocusedRef.current;
      if (target && typeof target.focus === 'function' && document.contains(target)) {
        target.focus({ preventScroll: true });
      }
    };
  }, []);

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    // Keep Tab inside the dialog so background controls cannot take focus.
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = [...panel.querySelectorAll(FOCUSABLE)].filter(node => node.offsetParent !== null);
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus({ preventScroll: true });
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.34)' }}
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledById ?? headingId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.14, ease: 'easeOut' }}
        className={`w-full ${maxWidth} rounded-2xl overflow-hidden max-h-[90vh] flex flex-col outline-none`}
        style={{ background: '#fff', boxShadow: '0 14px 36px rgba(26,58,92,0.16)', border: '1px solid #E8EFF6' }}
      >
        <div className="flex items-center justify-between gap-3 px-6 py-5 shrink-0" style={{ borderBottom: '1px solid #E8EFF6' }}>
          <div style={{ minWidth: 0 }}>
            <h3 id={headingId} style={{ fontSize: 16, fontWeight: 600, color: '#1A3A5C' }}>{title}</h3>
            {description && (
              <p id={descriptionId} style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="rounded-lg shrink-0"
            style={{ color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 36, minHeight: 36 }}
            onMouseEnter={e => { e.currentTarget.style.background = '#F0F5FF'; }}
            onMouseLeave={e => { e.currentTarget.style.background = ''; }}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto">{children}</div>

        {footer && (
          <div className="px-6 py-4 shrink-0" style={{ borderTop: '1px solid #E8EFF6', background: '#F8FAFC' }}>
            {footer}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
