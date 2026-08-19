import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import Layout from '../components/Layout';
import PageWrapper from '../components/PageWrapper';
import api from '../api/axios';
import { useBlock, useUser } from '../context/AppContext';

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        background: checked ? '#1A3A5C' : '#E2E8F0', position: 'relative',
        transition: 'background 0.2s', flexShrink: 0, padding: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 21 : 3,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        display: 'block',
      }} />
    </button>
  );
}

// ── SettingRow ─────────────────────────────────────────────────────────────────

function SettingRow({ label, description, children }) {
  return (
    <div className="flex items-center justify-between gap-6 py-4" style={{ borderBottom: '1px solid #F1F5F9' }}>
      <div>
        <p style={{ fontSize: 14, fontWeight: 500, color: '#1A3A5C', margin: 0 }}>{label}</p>
        {description && <p style={{ fontSize: 12, color: '#94A3B8', margin: '2px 0 0' }}>{description}</p>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

// ── NumberInput ───────────────────────────────────────────────────────────────

function NumberInput({ value, onChange, min = 0, max = 30 }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={e => onChange(Number(e.target.value))}
      style={{
        width: 72, padding: '6px 10px', borderRadius: 8,
        border: '1px solid #E2E8F0', fontSize: 14, color: '#1A3A5C',
        fontWeight: 600, textAlign: 'center', outline: 'none',
        background: '#F8FAFC',
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
          <div style={{ background: '#fff', border: '1px solid #E8EFF6', borderRadius: 12, padding: 24, color: '#64748B' }}>
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
              style={{ background: '#F0F5FF', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: '#2C5F8A', fontSize: 13, fontWeight: 500 }}
              onMouseEnter={e => e.currentTarget.style.background = '#DCE9F5'}
              onMouseLeave={e => e.currentTarget.style.background = '#F0F5FF'}
            >
              ← Back
            </button>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1A3A5C', margin: 0 }}>Block {blockNumber} Settings</h1>
              {block && (
                <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
                  {new Date(block.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' – '}
                  {new Date(block.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              )}
            </div>
          </div>

          {!blockId ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8' }}>
              Block not found. Select a block from the sidebar first.
            </div>
          ) : loading ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8' }}>Loading…</div>
          ) : (
            <div
              className="rounded-xl"
              style={{ background: '#fff', border: '1px solid #E8EFF6', boxShadow: '0 1px 3px rgba(26,58,92,0.05)', overflow: 'hidden' }}
            >
              {/* Card header */}
              <div style={{ padding: '18px 24px', borderBottom: '1px solid #E8EFF6', background: '#F8FAFC' }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1A3A5C', margin: 0 }}>Scheduling Constraints</h2>
                <p style={{ fontSize: 12, color: '#94A3B8', margin: '3px 0 0' }}>These settings control the auto-generate algorithm for this block.</p>
              </div>

              <div style={{ padding: '0 24px' }}>
                <SettingRow
                  label="Local resident call ceiling"
                  description="A stricter local cap; enter 0 to use the PARO-derived maximum only"
                >
                  <NumberInput value={settings.maxCallsPerResident} onChange={val => set('maxCallsPerResident', val)} />
                </SettingRow>

                <SettingRow
                  label="Medical-student call ceiling"
                  description="Maximum number of calls for a medical student in this block"
                >
                  <NumberInput value={settings.maxCallsMedStudent} onChange={val => set('maxCallsMedStudent', val)} />
                </SettingRow>

                <SettingRow
                  label="Attending-only days"
                  description="Allow days where only an attending is assigned and no resident"
                >
                  <Toggle
                    checked={settings.allowAttendingOnlyDays}
                    onChange={val => set('allowAttendingOnlyDays', val)}
                  />
                </SettingRow>

                <SettingRow
                  label="Avoid academic half-days"
                  description="Try to avoid scheduling call on academic or educational half-days"
                >
                  <Toggle
                    checked={settings.avoidAcademicDays}
                    onChange={val => set('avoidAcademicDays', val)}
                  />
                </SettingRow>
              </div>

              <div style={{ padding: '16px 24px', borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'flex-end' }}>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    padding: '10px 24px', borderRadius: 10, border: 'none',
                    background: '#1A3A5C', color: '#fff', fontSize: 14, fontWeight: 600,
                    cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
                  }}
                  onMouseEnter={e => { if (!saving) e.currentTarget.style.background = '#2C5F8A'; }}
                  onMouseLeave={e => e.currentTarget.style.background = '#1A3A5C'}
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
