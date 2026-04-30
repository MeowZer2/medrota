import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import Layout from '../components/Layout';
import PageWrapper from '../components/PageWrapper';
import api from '../api/axios';
import { useApp } from '../context/AppContext';

// ── helpers ───────────────────────────────────────────────────────────────────

function Card({ title, subtitle, children }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #E8EFF6', boxShadow: '0 1px 3px rgba(26,58,92,0.05)', marginBottom: 20 }}>
      <div style={{ padding: '18px 24px', borderBottom: '1px solid #E8EFF6', background: '#F8FAFC' }}>
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

function Label({ children }) {
  return <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#64748B', marginBottom: 5 }}>{children}</label>;
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function ProgramSettings() {
  const { currentUser, currentProgram, currentBlock, refreshContext } = useApp();
  const navigate = useNavigate();
  const programId = currentProgram?.programId;

  // ── Section 1: Program info ───────────────────────────────────────────────
  const [name,      setName]      = useState(currentProgram?.programName ?? '');
  const [specialty, setSpecialty] = useState(currentProgram?.specialty   ?? '');
  const [savingInfo, setSavingInfo] = useState(false);

  useEffect(() => {
    setName(currentProgram?.programName ?? '');
    setSpecialty(currentProgram?.specialty ?? '');
  }, [currentProgram]);

  const handleSaveInfo = async () => {
    if (!programId) return;
    setSavingInfo(true);
    try {
      await api.put(`/programs/${programId}`, { name, specialty });
      await refreshContext();
      toast.success('Program info updated!');
    } catch {
      toast.error('Failed to update program info');
    } finally {
      setSavingInfo(false);
    }
  };

  // ── Section 2: Team members ───────────────────────────────────────────────
  const [members, setMembers]       = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  const loadMembers = () => {
    if (!programId) return;
    setLoadingMembers(true);
    api.get(`/programs/${programId}/members`)
      .then(({ data }) => setMembers(data))
      .catch(() => toast.error('Failed to load members'))
      .finally(() => setLoadingMembers(false));
  };

  useEffect(() => { loadMembers(); }, [programId]);

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

  // ── Section 3: Invite link ────────────────────────────────────────────────
  const [inviteLink,       setInviteLink]       = useState('');
  const [generatingInvite, setGeneratingInvite] = useState(false);

  const handleGenerateInvite = async () => {
    if (!programId) return;
    setGeneratingInvite(true);
    try {
      const { data } = await api.post(`/programs/${programId}/invite`, { role: 'viewer' });
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

  // ── Section 4: Published versions ──────────────────────────────────────
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

  // ── render ────────────────────────────────────────────────────────────────

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

          {/* ── Program info ────────────────────────────────────────────── */}
          <Card title="Program Info" subtitle="Update the program name and specialty.">
            <div className="space-y-4">
              <div>
                <Label>Program name</Label>
                <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="e.g. Internal Medicine Residency" />
              </div>
              <div>
                <Label>Specialty</Label>
                <input value={specialty} onChange={e => setSpecialty(e.target.value)} style={inputStyle} placeholder="e.g. Internal Medicine" />
              </div>
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
                  {savingInfo ? 'Saving…' : 'Save'}
                </motion.button>
              </div>
            </div>
          </Card>

          {/* ── Team members ─────────────────────────────────────────────── */}
          <Card title="Team Members" subtitle="View and manage who has access to this program.">
            {loadingMembers ? (
              <p style={{ fontSize: 13, color: '#94A3B8' }}>Loading…</p>
            ) : members.length === 0 ? (
              <p style={{ fontSize: 13, color: '#CBD5E1', fontStyle: 'italic' }}>No members yet.</p>
            ) : (
              <div>
                {/* Table header */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 12, padding: '8px 12px', borderRadius: 8, background: '#F8FAFC', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Name</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Email</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Role</span>
                  <span />
                </div>
                <div className="space-y-2">
                  {members.map(m => {
                    const isSelf = m.userId === currentUser?.userId;
                    return (
                      <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 12, alignItems: 'center', padding: '10px 12px', borderRadius: 8, border: isSelf ? '1px solid #C7D9EC' : '1px solid #F1F5F9', background: isSelf ? '#F8FCFF' : '#fff' }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: '#1A3A5C' }}>
                          {m.user?.name ?? '—'}
                          {isSelf && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#2C5F8A', background: '#EEF4FF', padding: '1px 6px', borderRadius: 99 }}>You</span>}
                        </span>
                        <span style={{ fontSize: 13, color: '#64748B' }}>{m.user?.email ?? '—'}</span>
                        <select
                          value={m.role}
                          onChange={e => handleRoleChange(m.userId, e.target.value)}
                          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #E2E8F0', fontSize: 12, color: '#1A3A5C', background: '#F8FAFC', outline: 'none', cursor: 'pointer' }}
                        >
                          <option value="admin">Admin</option>
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        {isSelf ? (
                          <button
                            onClick={handleLeaveProgram}
                            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#DC2626', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#FEE2E2'}
                            onMouseLeave={e => e.currentTarget.style.background = '#FEF2F2'}
                          >
                            Leave program
                          </button>
                        ) : (
                          <button
                            onClick={() => handleRemoveMember(m.userId)}
                            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#DC2626', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
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

          {/* ── Invite link ──────────────────────────────────────────────── */}
          <Card title="Invite Link" subtitle="Share a link so others can join this program as a viewer.">
            <div className="space-y-3">
              {inviteLink ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    readOnly
                    value={inviteLink}
                    style={{ ...inputStyle, flex: 1, background: '#F0F5FF', color: '#2C5F8A', fontFamily: 'monospace', fontSize: 12 }}
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
                  {generatingInvite ? 'Generating…' : inviteLink ? 'Regenerate' : 'Generate invite link'}
                </motion.button>
              </div>
            </div>
          </Card>

          {/* ── Published versions ─────────────────────────────────────── */}
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
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', borderRadius: 8,
                    border: '1px solid #F1F5F9', background: i === 0 ? '#F0FDF4' : '#fff',
                  }}>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 500, color: '#1A3A5C' }}>
                        {fmtVersionDate(v.publishedAt)}
                        {i === 0 && (
                          <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#15803D', background: '#DCFCE7', padding: '1px 6px', borderRadius: 99 }}>
                            Latest
                          </span>
                        )}
                      </p>
                      <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                        {v.publishedBy ? `By ${v.publishedBy}` : 'Unknown user'} · {v.assignedDays} assigned days
                      </p>
                    </div>
                    <button
                      onClick={() => setSnapshotModal(v)}
                      style={{
                        padding: '5px 12px', borderRadius: 6, border: '1px solid #D6E4F7',
                        background: '#EEF4FF', color: '#2C5F8A', fontSize: 12, fontWeight: 600,
                        cursor: 'pointer',
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
        </motion.div>

        {/* Snapshot modal */}
        <AnimatePresence>
          {snapshotModal && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
              style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)' }}
              onClick={() => setSnapshotModal(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 16 }}
                transition={{ duration: 0.25 }}
                className="w-full max-w-2xl max-h-[80vh] rounded-2xl overflow-hidden flex flex-col"
                style={{ background: '#fff', boxShadow: '0 20px 60px rgba(26,58,92,0.18)', border: '1px solid #E8EFF6' }}
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid #E8EFF6' }}>
                  <div>
                    <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1A3A5C', margin: 0 }}>
                      Snapshot — {fmtVersionDate(snapshotModal.publishedAt)}
                    </h2>
                    <p style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
                      {snapshotModal.publishedBy ? `Published by ${snapshotModal.publishedBy}` : ''} · {snapshotModal.assignedDays} assigned days
                    </p>
                  </div>
                  <button
                    onClick={() => setSnapshotModal(null)}
                    style={{ color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4">
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
                              display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 8,
                              padding: '6px 10px', borderRadius: 6, fontSize: 12,
                              background: isHol ? '#FFF5F5' : i % 2 === 0 ? '#F8FAFC' : '#fff',
                              border: '1px solid #F1F5F9',
                            }}>
                              <span style={{ fontWeight: 600, color: isHol ? '#DC2626' : '#1A3A5C' }}>
                                {dayLabel} {isHol && '(H)'}
                              </span>
                              <span style={{ color: seniors ? '#15803D' : '#CBD5E1' }}>
                                {seniors || '—'}
                              </span>
                              <span style={{ color: juniors ? '#B45309' : '#CBD5E1' }}>
                                {juniors || '—'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </Layout>
    </PageWrapper>
  );
}
