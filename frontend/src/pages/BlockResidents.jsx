import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { BlockPageFrame as Layout } from '../components/BlockWorkspace';
import BlockResidentAvailabilityModal from '../components/BlockResidentAvailabilityModal';
import { useWorkingBlock } from '../lib/useWorkingBlock';
import { blockPath } from '../lib/blockNavigation';
import ResidentFormModal from '../components/ResidentFormModal';
import api from '../api/axios';
import { useUser } from '../context/AppContext';

const buttonBase = { minHeight: 38, borderRadius: 9, padding: '8px 12px', fontSize: 13, fontWeight: 700 };

function classification(resident) {
  if (resident.isMedStudent) return 'Medical Student';
  return resident.isServiceResident ? 'In-service' : 'Off-service';
}

const pgyLabel = value => /^\d+$/.test(String(value)) ? `PGY-${value}` : String(value);

function ResidentSummary({ resident, action, actionLabel, actionDisabled = false, secondaryAction }) {
  const workload = resident.workload;
  return (
    <li data-testid={`block-resident-${resident.id}`} style={{ listStyle: 'none', border: '1px solid var(--border-2)', borderRadius: 11, padding: 12, background: 'var(--surface-1)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: 'block', color: 'var(--ink-1)', fontSize: 13 }}>{resident.displayName || resident.name}</strong>
          <div style={{ marginTop: 4, color: 'var(--ink-4)', fontSize: 11 }}>
            {!resident.isMedStudent && `${pgyLabel(resident.pgyLevel)} · `}{classification(resident)}
            {!resident.isMedStudent && ` · ${resident.residentRole}`}
            {!resident.isActive && ' · Inactive'}
          </div>
          {workload && <details style={{ marginTop: 8, color: 'var(--ink-3)', fontSize: 11, lineHeight: 1.55 }}>
            <summary style={{ cursor: 'pointer' }}>{workload.daysOnService} days on service · {workload.assigned} calls · Workload details</summary>
            <div>Block days: {workload.blockDays} · Vacation: {workload.vacationDays} · Other unavailable: {workload.otherUnavailableDays} · Days on service: {workload.daysOnService}</div>
            <div>Call type: {workload.callType === 'in_house' ? 'In-house' : 'Home'} · PARO maximum: {workload.paroMaximum}{workload.localMaximum != null ? ` · Local maximum: ${workload.localMaximum}` : ''} · Assigned: {workload.assigned}</div>
          </details>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {secondaryAction}
          {action && <button type="button" disabled={actionDisabled} onClick={action} style={{ ...buttonBase, minHeight: 34, padding: '6px 9px', border: '1px solid var(--border-strong)', background: actionDisabled ? 'var(--surface-2)' : 'var(--surface-1)', color: actionDisabled ? 'var(--ink-5)' : 'var(--accent)' }}>{actionLabel}</button>}
        </div>
      </div>
    </li>
  );
}

export default function BlockResidents() {
  const block = useWorkingBlock();
  const navigate = useNavigate();
  const { currentProgram, can } = useUser();
  const [composition, setComposition] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [editingAvailability, setEditingAvailability] = useState(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const canManage = can('manage_block_availability');
  const canReadReadiness = can('view_draft_schedule');
  const canCreate = can('manage_residents') && canManage;
  const blockId = block?.id;

  const load = useCallback(async () => {
    if (!blockId) return;
    const request = ++requestId.current;
    setError('');
    try {
      const [compositionResponse, readinessResponse] = await Promise.all([api.get(`/residents/block/${blockId}/composition`), canReadReadiness ? api.get(`/blocks/${blockId}/readiness`) : Promise.resolve({ data: null })]);
      if (request !== requestId.current) return;
      setComposition(compositionResponse.data); setReadiness(readinessResponse.data);
    } catch (failure) { if (request === requestId.current) setError(failure.response?.data?.error ?? 'Could not load block residents'); }
  }, [blockId, canReadReadiness]);
  useEffect(() => { load(); return () => { requestId.current += 1; }; }, [load]);

  const add = async resident => {
    try { await api.post(`/residents/${resident.id}/enroll`, { blockId: block.id }); await load(); toast.success(`${resident.displayName || resident.name} added to Block ${block.number}`); }
    catch (error) { toast.error(error.response?.data?.error ?? 'Could not add resident'); }
  };
  const remove = async resident => {
    if (!window.confirm(`Remove ${resident.displayName || resident.name} from Block ${block.number}?`)) return;
    try { await api.delete(`/residents/${resident.id}/enroll/${block.id}`); await load(); toast.success('Resident removed from block'); }
    catch (error) { toast.error(error.response?.data?.error ?? 'Could not remove resident'); }
  };

  if (!block) return <Layout><p>Select a block to manage residents.</p></Layout>;
  if (error) return <Layout><section role="alert" className="workspace-card"><p>{error}</p><button className="secondary-btn" onClick={load}>Try again</button></section></Layout>;
  if (!composition) return <Layout><p role="status">Loading block residents…</p></Layout>;
  const matches = resident => `${resident.name} ${resident.displayName} ${resident.homeProgram ?? ''}`.toLowerCase().includes(query.toLowerCase().trim());
  const inBlock = (composition.inBlock ?? []).filter(matches);
  const available = (composition.available ?? []).filter(matches);
  const missing = readiness?.residents?.missingAvailability ?? [];
  const unresolved = readiness?.residents?.unresolvedRecords ?? [];
  const needsAttention = readiness && !readiness.readyToGenerate;
  return <Layout>
    <header style={{ marginBottom: 20 }}><button type="button" onClick={() => navigate(blockPath(block))} style={{ border: 0, background: 'transparent', color: 'var(--accent)', fontWeight: 700, padding: '5px 0' }}>← Block {block.number}</button><h1 style={{ margin: '7px 0 0', color: 'var(--ink-1)', fontSize: 28 }}>Manage block residents</h1><p style={{ margin: '6px 0 0', color: 'var(--ink-4)', fontSize: 14 }}>Choose who is rotating, then confirm each resident’s block availability.</p></header>

    {readiness && <section data-testid="block-resident-readiness" style={{ border: `1px solid ${needsAttention ? 'var(--warn-border-2)' : 'var(--success-border-2)'}`, background: needsAttention ? 'var(--warn-soft)' : 'var(--success-soft)', borderRadius: 12, padding: 14, marginBottom: 18 }}>
      <strong style={{ color: needsAttention ? 'var(--warn-ink-strong)' : 'var(--success-ink-strong)' }}>{needsAttention ? 'Needs attention' : 'Resident preparation complete'}</strong>
      <div style={{ marginTop: 5, color: 'var(--ink-3)', fontSize: 12 }}>{composition?.counts?.total ?? 0} active residents in this block · {readiness.residents.withAvailability}/{readiness.residents.inBlockTotal} have availability configured · {readiness?.vacation?.list?.length ?? 0} residents have vacation · {unresolved.length} unresolved resident records</div>
      {missing.length > 0 && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--warn-ink-strong)' }}>Missing: {missing.map(item => item.residentName).join(', ')}</div>}
      {unresolved.length > 0 && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--warn-ink-strong)' }}>Resolve: {unresolved.map(item => item.residentName).join(', ')}</div>}
      {readiness.blockers.filter(item => item.code === 'NO_SENIOR_AVAILABLE' || item.code === 'NO_JUNIOR_AVAILABLE').map(item => <p key={item.code} style={{ marginTop: 6, fontSize: 12, color: 'var(--warn-ink-strong)' }}>{item.message}</p>)}
    </section>}

    {readiness && <p style={{ color: 'var(--ink-3)', fontSize: 13, marginBottom: 16 }}>{readiness.attending.complete ? 'Every day has an attending entry. Continue to Schedule to generate and review.' : `${readiness.attending.totalDays - readiness.attending.daysCovered} days still need attending entries. Continue to Attendings to review coverage.`}</p>}
    <label className="workspace-search">Find residents in either list<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or home program" /></label>

    <div className="block-transfer-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16 }}>
      <section style={{ border: '1px solid var(--border-2)', borderRadius: 14, background: 'var(--surface-2)', padding: 14 }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}><div><h2 style={{ margin: 0, color: 'var(--ink-1)', fontSize: 16 }}>Available residents</h2><span style={{ color: 'var(--ink-4)', fontSize: 11 }}>{available.length} directory records</span></div>{canCreate && <button type="button" onClick={() => setCreating(true)} style={{ ...buttonBase, background: 'var(--surface-1)', border: '1px solid var(--border-strong)', color: 'var(--accent)' }}>+ New rotating resident</button>}</div><ul style={{ margin: 0, padding: 0, display: 'grid', gap: 8 }}>{available.length ? available.map(resident => <ResidentSummary key={resident.id} resident={resident} action={canManage ? () => add(resident) : null} actionLabel="Add →" />) : <li style={{ listStyle: 'none', color: 'var(--ink-4)', fontSize: 13, padding: 12 }}>Everyone eligible is already in this block.</li>}</ul></section>
      <section style={{ border: '1px solid var(--info-border)', borderRadius: 14, background: 'var(--info-soft)', padding: 14 }}><div style={{ marginBottom: 12 }}><h2 style={{ margin: 0, color: 'var(--ink-1)', fontSize: 16 }}>In this block</h2><span style={{ color: 'var(--ink-4)', fontSize: 11 }}>{composition?.counts?.inService ?? 0} in-service · {composition?.counts?.offService ?? 0} off-service · {composition?.counts?.medicalStudents ?? 0} medical students</span></div><ul style={{ margin: 0, padding: 0, display: 'grid', gap: 8 }}>{inBlock.map(resident => <ResidentSummary key={resident.id} resident={resident} action={canManage && (!resident.isServiceResident || resident.isMedStudent) ? () => remove(resident) : null} actionLabel="Remove" secondaryAction={canManage ? <button type="button" onClick={() => setEditingAvailability(resident)} style={{ ...buttonBase, minHeight: 34, padding: '6px 9px', border: `1px solid ${resident.availabilityConfirmed ? 'var(--success-border-2)' : 'var(--warn-border-2)'}`, background: 'var(--surface-1)', color: resident.availabilityConfirmed ? 'var(--success-ink-strong)' : 'var(--warn-ink-strong)' }}>{resident.availabilityConfirmed ? 'Availability' : 'Configure'}</button> : null} />)}</ul></section>
    </div>
    {editingAvailability && <BlockResidentAvailabilityModal resident={editingAvailability} blockId={block.id} blockStart={String(block.startDate).slice(0, 10)} blockEnd={String(block.endDate).slice(0, 10)} onClose={() => setEditingAvailability(null)} onSaved={load} />}
    {creating && <ResidentFormModal programId={currentProgram?.programId} blockId={block.id} existingResidents={[...(composition.inBlock ?? []), ...(composition.available ?? [])]} onUseExisting={item => { setCreating(false); if (item.isEnrolledThisBlock) setEditingAvailability(item); else add(item); }} onClose={() => setCreating(false)} onSaved={load} />}
  </Layout>;
}
