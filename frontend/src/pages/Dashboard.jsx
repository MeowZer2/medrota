import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PageWrapper from '../components/PageWrapper';
import EmptyState from '../components/EmptyState';
import api from '../api/axios';
import { useBlock, useUser } from '../context/AppContext';
import { blockPath } from '../lib/blockNavigation';
import { formatBlockDate, toISODate } from '../lib/blockUtils';
import { focusBlocksForDate } from '../lib/dashboardBlocks';

const cardStyle = { background: 'var(--surface-1)', border: '1px solid var(--border-1)', borderRadius: 14, padding: 18, minWidth: 0 };

function attentionFor(block, readiness, stats, validation, status) {
  const items = [];
  const link = section => blockPath(block, section);
  if (status?.state === 'changes_unpublished') items.push({ priority: 0, text: 'Working schedule changed after publication. The public link still shows the previous version.', action: 'Review and publish', href: link('calendar') });
  const missing = readiness?.residents?.missingAvailability?.length ?? 0;
  if (missing) items.push({ priority: 1, text: `${missing} resident${missing === 1 ? '' : 's'} need availability confirmation.`, action: 'Review residents', href: link('residents') });
  if (readiness?.residents?.enrolledSeniors === 0 || readiness?.residents?.enrolledJuniors === 0) items.push({ priority: 2, text: 'This block needs a confirmed senior and junior resident.', action: 'Review residents', href: link('residents') });
  const gaps = readiness?.attending?.missingDates?.length ?? 0;
  if (gaps) items.push({ priority: 3, text: `${gaps} date${gaps === 1 ? '' : 's'} have no attending entry. On-call coverage is tracked separately.`, action: 'Fix attendings', href: link('attending') });
  if (stats?.assignedDays === 0) items.push({ priority: 4, text: 'No resident call assignments have been generated for this block.', action: 'Open schedule', href: link('calendar') });
  else if (stats?.unassignedDays > 0) items.push({ priority: 5, text: `${stats.unassignedDays} date${stats.unassignedDays === 1 ? '' : 's'} have no resident call assignment.`, action: 'Review schedule', href: link('calendar') });
  if (validation?.violations?.length) items.push({ priority: 6, text: `${validation.violations.length} scheduling rule issue${validation.violations.length === 1 ? '' : 's'} need review.`, action: 'Validate schedule', href: link('calendar') });
  return items.sort((a, b) => a.priority - b.priority);
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { currentProgram, can } = useUser();
  const { academicYears } = useBlock();
  const [details, setDetails] = useState({});
  const [loading, setLoading] = useState(true);
  const today = toISODate(new Date());
  const { ordered: allBlocks, current, focusBlocks } = useMemo(
    () => focusBlocksForDate(academicYears.flatMap(year => year.blocks ?? []), today),
    [academicYears, today],
  );

  useEffect(() => {
    if (!currentProgram || !can('view_draft_schedule')) { setLoading(false); return; }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const wanted = new Map([...focusBlocks, ...allBlocks.filter(block => block.isPublished)].map(block => [block.id, block]));
      const rows = await Promise.all([...wanted.values()].map(async block => {
        const focused = focusBlocks.some(item => item.id === block.id);
        const [readiness, stats, validation, status] = await Promise.all([
          focused ? api.get(`/blocks/${block.id}/readiness`).then(response => response.data).catch(() => null) : null,
          focused ? api.get(`/programs/stats?blockId=${block.id}`).then(response => response.data).catch(() => null) : null,
          focused && can('validate_schedule') ? api.get(`/schedule/validate?blockId=${block.id}`).then(response => response.data).catch(() => null) : null,
          api.get(`/schedule/publication-status?blockId=${block.id}`).then(response => response.data).catch(() => null),
        ]);
        return [block.id, { readiness, stats, validation, status }];
      }));
      if (!cancelled) { setDetails(Object.fromEntries(rows)); setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [currentProgram, allBlocks, focusBlocks, can]);

  if (!currentProgram) return <PageWrapper><Layout><EmptyState title="No program found" description="Complete setup to create your residency program and blocks." cta="Go to Setup" onCta={() => navigate('/setup')} /></Layout></PageWrapper>;

  const amended = allBlocks.filter(block => details[block.id]?.status?.state === 'changes_unpublished' && !focusBlocks.some(item => item.id === block.id));
  const displayBlocks = [...amended, ...focusBlocks];
  return <PageWrapper><Layout>
    <header style={{ marginBottom: 24 }}><h1 style={{ color: 'var(--ink-1)', fontSize: 28, fontWeight: 700, margin: 0 }}>What needs attention?</h1><p style={{ color: 'var(--ink-4)', marginTop: 6 }}>Your next scheduling tasks across blocks.</p></header>
    {!can('view_draft_schedule') ? <section style={cardStyle}><p style={{ color: 'var(--ink-2)' }}>You have read-only access to published schedules.</p></section> : loading ? <p role="status">Checking blocks…</p> : displayBlocks.length === 0 ? <section style={cardStyle}><p style={{ color: 'var(--ink-2)' }}>No blocks exist yet. Create an academic year to begin scheduling.</p></section> : <div style={{ display: 'grid', gap: 14 }}>
      {displayBlocks.map(block => {
        const data = details[block.id] ?? {};
        const isCurrent = current?.id === block.id;
        const isFuture = String(block.startDate).slice(0, 10) > today;
        const label = isCurrent ? 'Current block' : isFuture ? 'Upcoming block' : 'Earlier block';
        const issues = attentionFor(block, data.readiness, data.stats, data.validation, data.status);
        const visibleIssues = amended.some(item => item.id === block.id) ? issues.filter(item => item.priority === 0) : issues;
        const focused = focusBlocks.some(item => item.id === block.id);
        const checkFailed = !data.status || (focused && (!data.readiness || !data.stats || (can('validate_schedule') && !data.validation)));
        return <section key={block.id} style={cardStyle} data-testid={`attention-block-${block.id}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'start' }}>
            <div><p style={{ color: 'var(--ink-5)', fontSize: 12, fontWeight: 700, margin: 0 }}>{label}</p><h2 style={{ color: 'var(--ink-1)', fontSize: 19, margin: '4px 0' }}>Block {block.number}</h2><p style={{ color: 'var(--ink-4)', fontSize: 13, margin: 0 }}>{formatBlockDate(block.startDate)} – {formatBlockDate(block.endDate)}</p></div>
            <Link className="secondary-btn" to={blockPath(block)}>Open block</Link>
          </div>
          {checkFailed ? <p role="alert" style={{ margin: '16px 0 0', color: 'var(--warn-ink-strong)', fontSize: 13 }}>Could not check all block details. <Link to={blockPath(block)} style={{ color: 'var(--accent)', fontWeight: 700 }}>Open block to review</Link>.</p>
            : visibleIssues.length ? <ul style={{ padding: 0, margin: '16px 0 0', listStyle: 'none', display: 'grid', gap: 10 }}>{visibleIssues.map(item => <li key={`${item.priority}-${item.href}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'var(--surface-2)', borderRadius: 9, padding: '10px 12px' }}><span style={{ color: 'var(--ink-2)', fontSize: 13, minWidth: 0 }}>{item.text}</span><Link to={item.href} style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{item.action}</Link></li>)}</ul>
            : <p style={{ margin: '16px 0 0', color: 'var(--success-ink)', fontSize: 13 }}>{data.status?.state === 'current' ? 'Published schedule matches the working draft.' : 'No preparation or validation issues found. Review the schedule before publishing.'}</p>}
        </section>;
      })}
    </div>}
  </Layout></PageWrapper>;
}
