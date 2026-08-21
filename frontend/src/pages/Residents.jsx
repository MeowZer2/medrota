import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import BlockSelector from '../components/BlockSelector';
import ResidentFormModal from '../components/ResidentFormModal';
import api from '../api/axios';
import { useBlock, useUser } from '../context/AppContext';

const badge = (background, color) => ({ background, color, borderRadius: 999, padding: '3px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' });

function classificationLabel(resident) {
  if (resident.isMedStudent) return 'Medical Student';
  return resident.isServiceResident ? 'In-service' : 'Off-service';
}

const pgyLabel = value => /^\d+$/.test(String(value)) ? `PGY-${value}` : String(value);

function DirectoryRow({ resident, canEdit, onEdit, onDeactivate }) {
  return (
    <article data-testid={`directory-resident-${resident.id}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(190px,1.4fr) minmax(150px,1fr) minmax(130px,.7fr) auto', gap: 16, alignItems: 'center', padding: '15px 16px', borderBottom: '1px solid #E8EFF6', opacity: resident.isActive ? 1 : .62 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7 }}>
          <strong style={{ color: '#1A3A5C', fontSize: 14 }}>{resident.displayName || resident.name}</strong>
          <span style={badge(resident.isMedStudent ? '#FEF3C7' : resident.isServiceResident ? '#DBEAFE' : '#EDE9FE', resident.isMedStudent ? '#92400E' : resident.isServiceResident ? '#1D4ED8' : '#6D28D9')}>{classificationLabel(resident)}</span>
          {!resident.isActive && <span style={badge('#F1F5F9', '#64748B')}>Inactive</span>}
        </div>
        {!resident.isServiceResident && resident.homeProgram && <div style={{ marginTop: 5, color: '#64748B', fontSize: 12 }}>Home program: {resident.homeProgram}</div>}
      </div>
      <div>
        {!resident.isMedStudent && <><div style={{ color: '#334155', fontWeight: 700, fontSize: 13 }}>{pgyLabel(resident.pgyLevel)}</div><div style={{ color: '#94A3B8', fontSize: 11 }}>{resident.pgySource === 'calculated' ? 'Calculated' : 'Manual'} · {resident.residentRole}</div></>}
      </div>
      <div style={{ minWidth: 0, color: '#64748B', fontSize: 12 }}>
        {resident.email && <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{resident.email}</div>}
        {resident.phone && <div>{resident.phone}</div>}
        {!resident.email && !resident.phone && 'No contact details'}
      </div>
      {canEdit && <div style={{ display: 'flex', gap: 7 }}>
        <button type="button" onClick={() => onEdit(resident)} aria-label={`Edit ${resident.displayName || resident.name}`} style={{ minHeight: 36, padding: '7px 11px', borderRadius: 8, border: '1px solid #CBD5E1', background: '#fff', color: '#2C5F8A', fontWeight: 700 }}>Edit</button>
        {resident.isActive && <button type="button" onClick={() => onDeactivate(resident)} aria-label={`Deactivate ${resident.displayName || resident.name}`} style={{ minHeight: 36, padding: '7px 11px', borderRadius: 8, border: '1px solid #FECACA', background: '#fff', color: '#B91C1C', fontWeight: 700 }}>Deactivate</button>}
      </div>}
    </article>
  );
}

export default function Residents() {
  const navigate = useNavigate();
  const { currentProgram, can } = useUser();
  const { currentBlock, setCurrentBlock, currentAcademicYear } = useBlock();
  const programId = currentProgram?.programId;
  const canEdit = can('manage_residents');
  const [residents, setResidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!programId) return;
    setLoading(true);
    try { setResidents((await api.get(`/residents?programId=${programId}`)).data); }
    catch (error) { toast.error(error.response?.data?.error ?? 'Could not load Resident Directory'); }
    finally { setLoading(false); }
  }, [programId]);

  useEffect(() => { load(); }, [load]);

  const deactivate = async resident => {
    if (!window.confirm(`Deactivate ${resident.displayName || resident.name}? Historical schedules will remain unchanged.`)) return;
    try { await api.delete(`/residents/${resident.id}`); await load(); toast.success('Resident deactivated'); }
    catch (error) { toast.error(error.response?.data?.error ?? 'Could not deactivate resident'); }
  };

  return (
    <Layout>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 22 }}>
        <div><h1 style={{ margin: 0, color: '#1A3A5C', fontSize: 28, fontWeight: 750 }}>Resident Directory</h1><p style={{ margin: '6px 0 0', color: '#64748B', fontSize: 14 }}>Program-level people and training records. Block participation is managed from each Block.</p></div>
        {canEdit && <button type="button" onClick={() => setAdding(true)} className="primary-btn" style={{ minHeight: 40, padding: '9px 15px' }}>Add Resident</button>}
      </header>

      {currentBlock && <section style={{ border: '1px solid #BFDBFE', background: '#EFF6FF', borderRadius: 12, padding: 14, marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div><strong style={{ color: '#1E3A5F', fontSize: 13 }}>Need to change who is rotating?</strong><div style={{ color: '#64748B', fontSize: 12, marginTop: 3 }}>Manage Block {currentBlock.number} residents, availability, vacation, and academic time from the block workflow.</div></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <BlockSelector blocks={currentAcademicYear?.blocks ?? []} activeBlockId={currentBlock.id} onSelect={setCurrentBlock} />
          <button type="button" data-testid="set-block-availability" onClick={() => navigate(`/blocks/${currentBlock.number}/residents`)} style={{ minHeight: 38, padding: '8px 12px', borderRadius: 9, border: '1px solid #93C5FD', background: '#fff', color: '#1D4ED8', fontWeight: 700 }}>Manage block residents</button>
        </div>
      </section>}

      <section style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '13px 16px', background: '#F8FAFC', color: '#64748B', fontSize: 12 }}>{residents.filter(item => item.isActive).length} active · {residents.length} total</div>
        {loading ? <div style={{ padding: 32, textAlign: 'center', color: '#64748B' }}>Loading directory…</div> : residents.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>No residents in the directory yet.</div> : residents.map(resident => <DirectoryRow key={resident.id} resident={resident} canEdit={canEdit} onEdit={setEditing} onDeactivate={deactivate} />)}
      </section>

      {(adding || editing) && <ResidentFormModal programId={programId} resident={editing} onClose={() => { setAdding(false); setEditing(null); }} onSaved={load} />}
    </Layout>
  );
}
