// Shared resident UI components used by both Residents.jsx and BlockPage.jsx
import { motion } from 'framer-motion';

// ── icons ─────────────────────────────────────────────────────────────────────

export function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

// ── avatar gradient (deterministic from name) ─────────────────────────────────

const AVATAR_GRADIENTS = [
  ['#1A3A5C', '#2C5F8A'],
  ['#16A34A', '#15803D'],
  ['#6D28D9', '#7C3AED'],
  ['#D97706', '#B45309'],
  ['#0369A1', '#0284C7'],
  ['#DC2626', '#B91C1C'],
  ['#0891B2', '#0E7490'],
  ['#7C3AED', '#6D28D9'],
];

function avatarGradient(name = '') {
  const code = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const [a, b] = AVATAR_GRADIENTS[code % AVATAR_GRADIENTS.length];
  return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
}

// ── badges ────────────────────────────────────────────────────────────────────

export function PgyBadge({ level }) {
  const label = (level === 'Fellow' || level === 'Medical Student') ? level : `PGY${level}`;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-[11px] font-semibold whitespace-nowrap px-2"
      style={{ background: '#EEF4FF', color: '#2C5F8A', height: 22, minWidth: 40 }}
    >
      {label}
    </span>
  );
}

export function CallBadge({ count, max }) {
  let bg, color;
  if (count >= 9)      { bg = '#FEF2F2'; color = '#DC2626'; }
  else if (count >= 7) { bg = '#FFFBEB'; color = '#B45309'; }
  else                 { bg = '#F0FDF4'; color = '#15803D'; }

  return (
    <motion.span
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: bg, color }}
    >
      {count}/{max}
    </motion.span>
  );
}

// ── vacation range pill ───────────────────────────────────────────────────────

export function VacationRangePill({ from, to }) {
  const fmt = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-0.5 rounded"
      style={{ background: '#FFF7ED', color: '#C2410C', border: '1px solid #FED7AA', whiteSpace: 'nowrap' }}
    >
      {to ? `${fmt(from)} – ${fmt(to)}` : fmt(from)}
    </span>
  );
}

// Pairs up flat vacationDates array [from0, to0, from1, to1, ...] into range objects
export function parseVacationRanges(dates = []) {
  const valid = dates.filter(Boolean);
  const ranges = [];
  for (let i = 0; i < valid.length; i += 2) {
    ranges.push({ from: valid[i], to: valid[i + 1] ?? null });
  }
  return ranges;
}

// ── resident row (animated) ───────────────────────────────────────────────────

export function ResidentRow({ resident, onRemove, onEdit }) {
  const maxCalls = resident.callCapOverride ?? (resident.isMedStudent ? 5 : 9);
  const ranges   = parseVacationRanges(resident.vacationDates);

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl group"
      style={{
        border: '1px solid #E8EFF6',
        background: '#fff',
        cursor: 'default',
        transition: 'background 100ms ease, border-color 100ms ease',
      }}
    >
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold"
        style={{ background: avatarGradient(resident.name), color: '#fff' }}
      >
        {resident.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: '#1A3A5C' }}>{resident.name}</p>
        {resident.academicDayPref && resident.academicDayPref !== 'None' && (
          <p className="text-[11px] truncate" style={{ color: '#94A3B8' }}>{resident.academicDayPref}</p>
        )}
        {ranges.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {ranges.map((r, i) => <VacationRangePill key={i} from={r.from} to={r.to} />)}
          </div>
        )}
      </div>

      {/* PGY + calls */}
      <div className="flex items-center gap-2 shrink-0">
        <PgyBadge level={resident.pgyLevel} />
        <CallBadge count={resident.callCount ?? 0} max={maxCalls} />
      </div>

      {/* Action buttons — show on hover */}
      <div className="flex items-center gap-1 shrink-0">
        {onEdit && (
          <button
            onClick={() => onEdit(resident)}
            className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-100"
            style={{ color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#EEF4FF'; e.currentTarget.style.color = '#2C5F8A'; }}
            onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.color = '#94A3B8'; }}
            title="Edit resident"
          >
            <PencilIcon />
          </button>
        )}

        {onRemove && (
          <button
            onClick={() => onRemove(resident.id)}
            className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-100"
            style={{ color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#FEF2F2'; e.currentTarget.style.color = '#DC2626'; }}
            onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.color = '#94A3B8'; }}
            title="Remove resident"
          >
            <TrashIcon />
          </button>
        )}
      </div>
    </div>
  );
}

// ── resident panel ────────────────────────────────────────────────────────────

export function ResidentPanel({ title, accent, residents, onRemove, onEdit, emptyLabel }) {
  return (
    <div
      className="flex flex-col rounded-xl overflow-hidden"
      style={{ border: '1px solid #E8EFF6', boxShadow: '0 1px 3px rgba(26,58,92,0.05)' }}
    >
      <div className="flex items-center gap-2.5 px-5 py-4" style={{ background: '#fff', borderBottom: '1px solid #E8EFF6' }}>
        <div className="w-1 h-5 rounded-full" style={{ background: accent }} />
        <h2 style={{ fontSize: 14, fontWeight: 600, color: '#1A3A5C' }}>{title}</h2>
        <motion.span
          key={residents.length}
          initial={{ scale: 1.3 }}
          animate={{ scale: 1 }}
          className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ background: '#F0F5FF', color: '#4A6FA5' }}
        >
          {residents.length}
        </motion.span>
      </div>

      <div className="flex flex-col gap-2 p-3" style={{ background: '#F8FAFC', minHeight: 120 }}>
        {residents.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm" style={{ color: '#CBD5E1' }}>{emptyLabel}</p>
          </div>
        ) : (
          residents.map(r => <ResidentRow key={r.id} resident={r} onRemove={onRemove} onEdit={onEdit} />)
        )}
      </div>
    </div>
  );
}

// ── shared styles ─────────────────────────────────────────────────────────────

export const labelStyle = {
  display: 'block', fontSize: 12, fontWeight: 500, color: '#64748B', marginBottom: 5,
};

export const inputStyle = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  border: '1px solid #E2E8F0', fontSize: 13, color: '#1A3A5C',
  background: '#F8FAFC', outline: 'none',
};
