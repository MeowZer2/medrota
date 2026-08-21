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
import { DISCARD_PROMPT, useUnsavedChangesGuard } from '../lib/unsavedChanges';

// -- helpers ------------------------------------------------------------------

function Card({ title, subtitle, children }) {
  // No overflow clipping here on purpose. A clipping card used to hide the
  // trailing action button of any row that grew past the card width, which left
  // Deactivate/Restore impossible to reach with a pointer. Rows now shrink.
  return (
    <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border-1)', borderRadius: 12, boxShadow: 'var(--shadow-xs)', marginBottom: 20 }}>
      <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-1)', background: 'var(--surface-2)', borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-1)', margin: 0 }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 12, color: 'var(--ink-5)', margin: '3px 0 0' }}>{subtitle}</p>}
      </div>
      <div style={{ padding: '20px 24px' }}>{children}</div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: '1px solid var(--border-strong)', fontSize: 14, color: 'var(--ink-1)',
  background: 'var(--surface-2)', outline: 'none', boxSizing: 'border-box',
};

const primaryButtonStyle = {
  padding: '9px 14px', border: 0, borderRadius: 8, background: 'var(--brand)',
  color: 'var(--ink-inverse)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
};

const deactivateButtonStyle = {
  padding: '7px 12px', border: '1px solid var(--border-strong)', borderRadius: 7, background: 'var(--surface-1)',
  color: 'var(--ink-4)', fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 34, whiteSpace: 'nowrap',
};

const restoreButtonStyle = {
  padding: '7px 12px', border: '1px solid var(--success-border)', borderRadius: 7, background: 'var(--success-soft)',
  color: 'var(--success-ink)', fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 34, whiteSpace: 'nowrap',
};

const SERVICE_DESCRIPTION_MAX_LENGTH = 500;

function isValidOptionalEmail(value) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > 254 || /\s/.test(trimmed)) return false;
  const at = trimmed.indexOf('@');
  if (at <= 0 || at !== trimmed.lastIndexOf('@')) return false;
  const local = trimmed.slice(0, at);
  const labels = trimmed.slice(at + 1).split('.');
  return local.length <= 64
    && !local.startsWith('.')
    && !local.endsWith('.')
    && !local.includes('..')
    && labels.length >= 2
    && labels.every(label => label.length > 0
      && label.length <= 63
      && /^[a-zA-Z0-9-]+$/.test(label)
      && !label.startsWith('-')
      && !label.endsWith('-'));
}

// Paired edit controls. Every inline editor in this page shows both, so an edit
// is always reversible without reloading the section.
const editSaveButtonStyle = {
  padding: '7px 12px', border: '1px solid var(--accent-border)', borderRadius: 7, background: 'var(--accent-soft)',
  color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 34, whiteSpace: 'nowrap',
};

const cancelButtonStyle = {
  padding: '7px 12px', border: '1px solid var(--border-strong)', borderRadius: 7, background: 'var(--surface-1)',
  color: 'var(--ink-4)', fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 34, whiteSpace: 'nowrap',
};

function Label({ htmlFor, children }) {
  return (
    <label htmlFor={htmlFor} style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ink-4)', marginBottom: 5 }}>
      {children}
    </label>
  );
}

function InactiveBadge() {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--warn-ink)', background: 'var(--warn-soft-2)', padding: '2px 7px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
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
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-4)' }}>
        {activeCount} active {noun}
      </span>
      {(inactiveCount > 0 || showInactive) && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={showInactive}
          style={{ padding: '6px 11px', border: '1px solid var(--border-strong)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 32, whiteSpace: 'nowrap' }}
        >
          {showInactive ? `Hide inactive ${noun}` : `Show inactive ${noun} (${inactiveCount})`}
        </button>
      )}
    </div>
  );
}

// Deactivated records are review-and-restore material, not a working list. A
// local QA database can hold dozens of them, so the group sorts by name, shows
// one readable page, and only offers a filter once there is more than a page.
// Active rosters are never paged: those are the lists people work in.
const INACTIVE_PAGE_SIZE = 10;

const registryLabel = item => item.name;
const rosterLabel = item => item.attendingName;

function InactiveGroup({ noun, items, labelOf, renderItem }) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(
    () => [...items].sort((a, b) => labelOf(a).localeCompare(labelOf(b), 'en', { sensitivity: 'base' })),
    [items, labelOf],
  );
  const term = query.trim().toLocaleLowerCase();
  const matches = term ? sorted.filter(item => labelOf(item).toLocaleLowerCase().includes(term)) : sorted;
  const visible = showAll ? matches : matches.slice(0, INACTIVE_PAGE_SIZE);

  return (
    <div data-testid={`inactive-${noun}`} style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--border-2)' }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>
        Inactive {noun}
      </p>
      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--ink-5)', margin: 0 }}>No inactive {noun}.</p>
      ) : (
        <>
          {items.length > INACTIVE_PAGE_SIZE && (
            <input
              aria-label={`Search inactive ${noun}`}
              value={query}
              onChange={event => { setQuery(event.target.value); setShowAll(false); }}
              placeholder={`Search inactive ${noun}`}
              style={{ ...inputStyle, marginBottom: 8 }}
            />
          )}
          <p style={{ fontSize: 12, color: 'var(--ink-4)', margin: '0 0 6px' }}>
            Showing {visible.length} of {matches.length} inactive {noun}
          </p>
          {matches.length === 0
            ? <p style={{ fontSize: 13, color: 'var(--ink-5)', margin: 0 }}>No inactive {noun} match that search.</p>
            : visible.map(renderItem)}
          {matches.length > INACTIVE_PAGE_SIZE && (
            <button
              type="button"
              onClick={() => setShowAll(current => !current)}
              style={{ marginTop: 8, padding: '6px 11px', border: '1px solid var(--border-strong)', borderRadius: 7, background: 'var(--surface-2)', color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 32 }}
            >
              {showAll ? `Show fewer ${noun}` : `Show all ${matches.length} inactive ${noun}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// A registry row is a small form. Save and Cancel appear together as soon as the
// name really differs from the stored one, Escape puts the stored name back, and
// a blank name is never savable. A rejected save keeps the row in edit state so
// the typed text is not thrown away.
function RegistryRow({ item, canManage, onSave, onEditingChange, showDescription = false }) {
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => setName(item.name), [item.name]);
  useEffect(() => setDescription(item.description ?? ''), [item.description]);

  const references = (item._count?.attendingEntries ?? 0) + (item._count?.attendingTemplates ?? 0);
  const trimmed = name.trim();
  const trimmedDescription = description.trim();
  const isEdited = trimmed !== item.name || (showDescription && trimmedDescription !== (item.description ?? ''));
  const isBlank = trimmed.length === 0;

  useEffect(() => {
    onEditingChange?.(item.id, isEdited);
    return () => onEditingChange?.(item.id, false);
  }, [item.id, isEdited, onEditingChange]);

  const cancel = () => {
    setName(item.name);
    setDescription(item.description ?? '');
  };

  const save = async () => {
    if (isBlank || saving) return;
    setSaving(true);
    const saved = await onSave(item.id, {
      name: trimmed,
      ...(showDescription && { description: trimmedDescription }),
    });
    setSaving(false);
    if (saved) setName(trimmed);
  };

  return (
    <div className="settings-registry-row">
      <div className="settings-registry-main">
        <input
          aria-label={`${item.name} name`}
          value={name}
          onChange={event => setName(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape' && isEdited) { event.preventDefault(); cancel(); }
            if (event.key === 'Enter' && isEdited) { event.preventDefault(); save(); }
          }}
          disabled={!canManage}
          style={{ ...inputStyle, background: canManage ? 'var(--surface-2)' : 'var(--surface-1)', borderColor: isBlank ? 'var(--danger-border)' : 'var(--border-strong)' }}
        />
        {isBlank && <span role="alert" style={{ display: 'block', fontSize: 11, color: 'var(--danger-ink)', marginTop: 3 }}>A name is required.</span>}
        {showDescription && (
          <>
            <input
              aria-label={`${item.name} description`}
              value={description}
              onChange={event => setDescription(event.target.value)}
              onKeyDown={event => { if (event.key === 'Escape' && isEdited) { event.preventDefault(); cancel(); } }}
              disabled={!canManage}
              maxLength={SERVICE_DESCRIPTION_MAX_LENGTH}
              placeholder="Optional description"
              style={{ ...inputStyle, marginTop: 6, background: canManage ? 'var(--surface-2)' : 'var(--surface-1)', color: 'var(--ink-4)', fontSize: 12 }}
            />
          </>
        )}
        {references > 0 && <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-5)', marginTop: 3 }}>{references} schedule reference{references === 1 ? '' : 's'} preserved</span>}
      </div>
      <div className="settings-registry-actions">
        {!item.isActive && <InactiveBadge />}
        {canManage && isEdited && (
          <>
            <button
              type="button"
              aria-label={`Save ${item.name}`}
              onClick={save}
              disabled={isBlank || saving}
              style={{ ...editSaveButtonStyle, cursor: isBlank || saving ? 'not-allowed' : 'pointer', opacity: isBlank || saving ? 0.6 : 1 }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" aria-label={`Cancel editing ${item.name}`} onClick={cancel} style={cancelButtonStyle}>Cancel</button>
          </>
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
        ) : <span style={{ fontSize: 11, color: item.isActive ? 'var(--success-ink)' : 'var(--ink-5)' }}>{item.isActive ? 'Active' : 'Inactive'}</span>}
      </div>
    </div>
  );
}

// Active-first registry list. Deactivated entries leave the main list entirely
// instead of sitting in it greyed out.
function RegistryList({ items, canManage, noun, emptyMessage, onSave, onEditingChange, showDescription = false }) {
  const [showInactive, setShowInactive] = useState(false);
  const active = items.filter(item => item.isActive);
  const inactive = items.filter(item => !item.isActive);

  if (items.length === 0) return <p style={{ fontSize: 13, color: 'var(--ink-5)' }}>{emptyMessage}</p>;

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
        ? <p style={{ fontSize: 13, color: 'var(--ink-5)' }}>No active {noun}.</p>
        : active.map(item => <RegistryRow key={item.id} item={item} canManage={canManage} onSave={onSave} onEditingChange={onEditingChange} showDescription={showDescription} />)}
      {showInactive && (
        <InactiveGroup
          noun={noun}
          items={inactive}
          labelOf={registryLabel}
          renderItem={item => <RegistryRow key={item.id} item={item} canManage={canManage} onSave={onSave} onEditingChange={onEditingChange} showDescription={showDescription} />}
        />
      )}
    </div>
  );
}

const ROSTER_FIELDS = Object.freeze([
  ['attendingName', 'Name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['officeLocation', 'Office / location'],
]);

function rosterDraftFrom(item) {
  return {
    attendingName: item.attendingName,
    email: item.email ?? '',
    phone: item.phone ?? '',
    officeLocation: item.officeLocation ?? '',
  };
}

// Attending rows edit in place like the other registries, but behind an explicit
// Edit control: the row carries four fields, and a permanently open form would
// crowd out the Deactivate/Restore action beside it.
function RosterRow({ item, canManage, onSave, onSetActive, onEditingChange }) {
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const persisted = rosterDraftFrom(item);
  const trimmedName = (draft?.attendingName ?? '').trim();
  const isBlank = draft !== null && trimmedName.length === 0;
  const emailInvalid = draft !== null && !isValidOptionalEmail(draft.email);
  const isEdited = draft !== null && ROSTER_FIELDS.some(([field]) => draft[field].trim() !== persisted[field].trim());

  useEffect(() => {
    onEditingChange?.(item.id, isEdited);
    return () => onEditingChange?.(item.id, false);
  }, [item.id, isEdited, onEditingChange]);

  const cancel = () => setDraft(null);

  const save = async () => {
    if (isBlank || emailInvalid || saving) return;
    if (!isEdited) { setDraft(null); return; }
    setSaving(true);
    const saved = await onSave(item.id, {
      attendingName: trimmedName,
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      officeLocation: draft.officeLocation.trim(),
    });
    setSaving(false);
    if (saved) setDraft(null);
  };

  if (draft) {
    return (
      <div
        className="settings-roster-edit"
        data-testid="roster-edit"
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } }}
      >
        <div className="settings-field-grid">
          {ROSTER_FIELDS.map(([field, label]) => (
            <div key={field}>
              <Label htmlFor={`roster-${item.id}-${field}`}>{label}</Label>
              <input
                id={`roster-${item.id}-${field}`}
                value={draft[field]}
                onChange={event => setDraft(current => ({ ...current, [field]: event.target.value }))}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); save(); } }}
                type={field === 'email' ? 'email' : 'text'}
                aria-invalid={field === 'email' && emailInvalid ? 'true' : undefined}
                aria-describedby={field === 'email' && emailInvalid ? `roster-${item.id}-email-error` : undefined}
                style={{ ...inputStyle, borderColor: (field === 'attendingName' && isBlank) || (field === 'email' && emailInvalid) ? 'var(--danger-border)' : 'var(--border-strong)' }}
              />
              {field === 'email' && emailInvalid && <span id={`roster-${item.id}-email-error`} role="alert" style={{ display: 'block', fontSize: 11, color: 'var(--danger-ink)', marginTop: 3 }}>Enter a valid email address.</span>}
            </div>
          ))}
        </div>
        {isBlank && <p role="alert" style={{ fontSize: 11, color: 'var(--danger-ink)', margin: '6px 0 0' }}>A name is required.</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <button
            type="button"
            aria-label={`Save ${item.attendingName}`}
            onClick={save}
            disabled={isBlank || emailInvalid || saving}
            style={{ ...editSaveButtonStyle, cursor: isBlank || emailInvalid || saving ? 'not-allowed' : 'pointer', opacity: isBlank || emailInvalid || saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" aria-label={`Cancel editing ${item.attendingName}`} onClick={cancel} style={cancelButtonStyle}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-roster-row" style={{ background: item.isActive ? 'transparent' : 'var(--warn-soft)' }}>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
        <strong style={{ fontSize: 13, color: 'var(--ink-1)', overflowWrap: 'anywhere' }}>{item.attendingName}</strong>
        {!item.isActive && <InactiveBadge />}
      </span>
      <span style={{ fontSize: 12, color: 'var(--ink-4)', overflowWrap: 'anywhere' }}>{item.email || '—'}</span>
      <span style={{ fontSize: 12, color: 'var(--ink-4)', overflowWrap: 'anywhere' }}>{item.phone || '—'}</span>
      <span style={{ fontSize: 12, color: 'var(--ink-4)', overflowWrap: 'anywhere' }}>{item.officeLocation || '—'}</span>
      <span className="settings-roster-actions">
        {canManage ? (
          <>
            <button
              type="button"
              aria-label={`Edit ${item.attendingName}`}
              onClick={() => setDraft(rosterDraftFrom(item))}
              style={deactivateButtonStyle}
            >
              Edit
            </button>
            <button
              type="button"
              aria-label={`${item.isActive ? 'Deactivate' : 'Restore'} ${item.attendingName}`}
              onClick={() => onSetActive(item, !item.isActive)}
              style={item.isActive ? deactivateButtonStyle : restoreButtonStyle}
            >
              {item.isActive ? 'Deactivate' : 'Restore'}
            </button>
          </>
        ) : <span style={{ fontSize: 11, color: item.isActive ? 'var(--success-ink)' : 'var(--ink-5)' }}>{item.isActive ? 'Active' : 'Inactive'}</span>}
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
        style={{ width: 18, height: 18, marginTop: 1, accentColor: 'var(--ink-1)' }}
      />
      <span>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--ink-1)' }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>{description}</span>
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

  // -- Program info -----------------------------------------------------------
  // General and Scheduling edit different fields of the same program record, so
  // each one sends only its own fields. `PUT /programs/:id` applies exactly the
  // fields a payload carries and leaves the rest of the stored record alone, so
  // neither section can overwrite the other's saved — or unsaved — values.
  const [name,      setName]      = useState(currentProgram?.programName ?? '');
  const [specialty, setSpecialty] = useState(currentProgram?.specialty   ?? '');
  const [juniorInHouseCall, setJuniorInHouseCall] = useState(currentProgram?.juniorInHouseCall ?? true);
  const [seniorInHouseCall, setSeniorInHouseCall] = useState(currentProgram?.seniorInHouseCall ?? false);
  const [juniorPgyLevels, setJuniorPgyLevels] = useState(currentProgram?.juniorPgyLevels ?? [1, 2]);
  const [savingSection, setSavingSection] = useState(null);

  const savedName = currentProgram?.programName ?? '';
  const savedSpecialty = currentProgram?.specialty ?? '';
  const savedJuniorInHouseCall = currentProgram?.juniorInHouseCall ?? true;
  const savedSeniorInHouseCall = currentProgram?.seniorInHouseCall ?? false;
  const savedJuniorPgyLevels = useMemo(() => currentProgram?.juniorPgyLevels ?? [1, 2], [currentProgram?.juniorPgyLevels]);

  useEffect(() => {
    setName(currentProgram?.programName ?? '');
    setSpecialty(currentProgram?.specialty ?? '');
    setJuniorInHouseCall(currentProgram?.juniorInHouseCall ?? true);
    setSeniorInHouseCall(currentProgram?.seniorInHouseCall ?? false);
    setJuniorPgyLevels(currentProgram?.juniorPgyLevels ?? [1, 2]);
  }, [currentProgram]);

  const saveProgramFields = async (fields, section, successMessage) => {
    if (!programId) return false;
    setSavingSection(section);
    try {
      await api.put(`/programs/${programId}`, fields);
      await refreshContext();
      toast.success(successMessage);
      return true;
    } catch {
      toast.error('Failed to update program info');
      return false;
    } finally {
      setSavingSection(null);
    }
  };

  const handleSaveGeneral = () => saveProgramFields({ name, specialty }, 'general', 'Program details saved');
  const handleSaveScheduling = () => saveProgramFields({ juniorInHouseCall, seniorInHouseCall, juniorPgyLevels }, 'scheduling', 'Call configuration saved');

  // Each section renders its own Save so the button means what it says: it
  // persists that section and nothing else.
  const sectionSaveButton = (section, onSave, label) => {
    if (!canEditProgramSettings) return null;
    const saving = savingSection === section;
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          onClick={onSave}
          disabled={saving}
          aria-label={label}
          style={{
            padding: '9px 22px', borderRadius: 9, border: 'none',
            background: 'var(--brand)', color: 'var(--ink-inverse)', fontSize: 13, fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
          }}
          onMouseEnter={e => { if (!saving) e.currentTarget.style.background = 'var(--accent)'; }}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--brand)'}
        >
          {saving ? 'Saving...' : 'Save'}
        </motion.button>
      </div>
    );
  };

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
  const [newServiceDescription, setNewServiceDescription] = useState('');
  const [newActivityName, setNewActivityName] = useState('');
  const [chiefPermissions, setChiefPermissions] = useState([]);
  const [savedChiefPermissions, setSavedChiefPermissions] = useState([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [savingPermissions, setSavingPermissions] = useState(false);
  // Ids of rows whose inline editor holds text that is not stored yet. Rows
  // report in and out; nothing else in the page needs to know their contents.
  const [rowsBeingEdited, setRowsBeingEdited] = useState(() => new Set());

  const trackRowEditing = useCallback((id, editing) => {
    setRowsBeingEdited(current => {
      if (editing === current.has(id)) return current;
      const next = new Set(current);
      if (editing) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

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
      const enabled = permissionsResult.value.data.roles.chief_resident.permissions.filter(item => item.enabled).map(item => item.permission);
      setChiefPermissions(enabled);
      setSavedChiefPermissions(enabled);
      setPermissionsLoaded(true);
    }
  }, [programId, canConfigurePermissions, canManageActivities]);

  useEffect(() => { loadProgramConfiguration(); }, [loadProgramConfiguration]);

  const mergeRecord = (setter, record) => {
    setter(current => current.map(item => item.id === record.id ? record : item));
  };

  const addRecord = (setter, record) => {
    setter(current => [...current, record]);
  };

  const setterForRegistry = kind => kind === 'clinical-services' ? setClinicalServices : setAttendingActivities;

  const offerUndo = (label, restore) => {
    toast(t => (
      <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span>{label} was deactivated.</span>
        <button
          type="button"
          aria-label={`Undo deactivation of ${label}`}
          onClick={async () => {
            try {
              await restore();
              toast.dismiss(t.id);
              toast.success(`${label} restored`);
            } catch (err) {
              toast.dismiss(t.id);
              toast.error(err.response?.data?.error ?? `Unable to restore ${label}`);
            }
          }}
          style={{ border: 0, background: 'transparent', color: 'var(--accent)', fontWeight: 700, cursor: 'pointer', padding: '2px 0' }}
        >
          Undo
        </button>
      </span>
    ), { duration: 6000 });
  };

  const addRegistryItem = async (kind, name, clear, description = '') => {
    if (!name.trim()) return;
    try {
      const { data } = await api.post(`/program-configuration/${programId}/${kind}`, {
        name,
        ...(kind === 'clinical-services' && { description }),
      });
      addRecord(setterForRegistry(kind), data);
      clear('');
      if (kind === 'clinical-services') setNewServiceDescription('');
      toast.success(kind === 'clinical-services' ? 'Clinical service added' : 'Attending activity added');
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Unable to add item');
    }
  };

  // Returns whether the change was stored, so an inline editor knows whether to
  // close or stay open with the rejected text still in it.
  const updateRegistryItem = async (kind, id, changes) => {
    try {
      const { data } = await api.put(`/program-configuration/${programId}/${kind}/${id}`, changes);
      const setter = setterForRegistry(kind);
      mergeRecord(setter, data);
      if (changes.isActive === true) {
        toast.success('Restored');
      } else if (changes.isActive === false) {
        offerUndo(data.name, async () => {
          const response = await api.put(`/program-configuration/${programId}/${kind}/${id}`, { isActive: true });
          mergeRecord(setter, response.data);
        });
      } else {
        toast.success('Saved');
      }
      return true;
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Unable to save item');
      return false;
    }
  };

  const addAttending = async () => {
    if (!newAttending.attendingName.trim() || !isValidOptionalEmail(newAttending.email)) return;
    try {
      const { data } = await api.post('/attending/roster', { programId, ...newAttending, typicalActivities: [] });
      addRecord(setAttendingRoster, data);
      setNewAttending({ attendingName: '', email: '', phone: '', officeLocation: '' });
      toast.success('Attending added to the program roster');
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Unable to add attending');
    }
  };

  const updateAttending = async (id, changes) => {
    try {
      const { data } = await api.put(`/attending/roster/${id}`, changes);
      mergeRecord(setAttendingRoster, data);
      toast.success('Attending updated');
      return true;
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Unable to update attending');
      return false;
    }
  };

  const setAttendingActive = async (item, isActive) => {
    try {
      const { data } = await api.put(`/attending/roster/${item.id}`, { isActive });
      mergeRecord(setAttendingRoster, data);
      if (isActive) {
        toast.success('Attending restored');
      } else {
        offerUndo(data.attendingName, async () => {
          const response = await api.put(`/attending/roster/${item.id}`, { isActive: true });
          mergeRecord(setAttendingRoster, response.data);
        });
      }
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Unable to update attending');
    }
  };

  const saveChiefPermissions = async () => {
    setSavingPermissions(true);
    try {
      await api.put(`/program-configuration/${programId}/role-permissions`, { role: 'chief_resident', permissions: chiefPermissions });
      setSavedChiefPermissions(chiefPermissions);
      toast.success('Chief Resident permissions updated');
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Unable to update permissions');
    } finally {
      setSavingPermissions(false);
    }
  };

  const activeAttendings = attendingRoster.filter(item => item.isActive);
  const inactiveAttendings = attendingRoster.filter(item => !item.isActive);

  // -- unsaved changes --------------------------------------------------------
  // Deliberately small: each section says whether its own fields differ from
  // what is stored, and everything that could take the user away from the
  // section asks that one question first. No shared form state, no reducers.
  const permissionsDirty = permissionsLoaded
    && (chiefPermissions.length !== savedChiefPermissions.length
      || chiefPermissions.some(permission => !savedChiefPermissions.includes(permission)));
  const newAttendingDirty = Object.values(newAttending).some(value => value.trim() !== '');

  const dirtyBySection = {
    general: name !== savedName || specialty !== savedSpecialty,
    scheduling: juniorInHouseCall !== savedJuniorInHouseCall || seniorInHouseCall !== savedSeniorInHouseCall || juniorPgyLevels.join(',') !== savedJuniorPgyLevels.join(','),
    clinical: rowsBeingEdited.size > 0 || newServiceName.trim() !== '' || newServiceDescription.trim() !== '',
    attendings: rowsBeingEdited.size > 0 || newActivityName.trim() !== '' || newAttendingDirty,
    access: permissionsDirty,
    history: false,
  };
  const sectionIsDirty = Boolean(dirtyBySection[activeSection]);

  const discardSectionChanges = useCallback((section) => {
    if (section === 'general') {
      setName(savedName);
      setSpecialty(savedSpecialty);
    }
    if (section === 'scheduling') {
      setJuniorInHouseCall(savedJuniorInHouseCall);
      setSeniorInHouseCall(savedSeniorInHouseCall);
      setJuniorPgyLevels(savedJuniorPgyLevels);
    }
    if (section === 'access') setChiefPermissions(savedChiefPermissions);
    if (section === 'clinical') {
      setNewServiceName('');
      setNewServiceDescription('');
    }
    if (section === 'attendings') {
      setNewActivityName('');
      setNewAttending({ attendingName: '', email: '', phone: '', officeLocation: '' });
    }
    // Inline row editors discard their own drafts: leaving a section unmounts
    // the rows, and unmounting is what clears them.
  }, [savedName, savedSpecialty, savedJuniorInHouseCall, savedSeniorInHouseCall, savedJuniorPgyLevels, savedChiefPermissions]);

  // Registers the page-wide guard used by the sidebar and by the browser's own
  // unload prompt.
  useUnsavedChangesGuard(sectionIsDirty);

  const discardActiveSectionRef = useRef(() => {});
  useEffect(() => {
    discardActiveSectionRef.current = () => discardSectionChanges(activeSection);
  });

  // Browser Back would otherwise drop unsaved edits without a word. While a
  // section is dirty, one extra history entry is parked on the same URL, so the
  // Back press lands here first and the question can still be asked. React
  // Router's own history state is reused, so its internal index stays intact and
  // the parked entry is invisible apart from absorbing that one press.
  //
  // The parked entry is reclaimed only if the page is still sitting on the URL
  // it was parked at. Anything that changes the URL - a tab switch, which
  // replaces the top entry, or a navigation away - has already consumed or
  // outlived it, and popping then would undo the very move the user just made.
  const parkedEntryRef = useRef(null);
  useEffect(() => {
    if (!sectionIsDirty) return undefined;
    window.history.pushState(window.history.state, '');
    parkedEntryRef.current = window.location.href;

    const handlePopState = () => {
      parkedEntryRef.current = null;
      if (window.confirm(DISCARD_PROMPT)) {
        discardActiveSectionRef.current();
        window.history.back();
        return;
      }
      window.history.pushState(window.history.state, '');
      parkedEntryRef.current = window.location.href;
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (parkedEntryRef.current === window.location.href) {
        parkedEntryRef.current = null;
        window.history.back();
      }
    };
  }, [sectionIsDirty]);

  // Replace rather than push: tab clicks should not build a history stack the
  // user has to unwind, but a refresh or a return to the page keeps the section.
  const selectSection = useCallback((id) => {
    if (id === activeSection) return;
    if (sectionIsDirty && !window.confirm(DISCARD_PROMPT)) return;
    discardSectionChanges(activeSection);
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('tab', id);
      return next;
    }, { replace: true });
  }, [activeSection, sectionIsDirty, discardSectionChanges, setSearchParams]);

  // -- render -----------------------------------------------------------------

  if (!can('view_draft_schedule') && !canEditProgramSettings && !canManageServices && !canManageActivities) {
    return (
      <PageWrapper>
        <Layout>
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border-1)', borderRadius: 12, padding: 24, color: 'var(--ink-4)' }}>
            You do not have access to program configuration.
          </div>
        </Layout>
      </PageWrapper>
    );
  }

  // Built lazily: only the visible section pays for its element tree, so a
  // keystroke in one section does not construct the member table or the
  // published-version list sitting behind another.
  const panels = {
    general: () => (
      <Card title="Program" subtitle="Program identity used throughout MedRota.">
        <div className="space-y-4">
          <div>
            <Label htmlFor="ps-program-name">Program display name</Label>
            <input id="ps-program-name" value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="e.g. Internal Medicine Residency" disabled={!canEditProgramSettings} />
            <p style={{ fontSize: 11, color: 'var(--ink-5)', marginTop: 4 }}>The name used throughout MedRota, such as &ldquo;McMaster Vascular Surgery Residency.&rdquo;</p>
          </div>
          <div>
            <Label htmlFor="ps-specialty">Primary specialty</Label>
            <select id="ps-specialty" value={specialty} onChange={e => setSpecialty(e.target.value)} style={inputStyle} disabled={!canEditProgramSettings}>
              {MEDICAL_SPECIALTIES.map(s => <option key={s} value={s}>{s}</option>)}
              {specialty && !MEDICAL_SPECIALTIES.includes(specialty) && <option value={specialty}>{specialty}</option>}
            </select>
            <p style={{ fontSize: 11, color: 'var(--ink-5)', marginTop: 4 }}>The program&rsquo;s main specialty.</p>
          </div>
          {sectionSaveButton('general', handleSaveGeneral, 'Save program details')}
        </div>
      </Card>
    ),

    clinical: () => (
      <Card title="Clinical services" subtitle="Optional program-defined services or subspecialty rotations. No specialty defaults are imposed.">
        {canManageServices && (
          <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
            <div>
              <Label htmlFor="new-clinical-service">Service</Label>
              <input id="new-clinical-service" aria-label="New clinical service" value={newServiceName} onChange={event => setNewServiceName(event.target.value)} style={inputStyle} placeholder="e.g. Acute Care Surgery" />
            </div>
            <div>
              <Label htmlFor="new-clinical-service-description">Description <span style={{ color: 'var(--ink-5)', fontWeight: 400 }}>(optional)</span></Label>
              <textarea
                id="new-clinical-service-description"
                aria-label="New clinical service description"
                value={newServiceDescription}
                onChange={event => setNewServiceDescription(event.target.value)}
                maxLength={SERVICE_DESCRIPTION_MAX_LENGTH}
                rows={2}
                style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
                placeholder="e.g. Emergency general surgery and inpatient consult service"
              />
            </div>
            <div><button onClick={() => addRegistryItem('clinical-services', newServiceName, setNewServiceName, newServiceDescription)} style={primaryButtonStyle}>Add service</button></div>
          </div>
        )}
        <RegistryList
          items={clinicalServices}
          canManage={canManageServices}
          noun="services"
          emptyMessage="No clinical services configured. This feature is optional."
          onSave={(id, changes) => updateRegistryItem('clinical-services', id, changes)}
          onEditingChange={trackRowEditing}
          showDescription
        />
      </Card>
    ),

    attendings: () => (
      <>
        {canManageActivities && <Card title="Attending roster" subtitle="Persistent program staff. Contact details stay inside authenticated program settings and are never added to the public schedule.">
          <div className="settings-field-grid" style={{ marginBottom: 14 }}>
            {[['attendingName', 'Name', 'Dr. Smith'], ['email', 'Email', 'name@example.org'], ['phone', 'Phone', 'Optional'], ['officeLocation', 'Office / location', 'Optional']].map(([field, label, placeholder]) => {
              const emailInvalid = field === 'email' && !isValidOptionalEmail(newAttending.email);
              return <div key={field}><Label htmlFor={`new-attending-${field}`}>{label}</Label><input id={`new-attending-${field}`} type={field === 'email' ? 'email' : 'text'} value={newAttending[field]} onChange={event => setNewAttending(previous => ({ ...previous, [field]: event.target.value }))} placeholder={placeholder} aria-invalid={emailInvalid ? 'true' : undefined} aria-describedby={emailInvalid ? 'new-attending-email-error' : undefined} style={{ ...inputStyle, borderColor: emailInvalid ? 'var(--danger-border)' : 'var(--border-strong)' }} />{emailInvalid && <span id="new-attending-email-error" role="alert" style={{ display: 'block', fontSize: 11, color: 'var(--danger-ink)', marginTop: 3 }}>Enter a valid email address.</span>}</div>;
            })}
            <button onClick={addAttending} disabled={!newAttending.attendingName.trim() || !isValidOptionalEmail(newAttending.email)} style={{ ...primaryButtonStyle, opacity: !newAttending.attendingName.trim() || !isValidOptionalEmail(newAttending.email) ? 0.6 : 1, cursor: !newAttending.attendingName.trim() || !isValidOptionalEmail(newAttending.email) ? 'not-allowed' : 'pointer' }}>Add attending</button>
          </div>
          {attendingRoster.length === 0 ? <p style={{ fontSize: 13, color: 'var(--ink-5)' }}>No attending staff configured.</p> : (
            <div>
              <RegistryHeader
                activeCount={activeAttendings.length}
                inactiveCount={inactiveAttendings.length}
                noun="attendings"
                showInactive={showInactiveAttendings}
                onToggle={() => setShowInactiveAttendings(current => !current)}
              />
              {activeAttendings.length === 0
                ? <p style={{ fontSize: 13, color: 'var(--ink-5)' }}>No active attendings.</p>
                : activeAttendings.map(item => <RosterRow key={item.id} item={item} canManage={canManageActivities} onSave={updateAttending} onSetActive={setAttendingActive} onEditingChange={trackRowEditing} />)}
              {showInactiveAttendings && (
                <InactiveGroup
                  noun="attendings"
                  items={inactiveAttendings}
                  labelOf={rosterLabel}
                  renderItem={item => <RosterRow key={item.id} item={item} canManage={canManageActivities} onSave={updateAttending} onSetActive={setAttendingActive} onEditingChange={trackRowEditing} />}
                />
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
            onEditingChange={trackRowEditing}
          />
        </Card>
      </>
    ),

    scheduling: () => (
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
          <div style={{ borderTop: '1px solid var(--border-2)', paddingTop: 16 }}>
            <div style={{ color: 'var(--ink-1)', fontSize: 13, fontWeight: 700 }}>Junior PGY levels</div>
            <p style={{ color: 'var(--ink-4)', fontSize: 12, margin: '4px 0 10px' }}>Checked levels schedule as junior; remaining resident levels schedule as senior. Individual overrides remain available.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[1,2,3,4,5,6,7,8,9,10].map(level => <label key={level} style={{ minWidth: 74, display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border-strong)', borderRadius: 8, padding: '7px 9px', color: 'var(--ink-2)', fontSize: 12 }}><input type="checkbox" aria-label={`PGY-${level} is junior`} checked={juniorPgyLevels.includes(level)} disabled={!canEditProgramSettings} onChange={event => setJuniorPgyLevels(current => event.target.checked ? [...current, level].sort((a,b) => a-b) : current.filter(item => item !== level))} />PGY-{level}</label>)}
            </div>
          </div>
          {sectionSaveButton('scheduling', handleSaveScheduling, 'Save call configuration')}
        </div>
      </Card>
    ),

    access: () => (
      <>
        {canManageUsers && <>
        <Card title="Team Members" subtitle="View and manage who has access to this program.">
          {loadingMembers ? (
            <p style={{ fontSize: 13, color: 'var(--ink-5)' }}>Loading...</p>
          ) : members.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--ink-5)', fontStyle: 'italic' }}>No members yet.</p>
          ) : (
            <div>
              <div className="settings-member-row" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Name</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Email</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Role</span>
                <span />
              </div>
              <div className="space-y-2">
                {members.map(m => {
                  const isSelf = m.userId === currentUser?.userId;
                  const memberLabel = m.user?.name ?? m.user?.email ?? 'member';
                  return (
                    <div key={m.id} className="settings-member-row" style={{ padding: '10px 12px', borderRadius: 8, border: isSelf ? '1px solid var(--accent-border-2)' : '1px solid var(--border-subtle)', background: isSelf ? 'var(--accent-soft-2)' : 'var(--surface-1)' }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-1)', overflowWrap: 'anywhere' }}>
                        {m.user?.name ?? '-'}
                        {isSelf && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '1px 6px', borderRadius: 99 }}>You</span>}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--ink-4)', overflowWrap: 'anywhere' }}>{m.user?.email ?? '-'}</span>
                      <select
                        aria-label={`Role for ${memberLabel}`}
                        value={m.role}
                        onChange={e => handleRoleChange(m.userId, e.target.value)}
                        disabled={!canManageUsers}
                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-strong)', fontSize: 12, color: 'var(--ink-1)', background: 'var(--surface-2)', outline: 'none', cursor: 'pointer', maxWidth: '100%' }}
                      >
                        {ROLE_OPTIONS.map(role => (
                          <option key={role.value} value={role.value}>{role.label}</option>
                        ))}
                      </select>
                      {isSelf ? (
                        <button
                          onClick={handleLeaveProgram}
                          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--danger-border)', background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', justifySelf: 'start' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--danger-soft-2)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'var(--danger-soft)'}
                        >
                          Leave program
                        </button>
                      ) : (
                        <button
                          onClick={() => handleRemoveMember(m.userId)}
                          disabled={!canManageUsers}
                          aria-label={`Remove ${memberLabel}`}
                          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--danger-border)', background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', justifySelf: 'start' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--danger-soft-2)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'var(--danger-soft)'}
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
                  style={{ ...inputStyle, background: 'var(--accent-soft-2)', color: 'var(--accent)', fontFamily: 'monospace', fontSize: 12 }}
                />
                <button
                  onClick={handleCopyInvite}
                  style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--accent-border-2)', background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--border-3)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--accent-soft)'}
                >
                  Copy
                </button>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--ink-5)', fontStyle: 'italic' }}>No invite link generated yet.</p>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                onClick={handleGenerateInvite}
                disabled={generatingInvite}
                style={{
                  padding: '9px 18px', borderRadius: 9, border: 'none',
                  background: 'var(--brand)', color: 'var(--ink-inverse)', fontSize: 13, fontWeight: 600,
                  cursor: generatingInvite ? 'not-allowed' : 'pointer', opacity: generatingInvite ? 0.7 : 1,
                }}
                onMouseEnter={e => { if (!generatingInvite) e.currentTarget.style.background = 'var(--accent)'; }}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--brand)'}
              >
                {generatingInvite ? 'Generating...' : inviteLink ? 'Regenerate' : 'Generate invite link'}
              </motion.button>
            </div>
          </div>
        </Card>
        </>}

        {canConfigurePermissions && <Card title="Role permissions" subtitle="Program Admins and Directors always retain full access. Viewers always remain read-only.">
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 8, background: 'var(--surface-2)', fontSize: 13, color: 'var(--ink-3)' }}><strong style={{ color: 'var(--ink-1)' }}>Program Admin / Program Director</strong><br />Full program access</div>
            <div style={{ padding: 12, borderRadius: 8, border: '1px solid var(--accent-border)' }}>
              <strong style={{ color: 'var(--ink-1)', fontSize: 14 }}>Chief Resident</strong>
              {!permissionsLoaded ? <p style={{ fontSize: 13, color: 'var(--ink-5)', marginTop: 10 }}>Loading permissions&hellip;</p> : PERMISSION_GROUPS.map(group => <div key={group.title} style={{ marginTop: 14 }}><p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-4)', textTransform: 'uppercase', marginBottom: 6 }}>{group.title}</p>{group.items.map(([permission, label]) => <label key={permission} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', fontSize: 13, color: 'var(--ink-2)' }}><input type="checkbox" checked={chiefPermissions.includes(permission)} onChange={event => setChiefPermissions(previous => event.target.checked ? [...previous, permission] : previous.filter(item => item !== permission))} />{label}</label>)}</div>)}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button onClick={saveChiefPermissions} disabled={savingPermissions || !permissionsLoaded} style={{ padding: '8px 14px', border: 0, borderRadius: 8, background: 'var(--brand)', color: 'var(--ink-inverse)', fontSize: 12, fontWeight: 600, cursor: permissionsLoaded ? 'pointer' : 'not-allowed', opacity: permissionsLoaded ? 1 : 0.6 }}>{savingPermissions ? 'Saving…' : 'Save permissions'}</button></div>
            </div>
            <div style={{ padding: 12, borderRadius: 8, background: 'var(--surface-2)', fontSize: 13, color: 'var(--ink-3)' }}><strong style={{ color: 'var(--ink-1)' }}>Viewer</strong><br />Published schedule access only</div>
          </div>
        </Card>}
      </>
    ),

    history: () => (
      <>
        <Card
          title="Published Versions"
          subtitle={currentBlock ? `Version history for Block ${currentBlock.number}` : 'Select a block to see published versions.'}
        >
          {!currentBlock ? (
            <p style={{ fontSize: 13, color: 'var(--ink-5)', fontStyle: 'italic' }}>No block selected.</p>
          ) : loadingVersions ? (
            <p style={{ fontSize: 13, color: 'var(--ink-5)' }}>Loading...</p>
          ) : versions.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--ink-5)', fontStyle: 'italic' }}>No published versions yet.</p>
          ) : (
            <div className="space-y-2">
              {versions.map((v, i) => (
                <div key={v.id} style={{
                  display: 'flex', flexWrap: 'wrap', gap: 8,
                  alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 12px', borderRadius: 8,
                  border: '1px solid var(--border-subtle)', background: i === 0 ? 'var(--success-soft)' : 'var(--surface-1)',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-1)' }}>
                      {fmtVersionDate(v.publishedAt)}
                      {i === 0 && (
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: 'var(--success-ink)', background: 'var(--success-soft-2)', padding: '1px 6px', borderRadius: 99 }}>
                          Latest
                        </span>
                      )}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--ink-5)', marginTop: 2 }}>
                      {v.publishedBy ? `By ${v.publishedBy}` : 'Unknown user'} - {v.assignedDays} assigned days
                    </p>
                  </div>
                  <button
                    onClick={() => setSnapshotModal(v)}
                    style={{
                      padding: '5px 12px', borderRadius: 6, border: '1px solid var(--accent-border)',
                      background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--border-3)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'var(--accent-soft)'}
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
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-1)', margin: 0 }}>Program Settings</h1>
            <p style={{ fontSize: 13, color: 'var(--ink-5)', marginTop: 4 }}>Manage your program details, team, and invitations.</p>
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
              {panels[activeSection]?.()}
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
                    if (callDays.length === 0) return <p style={{ color: 'var(--ink-5)', fontSize: 13 }}>No schedule data in this snapshot.</p>;

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
                              background: isHol ? 'var(--danger-soft-3)' : i % 2 === 0 ? 'var(--surface-2)' : 'var(--surface-1)',
                              border: '1px solid var(--border-subtle)',
                            }}>
                              <span style={{ fontWeight: 600, color: isHol ? 'var(--danger)' : 'var(--ink-1)' }}>
                                {dayLabel} {isHol && '(H)'}
                              </span>
                              <span style={{ color: seniors ? 'var(--success-ink)' : 'var(--ink-5)', overflowWrap: 'anywhere' }}>
                                {seniors || '-'}
                              </span>
                              <span style={{ color: juniors ? 'var(--warn-ink)' : 'var(--ink-5)', overflowWrap: 'anywhere' }}>
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
