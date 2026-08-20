import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import Layout from '../components/Layout';
import PageWrapper from '../components/PageWrapper';
import api from '../api/axios';
import AuditHistory from '../components/AuditHistory';
import Modal from '../components/Modal';
import { useBlock, useUser } from '../context/AppContext';
import { ROLE_OPTIONS } from '../constants/roles';
import { MEDICAL_SPECIALTIES } from '../constants/medicalSpecialties';

// -- helpers ------------------------------------------------------------------

function Card({ title, subtitle, children }) {
  // No overflow clipping here on purpose. A clipping card used to hide the
  // trailing action button of any row that grew past the card width, which left
  // Deactivate/Restore impossible to reach with a pointer. Rows now shrink.
  return (
    <div style={{ background: '#fff', border: '1px solid #E8EFF6', borderRadius: 12, boxShadow: '0 1px 3px rgba(26,58,92,0.05)', marginBottom: 20 }}>
      <div style={{ padding: '18px 24px', borderBottom: '1px solid #E8EFF6', background: '#F8FAFC', borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1A3A5C', margin: 0 }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 12, color: '#94A3B8', margin: '3px 0 0' }}>{subtitle}</p>}
      </div>
      <div style={{ padding: '20px 24px' }}>{children}</div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: '1px solid #E2E8F0', fontSize: 14, color: '#1A3A5C',
  background: '#F8FAFC', outline: 'none', boxSizing: 'border-box',
};

const primaryButtonStyle = {
  padding: '9px 14px', border: 0, borderRadius: 8, background: '#1A3A5C',
  color: '#fff', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
};

const deactivateButtonStyle = {
  padding: '7px 12px', border: '1px solid #E2E8F0', borderRadius: 7, background: '#fff',
  color: '#64748B', fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 34, whiteSpace: 'nowrap',
};

const restoreButtonStyle = {
  padding: '7px 12px', border: '1px solid #BBF7D0', borderRadius: 7, background: '#F0FDF4',
  color: '#15803D', fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 34, whiteSpace: 'nowrap',
};

function Label({ htmlFor, children }) {
  return (
    <label htmlFor={htmlFor} style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#64748B', marginBottom: 5 }}>
      {children}
    </label>
  );
}

function InactiveBadge() {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: '#B45309', background: '#FEF3C7', padding: '2px 7px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
      Inactive
    </span>
  );
}

// Summary line plus the disclosure that reveals deactivated records. The
// inactive group is never rendered until it is asked for, so a healthy registry
// stays a single short list.
function RegistryHeader({ activeCount, inactiveCount, noun, showInactive, onToggle }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>
        {activeCount} active {noun}
      </span>
      {(inactiveCount > 0 || showInactive) && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={showInactive}
          style={{ padding: '6px 11px', border: '1px solid #E2E8F0', borderRadius: 7, background: '#F8FAFC', color: '#2C5F8A', fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 32, whiteSpace: 'nowrap' }}
        >
          {showInactive ? `Hide inactive ${noun}` : `Show inactive ${noun} (${inactiveCount})`}
        </button>
      )}
    </div>
  );
}

function InactiveGroup({ noun, isEmpty, children }) {
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed #E2E8F0' }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>
        Inactive {noun}
      </p>
      {isEmpty
        ? <p style={{ fontSize: 13, color: '#94A3B8', margin: 0 }}>No inactive {noun}.</p>
        : children}
    </div>
  );
}

function RegistryRow({ item, canManage, onSave }) {
  const [name, setName] = useState(item.name);
  useEffect(() => setName(item.name), [item.name]);
  const references = (item._count?.attendingEntries ?? 0) + (item._count?.attendingTemplates ?? 0);
  return (
    <div className="settings-registry-row">
      <div className="settings-registry-main">
        <input
          aria-label={`${item.name} name`}
          value={name}
          onChange={event => setName(event.target.value)}
          disabled={!canManage}
          style={{ ...inputStyle, background: canManage ? '#F8FAFC' : '#fff' }}
        />
        {references > 0 && <span style={{ display: 'block', fontSize: 11, color: '#94A3B8', marginTop: 3 }}>{references} schedule reference{references === 1 ? '' : 's'} preserved</span>}
      </div>
      <div className="settings-registry-actions">
        {!item.isActive && <InactiveBadge />}
        {canManage && name.trim() !== item.name && (
          <button onClick={() => onSave(item.id, { name })} style={{ padding: '7px 12px', border: '1px solid #D6E4F7', borderRadius: 7, background: '#EEF4FF', color: '#2C5F8A', fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 34 }}>Save</button>
        )}
        {canManage ? (
          <button
            type="button"
            aria-label={`${item.isActive ? 'Deactivate' : 'Restore'} ${item.name}`}
            onClick={() => onSave(item.id, { isActive: !item.isActive })}
            style={item.isActive ? deactivateButtonStyle : restoreButtonStyle}
          >
            {item.isActive ? 'Deactivate' : 'Restore'}
          </button>
        ) : <span style={{ fontSize: 11, color: item.isActive ? '#15803D' : '#94A3B8' }}>{item.isActive ? 'Active' : 'Inactive'}</span>}
      </div>
    </div>
  );
}

// Active-first registry list. Deactivated entries leave the main list entirely
// instead of sitting in it greyed out.
function RegistryList({ items, canManage, noun, emptyMessage, onSave }) {
  const [showInactive, setShowInactive] = useState(false);
  const active = items.filter(item => item.isActive);
  const inactive = items.filter(item => !item.isActive);

  if (items.length === 0) return <p style={{ fontSize: 13, color: '#94A3B8' }}>{emptyMessage}</p>;

  return (
    <div>
      <RegistryHeader
        activeCount={active.length}
        inactiveCount={inactive.length}
        noun={noun}
        showInactive={showInactive}
        onToggle={() => setShowInactive(current => !current)}
      />
      {active.length === 0
        ? <p style={{ fontSize: 13, color: '#94A3B8' }}>No active {noun}.</p>
        : active.map(item => <RegistryRow key={item.id} item={item} canManage={canManage} onSave={onSave} />)}
      {showInactive && (
        <InactiveGroup noun={noun} isEmpty={inactive.length === 0}>
          {inactive.map(item => <RegistryRow key={item.id} item={item} canManage={canManage} onSave={onSave} />)}
        </InactiveGroup>
      )}
    </div>
  );
}

function RosterRow({ item, canManage, onSetActive }) {
  return (
    <div className="settings-roster-row" style={{ background: item.isActive ? 'transparent' : '#FFFBEB' }}>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
        <strong style={{ fontSize: 13, color: '#1A3A5C', overflowWrap: 'anywhere' }}>{item.attendingName}</strong>
        {!item.isActive && <InactiveBadge />}
      </span>
      <span style={{ fontSize: 12, color: '#64748B', overflowWrap: 'anywhere' }}>{item.email || '—'}</span>
      <span style={{ fontSize: 12, color: '#64748B', overflowWrap: 'anywhere' }}>{item.phone || '—'}</span>
      <span style={{ fontSize: 12, color: '#64748B', overflowWrap: 'anywhere' }}>{item.officeLocation || '—'}</span>
      <span className="settings-roster-actions">
        {canManage ? (
          <button
            type="button"
            aria-label={`${item.isActive ? 'Deactivate' : 'Restore'} ${item.attendingName}`}
            onClick={() => onSetActive(item, !item.isActive)}
            style={item.isActive ? deactivateButtonStyle : restoreButtonStyle}
          >
            {item.isActive ? 'Deactivate' : 'Restore'}
          </button>
        ) : <span style={{ fontSize: 11, color: item.isActive ? '#15803D' : '#94A3B8' }}>{item.isActive ? 'Active' : 'Inactive'}</span>}
      </span>
    </div>
  );
}

const PERMISSION_GROUPS = Object.freeze([
  { title: 'Residents', items: [['manage_residents', 'Manage residents'], ['manage_block_availability', 'Manage block availability'], ['manage_clinical_services', 'Manage clinical services']] },
  { title: 'Attendings', items: [['manage_attending_roster', 'Manage attending roster'], ['manage_attending_schedule', 'Edit attending schedule']] },
  { title: 'Scheduling', items: [['manage_block_settings', 'Manage block settings'], ['manage_scheduling_rules', 'Edit scheduling rules'], ['manual_assign_calls', 'Assign calls manually'], ['generate_schedule', 'Generate schedules'], ['clear_generated_schedule', 'Clear generated schedules'], ['validate_schedule', 'Validate schedules'], ['publish_schedule', 'Publish schedules']] },
  { title: 'Exports / history', items: [['export_draft_schedule', 'Export draft schedules'], ['view_audit_history', 'View scheduling audit history']] },
]);

// -- section navigation -------------------------------------------------------

// One nav element drives both layouts (a scrolling strip on phones, a sticky
// side-nav from 1024px up), so no control is ever duplicated in the DOM.
const SETTINGS_SECTIONS = Object.freeze([
  { id: 'general', label: 'General', visible: () => true },
  { id: 'clinical', label: 'Clinical Structure', visible: () => true },
  { id: 'attendings', label: 'Attendings', visible: () => true },
  { id: 'scheduling', label: 'Scheduling', visible: () => true },
  { id: 'access', label: 'Access & Permissions', visible: access => access.canManageUsers || access.canConfigurePermissions },
  { id: 'history', label: 'History', visible: () => true },
]);

function SectionNav({ sections, activeSection, onSelect }) {
  const navRef = useRef(null);

  const handleKeyDown = (event) => {
    const steps = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const index = sections.findIndex(section => section.id === activeSection);
    let nextIndex = null;
    if (steps[event.key]) nextIndex = (index + steps[event.key] + sections.length) % sections.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = sections.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    onSelect(sections[nextIndex].id);
    navRef.current?.querySelectorAll('[role="tab"]')[nextIndex]?.focus();
  };

  return (
    <nav
      ref={navRef}
      className="settings-nav"
      role="tablist"
      aria-label="Program settings sections"
      onKeyDown={handleKeyDown}
    >
      {sections.map(section => (
        <button
          key={section.id}
          type="button"
          role="tab"
          id={`settings-tab-${section.id}`}
          aria-selected={section.id === activeSection}
          aria-controls={`settings-panel-${section.id}`}
          tabIndex={section.id === activeSection ? 0 : -1}
          onClick={() => onSelect(section.id)}
          className="settings-nav-item"
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}

function CallTypeToggle({ id, label, description, checked, onChange, disabled = false }) {
  return (
    <label htmlFor={id} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '12px 0', cursor: 'pointer' }}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        disabled={disabled}
        style={{ width: 18, height: 18, marginTop: 1, accentColor: '#1A3A5C' }}
      />
      <span>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: '#1A3A5C' }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12, color: '#64748B', marginTop: 2 }}>{description}</span>
      </span>
    </label>
  );
}

// -- main ---------------------------------------------------------------------

export default function ProgramSettings() {
  const { currentUser, currentProgram, refreshContext, can } = useUser();
  const { currentBlock } = useBlock();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const programId = currentProgram?.programId;
  const canEditProgramSettings = can('edit_program_settings');
  const canManageUsers = can('manage_users');
  const canManageServices = can('manage_clinical_services');
  const canManageActivities = can('manage_attending_roster');
  const canConfigurePermissions = can('configure_role_permissions');

  const sections = useMemo(
    () => SETTINGS_SECTIONS.filter(section => section.visible({ canManageUsers, canConfigurePermissions })),
    [canManageUsers, canConfigurePermissions],
  );
  const requestedSection = searchParams.get('tab');
  const activeSection = sections.some(section => section.id === requestedSection)
    ? requestedSection
    : sections[0]?.id;

  // Replace rather than push: tab clicks should not build a history stack the
  // user has to unwind, but a refresh or a return to the page keeps the section.
  const selectSection = useCallback((id) => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('tab', id);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // -- Program info -----------------------------------------------------------
  const [name,      setName]      = useState(currentProgram?.programName ?? '');
  const [specialty, setSpecialty] = useState(currentProgram?.specialty   ?? '');
  const [juniorInHouseCall, setJuniorInHouseCall] = useState(currentProgram?.juniorInHouseCall ?? true);
  const [seniorInHouseCall, setSeniorInHouseCall] = useState(currentProgram?.seniorInHouseCall ?? false);
  const [savingInfo, setSavingInfo] = useState(false);

  useEffect(() => {
    setName(currentProgram?.programName ?? '');
    setSpecialty(currentProgram?.specialty ?? '');
    setJuniorInHouseCall(currentProgram?.juniorInHouseCall ?? true);
    setSeniorInHouseCall(currentProgram?.seniorInHouseCall ?? false);
  }, [currentProgram]);

  const handleSaveInfo = async () => {
    if (!programId) return;
    setSavingInfo(true);
    try {
      await api.put(`/programs/${programId}`, {
        name,
        specialty,
        juniorInHouseCall,
        seniorInHouseCall,
      });
      await refreshContext();
      toast.success('Program info updated!');
    } catch {
      toast.error('Failed to update program info');
    } finally {
      setSavingInfo(false);
    }
  };

  // General and Scheduling both edit the same program record, so each renders
  // the same single Save. Only one section is mounted at a time.
  const saveButton = canEditProgramSettings ? (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <motion.button
        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
        onClick={handleSaveInfo}
        disabled={savingInfo}
        style={{
          padding: '9px 22px', borderRadius: 9, border: 'none',
          background: '#1A3A5C', color: '#fff', fontSize: 13, fontWeight: 600,
          cursor: savingInfo ? 'not-allowed' : 'pointer', opacity: savingInfo ? 0.7 : 1,
        }}
        onMouseEnter={e => { if (!savingInfo) e.currentTarget.style.background = '#2C5F8A'; }}
        onMouseLeave={e => e.currentTarget.style.background = '#1A3A5C'}
      >
        {savingInfo ? 'Saving...' : 'Save'}
      </motion.button>
    </div>
  ) : null;

  // -- Team members -----------------------------------------------------------
  const [members, setMembers]       = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  const loadMembers = useCallback(() => {
    if (!programId || !canManageUsers) {
      setLoadingMembers(false);
      return;
    }
    setLoadingMembers(true);
    api.get(`/programs/${programId}/members`)
      .then(({ data }) => setMembers(data))
      .catch(() => toast.error('Failed to load members'))
      .finally(() => setLoadingMembers(false));
  }, [programId, canManageUsers]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const handleRoleChange = async (userId, role) => {
    try {
      await api.put(`/programs/${programId}/members/${userId}`, { role });
      setMembers(prev => prev.map(m => m.userId === userId ? { ...m, role } : m));
      toast.success('Role updated');
    } catch {
      toast.error('Failed to update role');
    }
  };

  const handleRemoveMember = async (userId) => {
    if (!window.confirm('Remove this member from the program?')) return;
    try {
      await api.delete(`/programs/${programId}/members/${userId}`);
      setMembers(prev => prev.filter(m => m.userId !== userId));
      toast.success('Member removed');
    } catch {
      toast.error('Failed to remove member');
    }
  };

  const handleLeaveProgram = async () => {
    if (!window.confirm('Are you sure you want to leave this program? You will lose access immediately.')) return;
    try {
      await api.delete(`/programs/${programId}/members/${currentUser.userId}`);
      await refreshContext();
      navigate('/setup');
    } catch (err) {
      const msg = err.response?.data?.error ?? 'Failed to leave program';
      toast.error(msg);
    }
  };

  // -- Invite link ------------------------------------------------------------
  const [inviteLink,       setInviteLink]       = useState('');
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [inviteRole,       setInviteRole]       = useState('viewer');

  const handleGenerateInvite = async () => {
    if (!programId) return;
    setGeneratingInvite(true);
    try {
      const { data } = await api.post(`/programs/${programId}/invite`, { role: inviteRole });
      setInviteLink(data.inviteLink);
      toast.success('Invite link generated!');
    } catch {
      toast.error('Failed to generate invite link');
    } finally {
      setGeneratingInvite(false);
    }
  };

  const handleCopyInvite = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => {
      toast.success('Link copied!');
    }).catch(() => toast.error('Failed to copy'));
  };

  // -- Published versions -----------------------------------------------------
  const [versions, setVersions]       = useState([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [snapshotModal, setSnapshotModal]     = useState(null);

  useEffect(() => {
    if (!currentBlock?.id) return;
    setLoadingVersions(true);
    api.get(`/schedule/history?blockId=${currentBlock.id}`)
      .then(({ data }) => setVersions(data))
      .catch(() => {})
      .finally(() => setLoadingVersions(false));
  }, [currentBlock?.id]);

  const fmtVersionDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  // -- Registries -------------------------------------------------------------
  const [clinicalServices, setClinicalServices] = useState([]);
  const [attendingActivities, setAttendingActivities] = useState([]);
  const [attendingRoster, setAttendingRoster] = useState([]);
  const [showInactiveAttendings, setShowInactiveAttendings] = useState(false);
  const [newAttending, setNewAttending] = useState({ attendingName: '', email: '', phone: '', officeLocation: '' });
  const [newServiceName, setNewServiceName] = useState('');
  const [newActivityName, setNewActivityName] = useState('');
  const [chiefPermissions, setChiefPermissions] = useState([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [savingPermissions, setSavingPermissions] = useState(false);

  const loadProgramConfiguration = useCallback(async () => {
    if (!programId) return;
    const requests = [
      api.get(`/program-configuration/${programId}/clinical-services`),
      api.get(`/program-configuration/${programId}/attending-activities`),
    ];
    if (canConfigurePermissions) requests.push(api.get(`/program-configuration/${programId}/role-permissions`));
    const [servicesResult, activitiesResult, permissionsResult] = await Promise.allSettled(requests);
    if (servicesResult.status === 'fulfilled') setClinicalServices(servicesResult.value.data);
    if (activitiesResult.status === 'fulfilled') setAttendingActivities(activitiesResult.value.data);
    if (canManageActivities) {
      try {
        // Inactive staff are loaded so they can be reviewed and restored here.
        // Scheduling selectors keep using the active-only default.
        const { data } = await api.get(`/attending/roster?programId=${programId}&includeInactive=true`);
        setAttendingRoster(data);
      } catch { /* registry sections remain independently usable */ }
    }
    if (permissionsResult?.status === 'fulfilled') {
      setChiefPermissions(permissionsResult.value.data.roles.chief_resident.permissions.filter(item => item.enabled).map(item => item.permission));
      setPermissionsLoaded(true);
    }
  }, [programId, canConfigurePermissions, canManageActivities]);

  useEffect(() => { loadProgramConfiguration(); }, [loadProgramConfiguration]);

  const addRegistryItem = async (kind, name, clear) => {
    if (!name.trim()) return;
    try {
      await api.post(`/program-configuration/${programId}/${kind}`, { name });
      clear('');
      await loadProgramConfiguration();
      toast.success(kind === 'clinical-services' ? 'Clinical service added' : 'Attending activity added');
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Unable to add item');
    }
  };

  const updateRegistryItem = async (kind, id, changes) => {
    try {
      await api.put(`/program-configuration/${programId}/${kind}/${id}`, changes);
      await loadProgramConfiguration();
      if (changes.isActive === true) toast.success('Restored');
      else if (changes.isActive === false) toast.success('Deactivated');
      else toast.success('Saved');
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Unable to save item');
    }
  };

  const addAttending = async () => {
    if (!newAttending.attendingName.trim()) return;
    try {
      await api.post('/attending/roster', { programId, ...newAttending, typicalActivities: [] });
      setNewAttending({ attendingName: '', email: '', phone: '', officeLocation: '' });
      await loadProgramConfiguration();
      toast.success('Attending added to the program roster');
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Unable to add attending');
    }
  };

  const setAttendingActive = async (item, isActive) => {
    try {
      await api.put(`/attending/roster/${item.id}`, { isActive });
      await loadProgramConfiguration();
      toast.success(isActive ? 'Attending restored' : 'Attending deactivated');
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Unable to update attending');
    }
  };

  const saveChiefPermissions = async () => {
    setSavingPermissions(true);
    try {
      await api.put(`/program-configuration/${programId}/role-permissions`, { role: 'chief_resident', permissions: chiefPermissions });
      toast.success('Chief Resident permissions updated');
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Unable to update permissions');
    } finally {
      setSavingPermissions(false);
    }
  };

  const activeAttendings = attendingRoster.filter(item => item.isActive);
  const inactiveAttendings = attendingRoster.filter(item => !item.isActive);

  // -- render -----------------------------------------------------------------

  if (!can('view_draft_schedule') && !canEditProgramSettings && !canManageServices && !canManageActivities) {
    return (
      <PageWrapper>
        <Layout>
          <div style={{ background: '#fff', border: '1px solid #E8EFF6', borderRadius: 12, padding: 24, color: '#64748B' }}>
            You do not have access to program configuration.
          </div>
        </Layout>
      </PageWrapper>
    );
  }

  const panels = {
    general: (
      <Card title="Program" subtitle="Program identity used throughout MedRota.">
        <div className="space-y-4">
          <div>
            <Label htmlFor="ps-program-name">Program display name</Label>
            <input id="ps-program-name" value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="e.g. Internal Medicine Residency" disabled={!canEditProgramSettings} />
            <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>The name used throughout MedRota, such as &ldquo;McMaster Vascular Surgery Residency.&rdquo;</p>
          </div>
          <div>
            <Label htmlFor="ps-specialty">Primary specialty</Label>
            <select id="ps-specialty" value={specialty} onChange={e => setSpecialty(e.target.value)} style={inputStyle} disabled={!canEditProgramSettings}>
              {MEDICAL_SPECIALTIES.map(s => <option key={s} value={s}>{s}</option>)}
              {specialty && !MEDICAL_SPECIALTIES.includes(specialty) && <option value={specialty}>{specialty}</option>}
            </select>
            <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>The program&rsquo;s main specialty.</p>
          </div>
          {saveButton}
        </div>
      </Card>
    ),

    clinical: (
      <Card title="Clinical services" subtitle="Optional program-defined services or subspecialty rotations. No specialty defaults are imposed.">
        {canManageServices && (
          <div className="settings-inline-form">
            <input aria-label="New clinical service" value={newServiceName} onChange={event => setNewServiceName(event.target.value)} onKeyDown={event => event.key === 'Enter' && addRegistryItem('clinical-services', newServiceName, setNewServiceName)} style={inputStyle} placeholder="e.g. Acute Care Surgery" />
            <button onClick={() => addRegistryItem('clinical-services', newServiceName, setNewServiceName)} style={primaryButtonStyle}>Add service</button>
          </div>
        )}
        <RegistryList
          items={clinicalServices}
          canManage={canManageServices}
          noun="services"
          emptyMessage="No clinical services configured. This feature is optional."
          onSave={(id, changes) => updateRegistryItem('clinical-services', id, changes)}
        />
      </Card>
    ),

    attendings: (
      <>
        {canManageActivities && <Card title="Attending roster" subtitle="Persistent program staff. Contact details stay inside authenticated program settings and are never added to the public schedule.">
          <div className="settings-field-grid" style={{ marginBottom: 14 }}>
            {[['attendingName', 'Name', 'Dr. Smith'], ['email', 'Email', 'name@example.org'], ['phone', 'Phone', 'Optional'], ['officeLocation', 'Office / location', 'Optional']].map(([field, label, placeholder]) => <div key={field}><Label htmlFor={`new-attending-${field}`}>{label}</Label><input id={`new-attending-${field}`} value={newAttending[field]} onChange={event => setNewAttending(previous => ({ ...previous, [field]: event.target.value }))} placeholder={placeholder} style={inputStyle} /></div>)}
            <button onClick={addAttending} style={primaryButtonStyle}>Add attending</button>
          </div>
          {attendingRoster.length === 0 ? <p style={{ fontSize: 13, color: '#94A3B8' }}>No attending staff configured.</p> : (
            <div>
              <RegistryHeader
                activeCount={activeAttendings.length}
                inactiveCount={inactiveAttendings.length}
                noun="attendings"
                showInactive={showInactiveAttendings}
                onToggle={() => setShowInactiveAttendings(current => !current)}
              />
              {activeAttendings.length === 0
                ? <p style={{ fontSize: 13, color: '#94A3B8' }}>No active attendings.</p>
                : activeAttendings.map(item => <RosterRow key={item.id} item={item} canManage={canManageActivities} onSetActive={setAttendingActive} />)}
              {showInactiveAttendings && (
                <InactiveGroup noun="attendings" isEmpty={inactiveAttendings.length === 0}>
                  {inactiveAttendings.map(item => <RosterRow key={item.id} item={item} canManage={canManageActivities} onSetActive={setAttendingActive} />)}
                </InactiveGroup>
              )}
            </div>
          )}
        </Card>}

        <Card title="Attending activities" subtitle="Activity types used by weekly patterns and attending schedules. Inactive types stay off new schedules but remain on historical ones.">
          {canManageActivities && (
            <div className="settings-inline-form">
              <input aria-label="New attending activity" value={newActivityName} onChange={event => setNewActivityName(event.target.value)} onKeyDown={event => event.key === 'Enter' && addRegistryItem('attending-activities', newActivityName, setNewActivityName)} style={inputStyle} placeholder="e.g. Endoscopy" />
              <button onClick={() => addRegistryItem('attending-activities', newActivityName, setNewActivityName)} style={primaryButtonStyle}>Add activity</button>
            </div>
          )}
          <RegistryList
            items={attendingActivities}
            canManage={canManageActivities}
            noun="activities"
            emptyMessage="No activity types configured yet."
            onSave={(id, changes) => updateRegistryItem('attending-activities', id, changes)}
          />
        </Card>
      </>
    ),

    scheduling: (
      <Card title="Call configuration" subtitle="Program-level call rules applied to PARO maximums.">
        <div className="space-y-4">
          <div>
            <CallTypeToggle
              id="junior-in-house-call"
              label="Junior in-house call"
              description="Junior resident call assignments count as in-house call for PARO maximums."
              checked={juniorInHouseCall}
              onChange={setJuniorInHouseCall}
              disabled={!canEditProgramSettings}
            />
            <CallTypeToggle
              id="senior-in-house-call"
              label="Senior in-house call"
              description="Senior resident call assignments count as in-house call for PARO maximums."
              checked={seniorInHouseCall}
              onChange={setSeniorInHouseCall}
              disabled={!canEditProgramSettings}
            />
          </div>
          {saveButton}
        </div>
      </Card>
    ),

    access: (
      <>
        {canManageUsers && <>
        <Card title="Team Members" subtitle="View and manage who has access to this program.">
          {loadingMembers ? (
            <p style={{ fontSize: 13, color: '#94A3B8' }}>Loading...</p>
          ) : members.length === 0 ? (
            <p style={{ fontSize: 13, color: '#CBD5E1', fontStyle: 'italic' }}>No members yet.</p>
          ) : (
            <div>
              <div className="settings-member-row" style={{ padding: '8px 12px', borderRadius: 8, background: '#F8FAFC', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Name</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Email</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Role</span>
                <span />
              </div>
              <div className="space-y-2">
                {members.map(m => {
                  const isSelf = m.userId === currentUser?.userId;
                  const memberLabel = m.user?.name ?? m.user?.email ?? 'member';
                  return (
                    <div key={m.id} className="settings-member-row" style={{ padding: '10px 12px', borderRadius: 8, border: isSelf ? '1px solid #C7D9EC' : '1px solid #F1F5F9', background: isSelf ? '#F8FCFF' : '#fff' }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: '#1A3A5C', overflowWrap: 'anywhere' }}>
                        {m.user?.name ?? '-'}
                        {isSelf && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#2C5F8A', background: '#EEF4FF', padding: '1px 6px', borderRadius: 99 }}>You</span>}
                      </span>
                      <span style={{ fontSize: 13, color: '#64748B', overflowWrap: 'anywhere' }}>{m.user?.email ?? '-'}</span>
                      <select
                        aria-label={`Role for ${memberLabel}`}
                        value={m.role}
                        onChange={e => handleRoleChange(m.userId, e.target.value)}
                        disabled={!canManageUsers}
                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #E2E8F0', fontSize: 12, color: '#1A3A5C', background: '#F8FAFC', outline: 'none', cursor: 'pointer', maxWidth: '100%' }}
                      >
                        {ROLE_OPTIONS.map(role => (
                          <option key={role.value} value={role.value}>{role.label}</option>
                        ))}
                      </select>
                      {isSelf ? (
                        <button
                          onClick={handleLeaveProgram}
                          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#DC2626', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', justifySelf: 'start' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#FEE2E2'}
                          onMouseLeave={e => e.currentTarget.style.background = '#FEF2F2'}
                        >
                          Leave program
                        </button>
                      ) : (
                        <button
                          onClick={() => handleRemoveMember(m.userId)}
                          disabled={!canManageUsers}
                          aria-label={`Remove ${memberLabel}`}
                          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#DC2626', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', justifySelf: 'start' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#FEE2E2'}
                          onMouseLeave={e => e.currentTarget.style.background = '#FEF2F2'}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        <Card title="Invite Link" subtitle="Share a link so others can join this program with a defined role.">
          <div className="space-y-3">
            <div>
              <Label htmlFor="ps-invite-role">Invite role</Label>
              <select id="ps-invite-role" value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={inputStyle} disabled={!canManageUsers}>
                {ROLE_OPTIONS.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
              </select>
            </div>
            {inviteLink ? (
              <div className="settings-inline-form" style={{ marginBottom: 0 }}>
                <input
                  readOnly
                  aria-label="Invite link"
                  value={inviteLink}
                  style={{ ...inputStyle, background: '#F0F5FF', color: '#2C5F8A', fontFamily: 'monospace', fontSize: 12 }}
                />
                <button
                  onClick={handleCopyInvite}
                  style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #C7D9EC', background: '#EEF4FF', color: '#2C5F8A', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#DCE9F5'}
                  onMouseLeave={e => e.currentTarget.style.background = '#EEF4FF'}
                >
                  Copy
                </button>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: '#94A3B8', fontStyle: 'italic' }}>No invite link generated yet.</p>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                onClick={handleGenerateInvite}
                disabled={generatingInvite}
                style={{
                  padding: '9px 18px', borderRadius: 9, border: 'none',
                  background: '#1A3A5C', color: '#fff', fontSize: 13, fontWeight: 600,
                  cursor: generatingInvite ? 'not-allowed' : 'pointer', opacity: generatingInvite ? 0.7 : 1,
                }}
                onMouseEnter={e => { if (!generatingInvite) e.currentTarget.style.background = '#2C5F8A'; }}
                onMouseLeave={e => e.currentTarget.style.background = '#1A3A5C'}
              >
                {generatingInvite ? 'Generating...' : inviteLink ? 'Regenerate' : 'Generate invite link'}
              </motion.button>
            </div>
          </div>
        </Card>
        </>}

        {canConfigurePermissions && <Card title="Role permissions" subtitle="Program Admins and Directors always retain full access. Viewers always remain read-only.">
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 8, background: '#F8FAFC', fontSize: 13, color: '#475569' }}><strong style={{ color: '#1A3A5C' }}>Program Admin / Program Director</strong><br />Full program access</div>
            <div style={{ padding: 12, borderRadius: 8, border: '1px solid #D6E4F7' }}>
              <strong style={{ color: '#1A3A5C', fontSize: 14 }}>Chief Resident</strong>
              {!permissionsLoaded ? <p style={{ fontSize: 13, color: '#94A3B8', marginTop: 10 }}>Loading permissions&hellip;</p> : PERMISSION_GROUPS.map(group => <div key={group.title} style={{ marginTop: 14 }}><p style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: 6 }}>{group.title}</p>{group.items.map(([permission, label]) => <label key={permission} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', fontSize: 13, color: '#374151' }}><input type="checkbox" checked={chiefPermissions.includes(permission)} onChange={event => setChiefPermissions(previous => event.target.checked ? [...previous, permission] : previous.filter(item => item !== permission))} />{label}</label>)}</div>)}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button onClick={saveChiefPermissions} disabled={savingPermissions || !permissionsLoaded} style={{ padding: '8px 14px', border: 0, borderRadius: 8, background: '#1A3A5C', color: '#fff', fontSize: 12, fontWeight: 600, cursor: permissionsLoaded ? 'pointer' : 'not-allowed', opacity: permissionsLoaded ? 1 : 0.6 }}>{savingPermissions ? 'Saving…' : 'Save permissions'}</button></div>
            </div>
            <div style={{ padding: 12, borderRadius: 8, background: '#F8FAFC', fontSize: 13, color: '#475569' }}><strong style={{ color: '#1A3A5C' }}>Viewer</strong><br />Published schedule access only</div>
          </div>
        </Card>}
      </>
    ),

    history: (
      <>
        <Card
          title="Published Versions"
          subtitle={currentBlock ? `Version history for Block ${currentBlock.number}` : 'Select a block to see published versions.'}
        >
          {!currentBlock ? (
            <p style={{ fontSize: 13, color: '#CBD5E1', fontStyle: 'italic' }}>No block selected.</p>
          ) : loadingVersions ? (
            <p style={{ fontSize: 13, color: '#94A3B8' }}>Loading...</p>
          ) : versions.length === 0 ? (
            <p style={{ fontSize: 13, color: '#CBD5E1', fontStyle: 'italic' }}>No published versions yet.</p>
          ) : (
            <div className="space-y-2">
              {versions.map((v, i) => (
                <div key={v.id} style={{
                  display: 'flex', flexWrap: 'wrap', gap: 8,
                  alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 12px', borderRadius: 8,
                  border: '1px solid #F1F5F9', background: i === 0 ? '#F0FDF4' : '#fff',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: '#1A3A5C' }}>
                      {fmtVersionDate(v.publishedAt)}
                      {i === 0 && (
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#15803D', background: '#DCFCE7', padding: '1px 6px', borderRadius: 99 }}>
                          Latest
                        </span>
                      )}
                    </p>
                    <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                      {v.publishedBy ? `By ${v.publishedBy}` : 'Unknown user'} - {v.assignedDays} assigned days
                    </p>
                  </div>
                  <button
                    onClick={() => setSnapshotModal(v)}
                    style={{
                      padding: '5px 12px', borderRadius: 6, border: '1px solid #D6E4F7',
                      background: '#EEF4FF', color: '#2C5F8A', fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#DCE9F5'}
                    onMouseLeave={e => e.currentTarget.style.background = '#EEF4FF'}
                  >
                    View snapshot
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {can('view_audit_history') && <Card
          title="Program History"
          subtitle="Read-only record of who changed what. Program Admins and Directors see everything; Chief Residents see scheduling changes only."
        >
          <AuditHistory programId={programId} limit={50} />
        </Card>}
      </>
    ),
  };

  return (
    <PageWrapper>
      <Layout>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="mb-6">
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1A3A5C', margin: 0 }}>Program Settings</h1>
            <p style={{ fontSize: 13, color: '#94A3B8', marginTop: 4 }}>Manage your program details, team, and invitations.</p>
          </div>

          <div className="settings-shell">
            <SectionNav sections={sections} activeSection={activeSection} onSelect={selectSection} />

            <div
              className="settings-panel"
              role="tabpanel"
              id={`settings-panel-${activeSection}`}
              aria-labelledby={`settings-tab-${activeSection}`}
              tabIndex={-1}
            >
              {panels[activeSection]}
            </div>
          </div>
        </motion.div>

        {/* Snapshot modal */}
        <AnimatePresence>
          {snapshotModal && (
            <Modal
              title={`Snapshot - ${fmtVersionDate(snapshotModal.publishedAt)}`}
              description={`${snapshotModal.publishedBy ? `Published by ${snapshotModal.publishedBy} - ` : ''}${snapshotModal.assignedDays} assigned days`}
              onClose={() => setSnapshotModal(null)}
              maxWidth="max-w-2xl"
              closeLabel="Close snapshot"
            >
                  {(() => {
                    const snap = snapshotModal.snapshotJson;
                    const callDays = snap?.callDays ?? [];
                    if (callDays.length === 0) return <p style={{ color: '#94A3B8', fontSize: 13 }}>No schedule data in this snapshot.</p>;

                    return (
                      <div className="space-y-1.5">
                        {callDays.map((cd, i) => {
                          const d = new Date(cd.date);
                          const dayLabel = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
                          const asgns = cd.assignments ?? [];
                          const seniors = asgns.filter(a => a.roleOnDay === 'senior').map(a => a.resident?.name ?? '').join(', ');
                          const juniors = asgns.filter(a => a.roleOnDay === 'junior').map(a => a.resident?.name ?? '').join(', ');
                          const isHol = cd.isHoliday;

                          return (
                            <div key={i} style={{
                              display: 'grid', gridTemplateColumns: 'minmax(0, 120px) minmax(0, 1fr) minmax(0, 1fr)', gap: 8,
                              padding: '6px 10px', borderRadius: 6, fontSize: 12,
                              background: isHol ? '#FFF5F5' : i % 2 === 0 ? '#F8FAFC' : '#fff',
                              border: '1px solid #F1F5F9',
                            }}>
                              <span style={{ fontWeight: 600, color: isHol ? '#DC2626' : '#1A3A5C' }}>
                                {dayLabel} {isHol && '(H)'}
                              </span>
                              <span style={{ color: seniors ? '#15803D' : '#CBD5E1', overflowWrap: 'anywhere' }}>
                                {seniors || '-'}
                              </span>
                              <span style={{ color: juniors ? '#B45309' : '#CBD5E1', overflowWrap: 'anywhere' }}>
                                {juniors || '-'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
            </Modal>
          )}
        </AnimatePresence>
      </Layout>
    </PageWrapper>
  );
}
