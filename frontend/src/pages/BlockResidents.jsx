import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import AcademicTimeEditor from '../components/AcademicTimeEditor';
import ResidentFormModal from '../components/ResidentFormModal';
import api from '../api/axios';
import { useBlock, useUser } from '../context/AppContext';

const buttonBase = { minHeight: 38, borderRadius: 9, padding: '8px 12px', fontSize: 13, fontWeight: 700 };
const inputStyle = { width: '100%', minHeight: 40, padding: '8px 10px', border: '1px solid var(--border-strong)', borderRadius: 9, color: 'var(--ink-1)' };

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
          {workload && <div style={{ marginTop: 8, color: 'var(--ink-3)', fontSize: 11, lineHeight: 1.55 }}>
            <div>Block days: {workload.blockDays} · Vacation: {workload.vacationDays} · Other unavailable: {workload.otherUnavailableDays} · Days on service: {workload.daysOnService}</div>
            <div>Call type: {workload.callType === 'in_house' ? 'In-house' : 'Home'} · PARO maximum: {workload.paroMaximum}{workload.localMaximum != null ? ` · Local maximum: ${workload.localMaximum}` : ''} · Assigned: {workload.assigned}</div>
          </div>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {secondaryAction}
          {action && <button type="button" disabled={actionDisabled} onClick={action} style={{ ...buttonBase, minHeight: 34, padding: '6px 9px', border: '1px solid var(--border-strong)', background: actionDisabled ? 'var(--surface-2)' : 'var(--surface-1)', color: actionDisabled ? 'var(--ink-5)' : 'var(--accent)' }}>{actionLabel}</button>}
        </div>
      </div>
    </li>
  );
}

function DateListEditor({ label, dates, onChange }) {
  const [nextDate, setNextDate] = useState('');
  const keys = dates.map(value => String(value).slice(0, 10));
  return <div><label style={{ display: 'block', color: 'var(--ink-2)', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{label}</label><div style={{ display: 'flex', gap: 7 }}><input type="date" aria-label={`Add ${label.toLowerCase()}`} value={nextDate} onChange={event => setNextDate(event.target.value)} style={inputStyle} /><button type="button" onClick={() => { if (nextDate && !keys.includes(nextDate)) onChange([...keys, nextDate]); setNextDate(''); }} style={{ ...buttonBase, border: '1px solid var(--border-strong)', background: 'var(--surface-1)', color: 'var(--accent)' }}>Add</button></div>{keys.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>{keys.map(date => <button key={date} type="button" aria-label={`Remove ${label.toLowerCase()} ${date}`} onClick={() => onChange(keys.filter(item => item !== date))} style={{ border: 0, borderRadius: 999, padding: '5px 8px', background: 'var(--surface-3)', color: 'var(--ink-3)', fontSize: 11 }}>{date} ×</button>)}</div>}</div>;
}

function AvailabilityModal({ resident, blockId, onClose, onSaved }) {
  const [vacationDates, setVacationDates] = useState(resident.vacationDates ?? []);
  const [otherUnavailableDates, setOtherUnavailableDates] = useState(resident.otherUnavailableDates ?? []);
  const [academicTimes, setAcademicTimes] = useState(resident.academicTimes ?? []);
  const [callCapOverride, setCallCapOverride] = useState(resident.callCapOverride ?? '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/residents/${resident.id}`, { blockId, vacationDates, otherUnavailableDates, academicTimes, callCapOverride: callCapOverride === '' ? null : Number(callCapOverride), availabilityConfirmed: true });
      toast.success('Block availability confirmed'); await onSaved(); onClose();
    } catch (error) { toast.error(error.response?.data?.error ?? 'Could not save availability'); }
    finally { setSaving(false); }
  };
  return <Modal title={`Availability · ${resident.displayName || resident.name}`} description="This block only" onClose={onClose} maxWidth="max-w-xl" footer={<div style={{ display: 'flex', gap: 8 }}><button type="button" onClick={onClose} style={{ ...buttonBase, flex: 1, background: 'var(--surface-1)', border: '1px solid var(--border-strong)' }}>Cancel</button><button type="button" onClick={save} disabled={saving} data-testid="save-block-availability" style={{ ...buttonBase, flex: 1, background: 'var(--brand)', color: 'var(--ink-inverse)', border: 0 }}>{saving ? 'Saving…' : 'Confirm availability'}</button></div>}>
    <div style={{ display: 'grid', gap: 18 }}>
      <DateListEditor label="Vacation" dates={vacationDates} onChange={setVacationDates} />
      <DateListEditor label="Other unavailable" dates={otherUnavailableDates} onChange={setOtherUnavailableDates} />
      <div><label style={{ display: 'block', color: 'var(--ink-2)', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Academic time</label><AcademicTimeEditor value={academicTimes} onChange={setAcademicTimes} /></div>
      <div><label htmlFor="local-call-cap" style={{ display: 'block', color: 'var(--ink-2)', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Local call maximum (optional)</label><input id="local-call-cap" type="number" min="1" value={callCapOverride} onChange={event => setCallCapOverride(event.target.value)} style={inputStyle} /></div>
    </div>
  </Modal>;
}

export default function BlockResidents() {
  const { blockNumber } = useParams();
  const navigate = useNavigate();
  const { currentAcademicYear, currentBlock, setCurrentBlock } = useBlock();
  const { currentProgram, can } = useUser();
  const block = useMemo(() => (currentAcademicYear?.blocks ?? []).find(item => item.number === Number(blockNumber)) ?? currentBlock, [blockNumber, currentAcademicYear, currentBlock]);
  const [composition, setComposition] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [editingAvailability, setEditingAvailability] = useState(null);
  const [creating, setCreating] = useState(false);
  const canManage = can('manage_block_availability');
  const canCreate = can('manage_residents') && canManage;
  const blockId = block?.id;

  useEffect(() => { if (block && block.id !== currentBlock?.id) setCurrentBlock(block); }, [block, currentBlock?.id, setCurrentBlock]);
  const load = useCallback(async () => {
    if (!blockId) return;
    try {
      const [compositionResponse, readinessResponse] = await Promise.all([api.get(`/residents/block/${blockId}/composition`), api.get(`/blocks/${blockId}/readiness`).catch(() => ({ data: null }))]);
      setComposition(compositionResponse.data); setReadiness(readinessResponse.data);
    } catch (error) { toast.error(error.response?.data?.error ?? 'Could not load block residents'); }
  }, [blockId]);
  useEffect(() => { load(); }, [load]);

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
  const inBlock = composition?.inBlock ?? [];
  const available = composition?.available ?? [];
  const missing = readiness?.residents?.missingAvailability ?? [];
  const unresolved = readiness?.residents?.unresolvedRecords ?? [];
  const needsAttention = missing.length > 0 || unresolved.length > 0;
  return <Layout>
    <header style={{ marginBottom: 20 }}><button type="button" onClick={() => navigate(`/blocks/${block.number}`)} style={{ border: 0, background: 'transparent', color: 'var(--accent)', fontWeight: 700, padding: '5px 0' }}>← Block {block.number}</button><h1 style={{ margin: '7px 0 0', color: 'var(--ink-1)', fontSize: 28 }}>Manage block residents</h1><p style={{ margin: '6px 0 0', color: 'var(--ink-4)', fontSize: 14 }}>Choose who is rotating, then confirm each resident’s block availability.</p></header>

    {readiness && <section data-testid="block-resident-readiness" style={{ border: `1px solid ${needsAttention ? 'var(--warn-border-2)' : 'var(--success-border-2)'}`, background: needsAttention ? 'var(--warn-soft)' : 'var(--success-soft)', borderRadius: 12, padding: 14, marginBottom: 18 }}>
      <strong style={{ color: needsAttention ? 'var(--warn-ink-strong)' : 'var(--success-ink-strong)' }}>{needsAttention ? 'Needs attention' : 'Ready to generate'}</strong>
      <div style={{ marginTop: 5, color: 'var(--ink-3)', fontSize: 12 }}>{composition?.counts?.total ?? 0} active residents in this block · {readiness.residents.withAvailability}/{readiness.residents.inBlockTotal} have availability configured · {readiness?.vacation?.list?.length ?? 0} residents have vacation · {unresolved.length} unresolved resident records</div>
      {missing.length > 0 && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--warn-ink-strong)' }}>Missing: {missing.map(item => item.residentName).join(', ')}</div>}
      {unresolved.length > 0 && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--warn-ink-strong)' }}>Resolve: {unresolved.map(item => item.residentName).join(', ')}</div>}
    </section>}

    <div className="block-transfer-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16 }}>
      <section style={{ border: '1px solid var(--border-2)', borderRadius: 14, background: 'var(--surface-2)', padding: 14 }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}><div><h2 style={{ margin: 0, color: 'var(--ink-1)', fontSize: 16 }}>Available residents</h2><span style={{ color: 'var(--ink-4)', fontSize: 11 }}>{available.length} directory records</span></div>{canCreate && <button type="button" onClick={() => setCreating(true)} style={{ ...buttonBase, background: 'var(--surface-1)', border: '1px solid var(--border-strong)', color: 'var(--accent)' }}>+ New rotating resident</button>}</div><ul style={{ margin: 0, padding: 0, display: 'grid', gap: 8 }}>{available.length ? available.map(resident => <ResidentSummary key={resident.id} resident={resident} action={canManage ? () => add(resident) : null} actionLabel="Add →" />) : <li style={{ listStyle: 'none', color: 'var(--ink-4)', fontSize: 13, padding: 12 }}>Everyone eligible is already in this block.</li>}</ul></section>
      <section style={{ border: '1px solid var(--info-border)', borderRadius: 14, background: 'var(--info-soft)', padding: 14 }}><div style={{ marginBottom: 12 }}><h2 style={{ margin: 0, color: 'var(--ink-1)', fontSize: 16 }}>In this block</h2><span style={{ color: 'var(--ink-4)', fontSize: 11 }}>{composition?.counts?.inService ?? 0} in-service · {composition?.counts?.offService ?? 0} off-service · {composition?.counts?.medicalStudents ?? 0} medical students</span></div><ul style={{ margin: 0, padding: 0, display: 'grid', gap: 8 }}>{inBlock.map(resident => <ResidentSummary key={resident.id} resident={resident} action={canManage && (!resident.isServiceResident || resident.isMedStudent) ? () => remove(resident) : null} actionLabel="Remove" secondaryAction={canManage ? <button type="button" onClick={() => setEditingAvailability(resident)} style={{ ...buttonBase, minHeight: 34, padding: '6px 9px', border: `1px solid ${resident.availabilityConfirmed ? 'var(--success-border-2)' : 'var(--warn-border-2)'}`, background: 'var(--surface-1)', color: resident.availabilityConfirmed ? 'var(--success-ink-strong)' : 'var(--warn-ink-strong)' }}>{resident.availabilityConfirmed ? 'Availability' : 'Configure'}</button> : null} />)}</ul></section>
    </div>
    {editingAvailability && <AvailabilityModal resident={editingAvailability} blockId={block.id} onClose={() => setEditingAvailability(null)} onSaved={load} />}
    {creating && <ResidentFormModal programId={currentProgram?.programId} blockId={block.id} onClose={() => setCreating(false)} onSaved={load} />}
  </Layout>;
}
