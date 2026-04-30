import { useRef, useEffect, useState } from 'react';

/**
 * Horizontal scrollable block pill selector.
 * Mobile (< 768px): compact "B1" labels, 32px height.
 * Desktop (>= 768px): "Block 1" with date range, 36px height.
 * Gradient fade edges indicate scrollability.
 * Active pill scrolls into view automatically.
 */
export default function BlockPills({ blocks, activeBlockId, onSelect }) {
  const activeRef    = useRef(null);
  const scrollRef    = useRef(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  // Detect viewport width changes
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Scroll active pill into view when it changes
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeBlockId]);

  function fmtDate(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  }

  const pillHeight = isMobile ? 32 : 36;

  return (
    <div style={{ position: 'relative' }}>
      {/* Left fade overlay */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 20,
        background: 'linear-gradient(to right, #F8FAFC, transparent)',
        zIndex: 1, pointerEvents: 'none',
      }} />
      {/* Right fade overlay */}
      <div style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: 20,
        background: 'linear-gradient(to left, #F8FAFC, transparent)',
        zIndex: 1, pointerEvents: 'none',
      }} />

      <div
        ref={scrollRef}
        style={{
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 2,
          paddingLeft: 4,
          paddingRight: 4,
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        <style>{`.medrota-pills-scroll::-webkit-scrollbar { display: none; }`}</style>

        {blocks.map(b => {
          const isActive  = b.id === activeBlockId;
          const shortLabel = `B${b.number}`;
          const fullLabel  = `Block ${b.number}`;
          const dateRange  = b.startDate && b.endDate
            ? `${fmtDate(b.startDate)} – ${fmtDate(b.endDate)}`
            : null;

          return (
            <button
              key={b.id}
              ref={isActive ? activeRef : null}
              onClick={() => onSelect(b)}
              title={dateRange ?? `Block ${b.number}`}
              style={{
                height: pillHeight,
                padding: isMobile ? '0 10px' : '0 14px',
                borderRadius: 99,
                border: '1.5px solid',
                flexShrink: 0,
                cursor: 'pointer',
                fontSize: isMobile ? 11 : 12,
                fontWeight: 600,
                transition: 'all 0.15s',
                borderColor: isActive ? '#1A3A5C' : '#D6E4F7',
                background:  isActive ? '#1A3A5C' : '#fff',
                color:       isActive ? '#fff'    : '#2C5F8A',
                display: 'flex',
                alignItems: 'center',
                gap: isMobile ? 0 : 4,
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => {
                if (!isActive) {
                  e.currentTarget.style.borderColor = '#2C5F8A';
                  e.currentTarget.style.background = '#EEF4FF';
                }
              }}
              onMouseLeave={e => {
                if (!isActive) {
                  e.currentTarget.style.borderColor = '#D6E4F7';
                  e.currentTarget.style.background = '#fff';
                }
              }}
            >
              {isMobile ? shortLabel : fullLabel}
              {!isMobile && dateRange && (
                <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.7, marginLeft: 2 }}>
                  · {dateRange}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
