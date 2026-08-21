import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import Layout from '../components/Layout';
import PageWrapper from '../components/PageWrapper';
import api from '../api/axios';
import { useBlock, useUser } from '../context/AppContext';

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled, id, label }) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        background: checked ? 'var(--brand)' : 'var(--surface-3)', position: 'relative',
        transition: 'background 0.2s', flexShrink: 0, padding: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 21 : 3,
        width: 16, height: 16, borderRadius: '50%', background: 'var(--surface-1)',
        transition: 'left 0.2s', boxShadow: 'var(--shadow-sm)',
        display: 'block',
      }} />
    </button>
  );
}

// ── SettingRow ─────────────────────────────────────────────────────────────────

function SettingRow({ controlId, label, description, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <div style={{ minWidth: 0, flex: '1 1 220px' }}>
        <label htmlFor={controlId} style={{ display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--ink-1)', margin: 0 }}>{label}</label>
        {description && <p style={{ fontSize: 12, color: 'var(--ink-5)', margin: '2px 0 0' }}>{description}</p>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

// ── NumberInput ───────────────────────────────────────────────────────────────

function NumberInput({ value, onChange, min = 0, max = 30, id }) {
  return (
    <input
      id={id}
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={e => onChange(Number(e.target.value))}
      style={{
        width: 72, padding: '6px 10px', borderRadius: 8,
        border: '1px solid var(--border-strong)', fontSize: 14, color: 'var(--ink-1)',
        fontWeight: 600, textAlign: 'center', outline: 'none',
        background: 'var(--surface-2)',
      }}
    />
  );
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function BlockSettings() {
  const { blockNumber } = useParams();
  const navigate        = useNavigate();
  const { currentAcademicYear } = useBlock();
  const { can } = useUser();

  // Resolve the block from context
  const block = currentAcademicYear?.blocks?.find(b => String(b.number) === String(blockNumber));
  const blockId = block?.id ?? null;

  const [settings, setSettings] = useState({
    maxCallsPerResident:    9,
    maxCallsMedStudent:     5,
    allowAttendingOnlyDays:  false,
    avoidAcademicDays:       true,
  });
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    if (!blockId || !can('edit_block_settings')) return;
    setLoading(true);
    api.get(`/blocks/${blockId}/settings`)
      .then(({ data }) => setSettings({
        maxCallsPerResident:     data.maxCallsPerResident    ?? 9,
        maxCallsMedStudent:      data.maxCallsMedStudent     ?? 5,
        allowAttendingOnlyDays:  data.allowAttendingOnlyDays  ?? false,
        avoidAcademicDays:       data.avoidAcademicDays       ?? true,
      }))
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setLoading(false));
  }, [blockId, can]);

  const handleSave = async () => {
    if (!blockId) return;
    setSaving(true);
    try {
      await api.put(`/blocks/${blockId}/settings`, settings);
      toast.success('Settings saved!');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const set = (key, val) => setSettings(p => ({ ...p, [key]: val }));

  return (
    <PageWrapper>
      <Layout>
        {!can('edit_block_settings') ? (
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border-1)', borderRadius: 12, padding: 24, color: 'var(--ink-4)' }}>
            Block settings are available to Chief Residents, Program Admins, and Program Directors.
          </div>
        ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Page header */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => navigate(`/blocks/${blockNumber}/calendar`)}
              style={{ background: 'var(--accent-soft-2)', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: 'var(--accent)', fontSize: 13, fontWeight: 500 }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--border-3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--accent-soft-2)'}
            >
              ← Back
            </button>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink-1)', margin: 0 }}>Block {blockNumber} Settings</h1>
              {block && (
                <p style={{ fontSize: 12, color: 'var(--ink-5)', marginTop: 2 }}>
                  {new Date(block.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' – '}
                  {new Date(block.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              )}
            </div>
          </div>

          {!blockId ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-5)' }}>
              Block not found. Select a block from the sidebar first.
            </div>
          ) : loading ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--ink-5)' }}>Loading…</div>
          ) : (
            <div
              className="rounded-xl"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border-1)', boxShadow: 'var(--shadow-xs)', overflow: 'hidden' }}
            >
              {/* Card header */}
              <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-1)', background: 'var(--surface-2)' }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink-1)', margin: 0 }}>Scheduling Constraints</h2>
                <p style={{ fontSize: 12, color: 'var(--ink-5)', margin: '3px 0 0' }}>These settings control the auto-generate algorithm for this block.</p>
              </div>

              <div style={{ padding: '0 24px' }}>
                <SettingRow
                  label="Local resident call ceiling"
                  controlId="bs-max-calls-resident"
                  description="A stricter local cap; enter 0 to use the PARO-derived maximum only"
                >
                  <NumberInput id="bs-max-calls-resident" value={settings.maxCallsPerResident} onChange={val => set('maxCallsPerResident', val)} />
                </SettingRow>

                <SettingRow
                  label="Medical-student call ceiling"
                  controlId="bs-max-calls-student"
                  description="Maximum number of calls for a medical student in this block"
                >
                  <NumberInput id="bs-max-calls-student" value={settings.maxCallsMedStudent} onChange={val => set('maxCallsMedStudent', val)} />
                </SettingRow>

                <SettingRow
                  label="Attending-only days"
                  controlId="bs-attending-only"
                  description="Allow days where only an attending is assigned and no resident"
                >
                  <Toggle
                    id="bs-attending-only"
                    label="Attending-only days"
                    checked={settings.allowAttendingOnlyDays}
                    onChange={val => set('allowAttendingOnlyDays', val)}
                  />
                </SettingRow>

                <SettingRow
                  label="Avoid academic half-days"
                  controlId="bs-avoid-academic"
                  description="Try to avoid scheduling call on academic or educational half-days"
                >
                  <Toggle
                    id="bs-avoid-academic"
                    label="Avoid academic half-days"
                    checked={settings.avoidAcademicDays}
                    onChange={val => set('avoidAcademicDays', val)}
                  />
                </SettingRow>
              </div>

              <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end' }}>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    padding: '10px 24px', borderRadius: 10, border: 'none',
                    background: 'var(--brand)', color: 'var(--ink-inverse)', fontSize: 14, fontWeight: 600,
                    cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
                  }}
                  onMouseEnter={e => { if (!saving) e.currentTarget.style.background = 'var(--accent)'; }}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--brand)'}
                >
                  {saving ? 'Saving…' : 'Save settings'}
                </motion.button>
              </div>
            </div>
          )}
        </motion.div>
        )}
      </Layout>
    </PageWrapper>
  );
}
