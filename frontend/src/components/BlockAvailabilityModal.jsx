// "Set block availability" — enroll several residents in one pass, or copy the
// previous block's configuration forward.
//
// Availability stays explicit: nothing is inferred, and copying never
// overwrites availability that already exists in the target block.

import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from './Modal';

function ResidentRow({ resident, checked, disabled, onToggle }) {
  const inputId = `avail-${resident.id}`;
  return (
    <li>
      <label
        htmlFor={inputId}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
          borderRadius: 9, cursor: disabled ? 'default' : 'pointer',
          background: checked && !disabled ? 'var(--accent-soft-2)' : 'transparent',
        }}
      >
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={() => onToggle(resident.id)}
          style={{ width: 16, height: 16, flexShrink: 0, accentColor: 'var(--accent)' }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1)', flex: 1, minWidth: 0 }}>
          {resident.name}
        </span>
        <span style={{ fontSize: 11, color: 'var(--ink-4)', flexShrink: 0 }}>
          {resident.isMedStudent ? 'Student' : resident.residentRole === 'senior' ? 'Senior' : 'Junior'}
        </span>
        {disabled && (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--success)', flexShrink: 0 }}>
            Already set
          </span>
        )}
      </label>
    </li>
  );
}

export default function BlockAvailabilityModal({
  blockId, blockNumber, residents, allYearBlocks = [], onClose, onApplied,
}) {
  // Deliberately the same population the generator and the readiness check use:
  // every active service resident, medical students included. Anyone the
  // generator would want to consider must be settable here.
  const candidates = useMemo(
    () => residents.filter(r => r.isServiceResident && r.isActive !== false),
    [residents],
  );
  const missing = useMemo(
    () => candidates.filter(r => !r.isEnrolledThisBlock),
    [candidates],
  );

  const [selected, setSelected] = useState(() => new Set(missing.map(r => r.id)));
  const [copyFromId, setCopyFromId] = useState('');
  const [saving, setSaving] = useState(false);

  // Only earlier blocks make sense as a source to copy forward from.
  const earlierBlocks = useMemo(
    () => allYearBlocks
      .filter(b => b.id !== blockId && typeof blockNumber === 'number' && b.number < blockNumber)
      .sort((a, b) => b.number - a.number),
    [allYearBlocks, blockId, blockNumber],
  );

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectableIds = missing.map(r => r.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selected.has(id));

  const handleBulk = async () => {
    const ids = [...selected].filter(id => selectableIds.includes(id));
    if (ids.length === 0) {
      toast.error('Select at least one resident');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post(`/blocks/${blockId}/availability/bulk`, { residentIds: ids });
      toast.success(
        data.enrolled === 0
          ? 'Everyone selected already had availability'
          : `Block availability set for ${data.enrolled} resident${data.enrolled === 1 ? '' : 's'}`,
      );
      onApplied();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Failed to set block availability');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!copyFromId) {
      toast.error('Choose a block to copy from');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post(`/blocks/${blockId}/availability/copy`, { fromBlockId: copyFromId });
      if (data.copied === 0) {
        toast.success('Nothing to copy — every resident already has availability here');
      } else {
        const dropped = data.vacationDatesDropped > 0
          ? `, ${data.vacationDatesDropped} out-of-range vacation date${data.vacationDatesDropped === 1 ? '' : 's'} skipped`
          : '';
        toast.success(`Copied ${data.copied} resident${data.copied === 1 ? '' : 's'}${dropped}`);
      }
      onApplied();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error ?? 'Failed to copy availability');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Set block availability"
      description={`Block ${blockNumber ?? ''}`.trim()}
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={(
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button" onClick={onClose} disabled={saving}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium"
            style={{ background: 'var(--surface-1)', color: 'var(--ink-4)', border: '1px solid var(--border-2)', cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="button" onClick={handleBulk} disabled={saving || missing.length === 0}
            data-testid="availability-apply"
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-on-solid"
            style={{
              background: 'var(--brand)', border: 'none',
              cursor: saving || missing.length === 0 ? 'not-allowed' : 'pointer',
              opacity: saving || missing.length === 0 ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving...' : `Mark ${[...selected].filter(id => selectableIds.includes(id)).length} active for this block`}
          </button>
        </div>
      )}
    >
      {earlierBlocks.length > 0 && (
        <div style={{ marginBottom: 18, padding: 12, borderRadius: 11, background: 'var(--surface-2)', border: '1px solid var(--border-1)' }}>
          <label htmlFor="copy-from-block" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 6 }}>
            Copy availability forward
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              id="copy-from-block"
              value={copyFromId}
              onChange={e => setCopyFromId(e.target.value)}
              style={{ flex: '1 1 160px', minWidth: 0, padding: '8px 10px', borderRadius: 9, border: '1px solid var(--border-strong)', fontSize: 13, color: 'var(--ink-1)', background: 'var(--surface-1)' }}
            >
              <option value="">Choose a previous block…</option>
              {earlierBlocks.map(b => <option key={b.id} value={b.id}>Block {b.number}</option>)}
            </select>
            <button
              type="button" onClick={handleCopy} disabled={saving || !copyFromId}
              data-testid="availability-copy"
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{
                background: 'var(--surface-1)', color: 'var(--accent)', border: '1px solid var(--accent-border-3)',
                cursor: saving || !copyFromId ? 'not-allowed' : 'pointer',
                opacity: saving || !copyFromId ? 0.6 : 1,
              }}
            >
              Copy
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>
            Copies service status, call cap and academic-day preference. Vacation dates are only copied when they
            fall inside this block, and residents who already have availability here are left untouched.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)' }}>
          Residents ({candidates.length - missing.length}/{candidates.length} already set)
        </span>
        {missing.length > 0 && (
          <button
            type="button"
            onClick={() => setSelected(allSelected ? new Set() : new Set(selectableIds))}
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {allSelected ? 'Clear all' : 'Select all'}
          </button>
        )}
      </div>

      {candidates.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--ink-5)', fontStyle: 'italic' }}>
          No active service residents in this program yet.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {candidates.map(resident => (
            <ResidentRow
              key={resident.id}
              resident={resident}
              checked={resident.isEnrolledThisBlock || selected.has(resident.id)}
              disabled={resident.isEnrolledThisBlock}
              onToggle={toggle}
            />
          ))}
        </ul>
      )}

      {missing.length === 0 && candidates.length > 0 && (
        <p style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600, marginTop: 12 }}>
          Every active service resident already has availability for this block.
        </p>
      )}
    </Modal>
  );
}
