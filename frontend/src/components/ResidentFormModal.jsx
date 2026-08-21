import { useState } from 'react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from './Modal';

const inputStyle = { width: '100%', minHeight: 40, padding: '9px 11px', borderRadius: 9, border: '1px solid var(--border-strong)', color: 'var(--ink-1)', background: 'var(--surface-1)' };
const labelStyle = { display: 'block', marginBottom: 5, color: 'var(--ink-2)', fontSize: 12, fontWeight: 700 };

function initialForm(resident) {
  if (!resident) return { name: '', classification: 'in_service', programStartDate: '', expectedCompletionDate: '', pgyLevel: '1', residentRole: 'junior', residentRoleOverride: '', email: '', phone: '', homeProgram: '', isActive: true };
  return {
    name: resident.name ?? '',
    classification: resident.isMedStudent ? 'medical_student' : resident.isServiceResident ? 'in_service' : 'off_service',
    programStartDate: resident.programStartDate?.slice(0, 10) ?? '', expectedCompletionDate: resident.expectedCompletionDate?.slice(0, 10) ?? '',
    pgyLevel: resident.manualPgyLevel ?? resident.pgyLevel ?? '1', residentRole: resident.manualResidentRole ?? resident.residentRole ?? 'junior',
    residentRoleOverride: resident.residentRoleOverride ?? '', email: resident.email ?? '', phone: resident.phone ?? '', homeProgram: resident.homeProgram ?? '', isActive: resident.isActive !== false,
  };
}

export default function ResidentFormModal({ programId, blockId = null, resident = null, onClose, onSaved }) {
  const [form, setForm] = useState(() => initialForm(resident));
  const [saving, setSaving] = useState(false);
  const set = (field, value) => setForm(current => ({ ...current, [field]: value }));
  const inService = form.classification === 'in_service';
  const medicalStudent = form.classification === 'medical_student';
  const baseLevels = medicalStudent ? ['Medical Student', 'MS1', 'MS2', 'MS3', 'MS4'] : [...Array.from({ length: 10 }, (_, index) => String(index + 1)), 'Fellow'];
  const levelOptions = baseLevels.includes(String(form.pgyLevel)) ? baseLevels : [String(form.pgyLevel), ...baseLevels];
  const changeClassification = classification => setForm(current => ({
    ...current,
    classification,
    pgyLevel: classification === 'medical_student'
      ? (/^MS|Medical Student$/i.test(String(current.pgyLevel)) ? current.pgyLevel : 'Medical Student')
      : (/^MS|Medical Student$/i.test(String(current.pgyLevel)) ? '1' : current.pgyLevel),
  }));

  const save = async event => {
    event.preventDefault();
    if (!form.name.trim()) return toast.error('Name is required');
    if (inService && !form.programStartDate && !form.pgyLevel) return toast.error('Add a program start date or manual PGY');
    setSaving(true);
    try {
      const payload = {
        programId, blockId: resident ? undefined : blockId || undefined, name: form.name.trim(),
        isServiceResident: inService, isMedStudent: medicalStudent,
        programStartDate: inService ? form.programStartDate || null : null,
        expectedCompletionDate: inService ? form.expectedCompletionDate || null : null,
        pgyLevel: form.pgyLevel, residentRole: form.residentRole,
        residentRoleOverride: form.residentRoleOverride || null,
        email: form.email, phone: form.phone, homeProgram: inService ? null : form.homeProgram,
        isActive: form.isActive,
      };
      if (resident) await api.put(`/residents/${resident.id}`, payload);
      else await api.post('/residents', payload);
      toast.success(resident ? 'Resident updated' : 'Resident added');
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.error ?? 'Could not save resident');
    } finally { setSaving(false); }
  };

  return (
    <Modal title={resident ? 'Edit resident' : 'Add Resident'} description="Resident Directory" onClose={onClose} maxWidth="max-w-2xl" footer={(
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" onClick={onClose} disabled={saving} className="secondary-btn" style={{ flex: 1 }}>Cancel</button>
        <button type="submit" form="resident-directory-form" disabled={saving} className="primary-btn" style={{ flex: 1 }}>{saving ? 'Saving…' : 'Save resident'}</button>
      </div>
    )}>
      <form id="resident-directory-form" onSubmit={save} style={{ display: 'grid', gap: 14 }}>
        <div><label htmlFor="resident-name" style={labelStyle}>Name</label><input id="resident-name" value={form.name} onChange={event => set('name', event.target.value)} style={inputStyle} required /></div>
        <div><label htmlFor="resident-classification" style={labelStyle}>Service classification</label><select id="resident-classification" value={form.classification} onChange={event => changeClassification(event.target.value)} style={inputStyle}><option value="in_service">In-service resident</option><option value="off_service">Off-service resident</option><option value="medical_student">Medical Student</option></select></div>
        {inService ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
            <div><label htmlFor="program-start-date" style={labelStyle}>Program start date</label><input id="program-start-date" type="date" value={form.programStartDate} onChange={event => set('programStartDate', event.target.value)} style={inputStyle} /></div>
            <div><label htmlFor="expected-completion-date" style={labelStyle}>Expected program completion date</label><input id="expected-completion-date" type="date" value={form.expectedCompletionDate} onChange={event => set('expectedCompletionDate', event.target.value)} style={inputStyle} /></div>
          </div>
        ) : <div><label htmlFor="home-program" style={labelStyle}>Home program / specialty</label><input id="home-program" value={form.homeProgram} onChange={event => set('homeProgram', event.target.value)} placeholder={medicalStudent ? 'Optional' : 'e.g. General Surgery'} style={inputStyle} /></div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
          <div><label htmlFor="manual-pgy" style={labelStyle}>{medicalStudent ? 'Training level' : 'Manual PGY fallback'}</label><select id="manual-pgy" value={form.pgyLevel} onChange={event => set('pgyLevel', event.target.value)} style={inputStyle}>{levelOptions.map(level => <option key={level} value={level}>{medicalStudent || level === 'Fellow' ? level : `PGY-${level}`}</option>)}</select></div>
          {!medicalStudent && <div><label htmlFor="role-override" style={labelStyle}>Role override</label><select id="role-override" value={form.residentRoleOverride} onChange={event => set('residentRoleOverride', event.target.value)} style={inputStyle}><option value="">Automatic / legacy</option><option value="junior">Junior</option><option value="senior">Senior</option></select></div>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
          <div><label htmlFor="resident-email" style={labelStyle}>Email (optional)</label><input id="resident-email" type="email" value={form.email} onChange={event => set('email', event.target.value)} style={inputStyle} /></div>
          <div><label htmlFor="resident-phone" style={labelStyle}>Phone (optional)</label><input id="resident-phone" type="tel" value={form.phone} onChange={event => set('phone', event.target.value)} style={inputStyle} /></div>
        </div>
        {resident && <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 13, color: 'var(--ink-2)' }}><input type="checkbox" checked={form.isActive} onChange={event => set('isActive', event.target.checked)} />Active in Resident Directory</label>}
      </form>
    </Modal>
  );
}
