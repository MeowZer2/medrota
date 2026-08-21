import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import api from '../api/axios';
import { useBlock, useUser } from '../context/AppContext';

function formatRange(block) {
  const options = { month: 'short', day: 'numeric', year: 'numeric' };
  return `${new Date(block.startDate).toLocaleDateString(undefined, options)} – ${new Date(block.endDate).toLocaleDateString(undefined, options)}`;
}

const pgyLabel = value => /^\d+$/.test(String(value)) ? `PGY-${value}` : String(value);

export default function BlockPage() {
  const { blockNumber } = useParams();
  const navigate = useNavigate();
  const { currentAcademicYear, currentBlock, setCurrentBlock } = useBlock();
  const { can } = useUser();
  const block = useMemo(() => (currentAcademicYear?.blocks ?? []).find(item => item.number === Number(blockNumber)) ?? currentBlock, [currentAcademicYear, currentBlock, blockNumber]);
  const [composition, setComposition] = useState(null);
  const [readiness, setReadiness] = useState(null);
  useEffect(() => { if (block && block.id !== currentBlock?.id) setCurrentBlock(block); }, [block, currentBlock?.id, setCurrentBlock]);
  useEffect(() => {
    if (!block?.id) return;
    Promise.all([api.get(`/residents/block/${block.id}/composition`), api.get(`/blocks/${block.id}/readiness`).catch(() => ({ data: null }))]).then(([compositionResponse, readinessResponse]) => { setComposition(compositionResponse.data); setReadiness(readinessResponse.data); }).catch(() => {});
  }, [block?.id]);
  if (!block) return <Layout><p>Select a block.</p></Layout>;
  const roster = composition?.inBlock ?? [];
  const missing = readiness?.residents?.missingAvailability ?? [];
  const unresolved = readiness?.residents?.unresolvedRecords ?? [];
  return <Layout>
    <header style={{ marginBottom: 22 }}><h1 style={{ margin: 0, color: 'var(--ink-1)', fontSize: 29 }}>Block {block.number}</h1><p style={{ margin: '6px 0 0', color: 'var(--ink-4)', fontSize: 14 }}>{formatRange(block)}</p></header>
    <section data-testid="residents-this-block" style={{ border: '1px solid var(--accent-border)', borderRadius: 15, background: 'var(--surface-1)', overflow: 'hidden', marginBottom: 18 }}>
      <div style={{ padding: 17, borderBottom: '1px solid var(--border-1)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}><div><h2 style={{ margin: 0, color: 'var(--ink-1)', fontSize: 18 }}>Residents this block</h2><p style={{ margin: '5px 0 0', color: 'var(--ink-4)', fontSize: 12 }}>{composition?.counts?.inService ?? 0} in-service · {composition?.counts?.offService ?? 0} off-service · {composition?.counts?.medicalStudents ?? 0} medical students</p></div>{can('manage_block_availability') && <button type="button" onClick={() => navigate(`/blocks/${block.number}/residents`)} style={{ minHeight: 40, padding: '9px 13px', border: 0, borderRadius: 9, background: 'var(--brand)', color: 'var(--ink-inverse)', fontWeight: 700 }}>Manage block residents</button>}</div>
      <div>{roster.length === 0 ? <p style={{ margin: 0, padding: 18, color: 'var(--ink-4)' }}>No residents are participating yet.</p> : roster.slice(0, 8).map(resident => <div key={resident.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(160px,1fr) minmax(120px,.7fr) auto', gap: 12, alignItems: 'center', padding: '12px 17px', borderBottom: '1px solid var(--border-subtle)' }}><div><strong style={{ color: 'var(--ink-1)', fontSize: 13 }}>{resident.displayName || resident.name}</strong><div style={{ color: 'var(--ink-4)', fontSize: 11, marginTop: 3 }}>{resident.isMedStudent ? 'Medical Student' : `${pgyLabel(resident.pgyLevel)} · ${resident.isServiceResident ? 'In-service' : 'Off-service'}`}{!resident.isActive && ' · Inactive'}</div></div><span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{resident.workload?.daysOnService ?? 0} days on service</span><span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{resident.callCount} calls</span></div>)}</div>
    </section>
    {readiness && <section style={{ border: `1px solid ${missing.length || unresolved.length ? 'var(--warn-border-2)' : 'var(--success-border-2)'}`, background: missing.length || unresolved.length ? 'var(--warn-soft)' : 'var(--success-soft)', borderRadius: 14, padding: 17, marginBottom: 18 }}><h2 style={{ margin: 0, color: missing.length || unresolved.length ? 'var(--warn-ink-strong)' : 'var(--success-ink-strong)', fontSize: 16 }}>Resident readiness</h2><div style={{ marginTop: 7, color: 'var(--ink-3)', fontSize: 13 }}>{readiness.residents.inBlockTotal} active residents in this block · {readiness.residents.withAvailability}/{readiness.residents.inBlockTotal} have availability configured · {readiness?.vacation?.list?.length ?? 0} residents have vacation · {unresolved.length} unresolved resident records</div>{missing.length || unresolved.length ? <><div style={{ marginTop: 8, color: 'var(--warn-ink-strong)', fontSize: 12 }}>{missing.length > 0 && `Missing: ${missing.map(item => item.residentName).join(', ')}`}{missing.length > 0 && unresolved.length > 0 && ' · '}{unresolved.length > 0 && `Resolve: ${unresolved.map(item => item.residentName).join(', ')}`}</div><button type="button" onClick={() => navigate(`/blocks/${block.number}/residents`)} style={{ marginTop: 10, border: 0, background: 'transparent', padding: 0, color: 'var(--warn-ink-strong)', fontWeight: 700 }}>Manage block residents →</button></> : <strong style={{ display: 'block', marginTop: 9, color: 'var(--success-ink-strong)', fontSize: 13 }}>Ready to generate</strong>}</section>}
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" onClick={() => navigate(`/blocks/${block.number}/calendar`)} style={{ minHeight: 42, padding: '10px 15px', border: 0, borderRadius: 9, background: 'var(--brand)', color: 'var(--ink-inverse)', fontWeight: 700 }}>{can('generate_schedule') ? 'Open schedule & generate' : 'Open published schedule'}</button>{can('manage_block_settings') && <button type="button" onClick={() => navigate(`/blocks/${block.number}/settings`)} style={{ minHeight: 42, padding: '10px 15px', border: '1px solid var(--border-strong)', borderRadius: 9, background: 'var(--surface-1)', color: 'var(--accent)', fontWeight: 700 }}>Block settings</button>}</div>
  </Layout>;
}
