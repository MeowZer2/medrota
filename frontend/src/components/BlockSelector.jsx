import { useState, useRef, useEffect } from 'react';

/**
 * Compact dropdown block selector.
 * Shows current block as "Block 1 — Jul 1 – Jul 28" with a chevron.
 * Opens a clean list of all blocks in the academic year.
 */
export default function BlockSelector({ blocks, activeBlockId, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function fmtRange(b) {
    if (!b?.startDate || !b?.endDate) return '';
    const s = new Date(b.startDate).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
    const e = new Date(b.endDate).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
    return `${s} – ${e}`;
  }

  const active = blocks.find(b => b.id === activeBlockId);
  const label  = active
    ? `Block ${active.number} — ${fmtRange(active)}`
    : 'Select block…';

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', maxWidth: 240 }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Select block"
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: '7px 11px', borderRadius: 8,
          border: '1.5px solid #1A3A5C', background: '#fff',
          fontSize: 13, fontWeight: 600, color: '#1A3A5C',
          cursor: 'pointer', whiteSpace: 'nowrap',
          minWidth: 160, maxWidth: 240, width: '100%',
          boxShadow: open ? '0 0 0 3px rgba(44,95,138,0.12)' : 'none',
          transition: 'box-shadow 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#F0F5FF'; }}
        onMouseLeave={e => { e.currentTarget.style.background = open ? '#F0F5FF' : '#fff'; }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, textAlign: 'left' }}>
          {label}
        </span>
        {/* Chevron */}
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="#2C5F8A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown list */}
      {open && blocks.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0,
          background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10,
          boxShadow: '0 4px 20px rgba(26,58,92,0.12)', padding: 4,
          zIndex: 100, minWidth: '100%', maxHeight: 280, overflowY: 'auto',
        }}>
          {blocks.map(b => {
            const isActive = b.id === activeBlockId;
            return (
              <button
                key={b.id}
                data-testid={`block-option-${b.number}`}
                onClick={() => { onSelect(b); setOpen(false); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px', borderRadius: 7, border: 'none',
                  cursor: 'pointer',
                  background: isActive ? '#EEF4FF' : 'none',
                  color: isActive ? '#1A3A5C' : '#374151',
                  fontSize: 13, fontWeight: isActive ? 600 : 400,
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#F8FAFC'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'none'; }}
              >
                Block {b.number}
                {fmtRange(b) && (
                  <span style={{ display: 'block', fontSize: 11, color: '#94A3B8', fontWeight: 400, marginTop: 1 }}>
                    {fmtRange(b)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
