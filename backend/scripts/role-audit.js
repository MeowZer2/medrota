const prisma = require('../lib/prisma');
const { ROLES, normalizeRole } = require('../lib/roles');

const CANONICAL = new Set(Object.values(ROLES));
const LEGACY = new Set(['coordinator', 'admin', 'builder', 'editor']);

function inc(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

async function main() {
  const memberships = await prisma.programMember.findMany({
    select: { role: true, programId: true },
  });
  const invites = await prisma.invite.findMany({
    select: { role: true },
  });

  const rawCounts = {};
  const normalizedCounts = {};
  const legacyCounts = {};
  const unknownCounts = {};

  for (const membership of memberships) {
    const raw = String(membership.role ?? '').trim().toLowerCase() || '(blank)';
    inc(rawCounts, raw);
    inc(normalizedCounts, normalizeRole(raw));
    if (LEGACY.has(raw)) inc(legacyCounts, raw);
    if (!CANONICAL.has(raw) && !LEGACY.has(raw)) inc(unknownCounts, raw);
  }

  const inviteRawCounts = {};
  const inviteLegacyCounts = {};
  for (const invite of invites) {
    const raw = String(invite.role ?? '').trim().toLowerCase() || '(blank)';
    inc(inviteRawCounts, raw);
    if (LEGACY.has(raw)) inc(inviteLegacyCounts, raw);
  }

  const programSummaries = new Map();
  for (const membership of memberships) {
    const role = normalizeRole(membership.role);
    const summary = programSummaries.get(membership.programId) ?? {
      total: 0,
      programAdmins: 0,
      programDirectors: 0,
      chiefResidents: 0,
      viewers: 0,
    };
    summary.total += 1;
    if (role === ROLES.PROGRAM_ADMIN) summary.programAdmins += 1;
    if (role === ROLES.PROGRAM_DIRECTOR) summary.programDirectors += 1;
    if (role === ROLES.CHIEF_RESIDENT) summary.chiefResidents += 1;
    if (role === ROLES.VIEWER) summary.viewers += 1;
    programSummaries.set(membership.programId, summary);
  }

  const programsWithoutAdmin = [...programSummaries.values()].filter(p => p.programAdmins === 0).length;
  const programsWithMultipleAdmins = [...programSummaries.values()].filter(p => p.programAdmins > 1).length;

  console.log('[roles:audit] ProgramMember totals');
  console.log(JSON.stringify({
    totalMemberships: memberships.length,
    rawCounts,
    normalizedCounts,
    legacyCounts,
    unknownCounts,
    programsWithoutAdmin,
    programsWithMultipleAdmins,
  }, null, 2));

  console.log('[roles:audit] Invite role totals');
  console.log(JSON.stringify({
    totalInvites: invites.length,
    rawCounts: inviteRawCounts,
    legacyCounts: inviteLegacyCounts,
  }, null, 2));

  if (Object.keys(legacyCounts).length > 0 || Object.keys(inviteLegacyCounts).length > 0) {
    console.log('[roles:audit] Manual review: legacy role strings remain and should be normalized by migration/helper paths.');
  }
  if (Object.keys(unknownCounts).length > 0) {
    console.log('[roles:audit] Manual review: unknown membership roles normalize to viewer.');
  }
  if (programsWithMultipleAdmins > 0) {
    console.log('[roles:audit] Note: multiple program_admin memberships can be valid; review only if unexpected.');
  }
  console.log('[roles:audit] No user names, emails, or password data were read or printed.');
}

main()
  .catch(err => {
    console.error('[roles:audit] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
