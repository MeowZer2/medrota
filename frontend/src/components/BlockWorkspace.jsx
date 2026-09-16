import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import Layout from './Layout';
import { useBlock, useUser } from '../context/AppContext';
import { useWorkingBlock } from '../lib/useWorkingBlock';
import { blockPath } from '../lib/blockNavigation';
import { formatBlockDate } from '../lib/blockUtils';
import { usePublicationStatus } from '../lib/usePublicationStatus';

// Existing standalone calendar/attending routes retain their full page frame.
// Nested working pages use the shared shell, which stays mounted across steps.
export function BlockPageFrame({ children }) {
  const workspace = useOutletContext();
  return workspace ? children : <Layout>{children}</Layout>;
}

export default function BlockWorkspace() {
  const block = useWorkingBlock();
  const { academicYears } = useBlock();
  const { can } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const section = location.pathname.split('/')[3] ?? '';
  const activeDate = new URLSearchParams(location.search).get('date');
  const bodyRef = useRef(null);
  const previousPath = useRef(location.pathname);
  const { status, refresh } = usePublicationStatus(block?.id, can('view_draft_schedule'));

  useEffect(() => {
    if (previousPath.current !== location.pathname) {
      bodyRef.current?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    previousPath.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => { refresh(); }, [location.pathname, refresh]);

  if (!block) return <Layout><section role="alert" className="workspace-card"><h1>Block not found</h1><p>This link does not identify a block in your program. Choose a block from the menu.</p><Link to="/dashboard">Return to Dashboard</Link></section></Layout>;

  const links = [
    ['', 'Overview'],
    ['residents', 'Residents & availability'],
    ...(can('manage_attending_schedule') ? [['attending', 'Attendings']] : []),
    ['calendar', 'Schedule'],
  ];
  return <Layout>
    <header className="block-workspace-header" data-testid="block-workspace-header">
      <div className="workspace-heading-row">
        <div>
          <p className="workspace-eyebrow">Block workspace</p>
          <p className="workspace-block-title">Block {block.number}</p>
          <p className="workspace-dates">{formatBlockDate(block.startDate)} – {formatBlockDate(block.endDate)}</p>
        </div>
        <label className="workspace-switcher">Change block
          <select aria-label="Workspace block" value={block.id} onChange={event => {
            const next = academicYears.flatMap(year => year.blocks ?? []).find(item => item.id === event.target.value);
            if (next) navigate(blockPath(next, section));
          }}>
            {academicYears.map(year => <optgroup key={year.id} label={`${String(year.startDate).slice(0, 4)}–${String(year.endDate).slice(0, 4)}`}>
              {year.blocks.map(item => <option key={item.id} value={item.id}>Block {item.number} · {formatBlockDate(item.startDate)} – {formatBlockDate(item.endDate)}</option>)}
            </optgroup>)}
          </select>
        </label>
      </div>
      <p className="workspace-publication" data-testid="workspace-publication">
        {can('view_draft_schedule')
          ? status?.state === 'changes_unpublished' ? 'Changes not published · The public link still shows the previous schedule. Review and re-publish from Schedule.'
            : status?.state === 'current' ? 'Published · Working schedule matches the public version.'
              : status?.state === 'unpublished' ? 'Unpublished · The public link is inactive; publication history is retained.'
                : status?.state === 'never_published' ? 'Draft · No public schedule yet.'
                  : 'Checking publication status…'
          : block.isPublished ? 'Published schedule · Read-only access.' : 'No published schedule is available for this block.'}
      </p>
      <nav aria-label="Block workspace" className="workspace-nav">
        {links.map(([path, label]) => <Link key={path} to={`${blockPath(block, path)}${activeDate ? `&date=${encodeURIComponent(activeDate)}` : ''}`} aria-current={section === path ? 'page' : undefined}>{label}</Link>)}
      </nav>
    </header>
    <div ref={bodyRef} tabIndex={-1} className="workspace-content" aria-label={`Block ${block.number} ${section || 'overview'}`}>
      <Outlet key={block.id} context={{ block }} />
    </div>
  </Layout>;
}
