// Reusable skeleton shimmer block
export function Skeleton({ width = '100%', height = 16, radius = 8, style = {} }) {
  return (
    <div
      className="skeleton-shimmer"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

// Pre-built skeleton for a stats card row (4 cards)
export function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-surface-1 rounded-xl p-5" style={{ border: '1px solid var(--border-1)' }}>
          <Skeleton width={32} height={32} radius={8} style={{ marginBottom: 12 }} />
          <Skeleton width="55%" height={11} style={{ marginBottom: 8 }} />
          <Skeleton width="40%" height={28} />
        </div>
      ))}
    </div>
  );
}

// A single card skeleton
export function CardSkeleton({ rows = 3 }) {
  return (
    <div className="bg-surface-1 rounded-xl p-5" style={{ border: '1px solid var(--border-1)' }}>
      {[...Array(rows)].map((_, i) => (
        <Skeleton key={i} height={14} style={{ marginBottom: 10, width: i === rows - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}

// Resident list skeleton
export function ResidentListSkeleton() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ border: '1px solid var(--border-1)', background: 'var(--surface-1)' }}>
          <Skeleton width={36} height={36} radius={999} />
          <div className="flex-1">
            <Skeleton width="40%" height={13} style={{ marginBottom: 6 }} />
            <Skeleton width="25%" height={11} />
          </div>
          <Skeleton width={48} height={22} radius={999} />
        </div>
      ))}
    </div>
  );
}

// Table row skeleton
export function TableSkeleton({ rows = 6 }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-1)' }}>
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3" style={{ borderBottom: i < rows - 1 ? '1px solid var(--border-subtle)' : 'none', background: 'var(--surface-1)' }}>
          <Skeleton width={70} height={12} />
          <Skeleton width={36} height={12} />
          <Skeleton style={{ flex: 1 }} height={28} radius={8} />
          <Skeleton style={{ flex: 1 }} height={28} radius={8} />
        </div>
      ))}
    </div>
  );
}
