import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BlockPageFrame as Layout } from '../components/BlockWorkspace';
import BlockResidentAvailabilityModal from '../components/BlockResidentAvailabilityModal';
import ReadinessPanel from '../components/ReadinessPanel';
import api from '../api/axios';
import { useUser } from '../context/AppContext';
import { useWorkingBlock } from '../lib/useWorkingBlock';
import { blockPath } from '../lib/blockNavigation';

export default function BlockPage() {
  const block = useWorkingBlock();
  const navigate = useNavigate();
  const { can } = useUser();
  const canPrepare = can('view_draft_schedule');
  const canManage = can('manage_block_availability');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState('');
  const requestId = useRef(0);
  const blockId = block?.id;

  const load = useCallback(async () => {
    if (!blockId) return;
    const request = ++requestId.current;
    setError('');
    try {
      const [composition, readiness] = await Promise.all([
        api.get(`/residents/block/${blockId}/composition`),
        canPrepare ? api.get(`/blocks/${blockId}/readiness`) : Promise.resolve({ data: null }),
      ]);
      if (request === requestId.current) setData({ composition: composition.data, readiness: readiness.data });
    } catch (failure) {
      if (request === requestId.current) setError(failure.response?.data?.error ?? 'Could not load block preparation. Try again.');
    }
  }, [blockId, canPrepare]);
  useEffect(() => { load(); return () => { requestId.current += 1; }; }, [load]);

  if (!block) return null;
  if (error) return <Layout><h1>Block overview</h1><section role="alert" className="workspace-card"><p>{error}</p><button className="secondary-btn" onClick={load}>Try again</button></section></Layout>;
  if (!data) return <Layout><h1>Block overview</h1><p role="status">Loading block preparation…</p></Layout>;

  const { composition, readiness } = data;
  const inBlock = composition.inBlock;
  const filtered = inBlock.filter(resident => `${resident.name} ${resident.displayName} ${resident.homeProgram ?? ''}`.toLowerCase().includes(query.toLowerCase().trim()));
  const missing = readiness?.residents.missingAvailability ?? [];
  const firstMissing = inBlock.find(resident => missing.some(item => item.residentId === resident.id));
  const hasResidentErrors = readiness?.blockers.some(item => item.severity === 'error');
  const coverageGap = readiness && !readiness.attending.complete;
  const action = firstMissing && canManage
    ? { label: `Confirm ${firstMissing.displayName || firstMissing.name}`, run: () => setEditing(firstMissing) }
    : hasResidentErrors && canManage
      ? { label: 'Manage block residents', run: () => navigate(blockPath(block, 'residents')) }
      : coverageGap && can('manage_attending_schedule')
        ? { label: 'Complete attending coverage', run: () => navigate(blockPath(block, 'attending')) }
        : { label: can('generate_schedule') ? 'Open schedule & generate' : canPrepare ? 'Open draft schedule' : 'Open published schedule', run: () => navigate(blockPath(block, 'calendar')) };

  return <Layout>
    <section className="workspace-next" aria-labelledby="block-overview-heading">
      <div><h1 id="block-overview-heading">Block overview</h1>
        <p>{hasResidentErrors ? 'Start with the residents who need attention.' : coverageGap ? 'Resident preparation is complete. Review the remaining attending gaps.' : canPrepare ? 'Preparation is complete. Generate a draft, review gaps, then validate and publish.' : 'Review the roster and open the published schedule.'}</p>
      </div>
      <button className="primary-btn" data-testid="block-next-action" onClick={action.run}>{action.label}</button>
    </section>

    {readiness && <ReadinessPanel readiness={readiness} compact />}

    <section data-testid="residents-this-block" className="workspace-card">
      <div className="workspace-roster-heading">
        <div><h2>Residents this block</h2><p>{composition.counts.inService} in-service · {composition.counts.offService} off-service · {composition.counts.medicalStudents} medical students</p></div>
        {canManage && <button className="secondary-btn" onClick={() => navigate(blockPath(block, 'residents'))}>Manage block residents</button>}
      </div>
      <label className="workspace-search">Find a resident
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or home program" />
      </label>
      <ul className="workspace-roster">
        {filtered.map(resident => <li key={resident.id} className="workspace-resident" data-testid={`overview-resident-${resident.id}`}>
          <div><strong>{resident.displayName || resident.name}</strong><p>{resident.isMedStudent ? 'Medical Student' : `${/^\d+$/.test(String(resident.pgyLevel)) ? 'PGY-' : ''}${resident.pgyLevel} · ${resident.isServiceResident ? 'In-service' : 'Off-service'}`}{!resident.isActive && ' · Inactive'}</p></div>
          <div className="workspace-resident-workload">{resident.workload?.daysOnService ?? 0} days on service · {resident.callCount} calls</div>
          {canManage ? <button className="secondary-btn" onClick={() => setEditing(resident)} aria-label={`${resident.availabilityConfirmed ? 'Edit availability for' : 'Confirm availability for'} ${resident.displayName || resident.name}`}>{resident.availabilityConfirmed ? 'Availability' : 'Confirm availability'}</button> : <span>Read only</span>}
        </li>)}
      </ul>
      {filtered.length === 0 && <p className="workspace-empty">{inBlock.length ? 'No residents match your search.' : 'No residents are participating yet. Add residents to prepare this block.'}</p>}
    </section>
    {can('manage_block_settings') && <details className="workspace-card workspace-advanced"><summary>Advanced block rules</summary><p>Review call limits and academic-day preferences when this block needs different rules.</p><button className="secondary-btn" onClick={() => navigate(blockPath(block, 'settings'))}>Block settings</button></details>}
    {editing && <BlockResidentAvailabilityModal resident={editing} blockId={block.id} onClose={() => setEditing(null)} onSaved={load} />}
  </Layout>;
}
