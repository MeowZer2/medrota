const prisma = require('./prisma');

const ROLES = Object.freeze({
  CHIEF_RESIDENT: 'chief_resident',
  PROGRAM_ADMIN: 'program_admin',
  PROGRAM_DIRECTOR: 'program_director',
  VIEWER: 'viewer',
});

const ROLE_LABELS = Object.freeze({
  [ROLES.CHIEF_RESIDENT]: 'Chief Resident',
  [ROLES.PROGRAM_ADMIN]: 'Program Admin',
  [ROLES.PROGRAM_DIRECTOR]: 'Program Director',
  [ROLES.VIEWER]: 'Viewer',
});

const LEGACY_ROLE_MAP = Object.freeze({
  coordinator: ROLES.PROGRAM_DIRECTOR,
  admin: ROLES.PROGRAM_ADMIN,
  builder: ROLES.CHIEF_RESIDENT,
  editor: ROLES.CHIEF_RESIDENT,
  viewer: ROLES.VIEWER,
});

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.CHIEF_RESIDENT]: new Set([
    'view_draft_schedule',
    'edit_residents',
    'edit_attendings',
    'manual_assign_calls',
    'generate_schedule',
    'clear_schedule',
    'publish_schedule',
    'export_draft_schedule',
    'edit_block_settings',
  ]),
  [ROLES.PROGRAM_ADMIN]: new Set([
    'view_draft_schedule',
    'edit_residents',
    'edit_attendings',
    'manual_assign_calls',
    'generate_schedule',
    'clear_schedule',
    'publish_schedule',
    'export_draft_schedule',
    'edit_block_settings',
    'edit_program_settings',
    'manage_users',
    'create_academic_year',
  ]),
  [ROLES.PROGRAM_DIRECTOR]: new Set([
    'view_draft_schedule',
    'edit_residents',
    'edit_attendings',
    'manual_assign_calls',
    'generate_schedule',
    'clear_schedule',
    'publish_schedule',
    'export_draft_schedule',
    'edit_block_settings',
    'edit_program_settings',
    'manage_users',
    'create_academic_year',
  ]),
  [ROLES.VIEWER]: new Set(['view_published_schedule', 'export_published_schedule']),
});

function normalizeRole(role) {
  if (!role || typeof role !== 'string') return ROLES.VIEWER;
  const raw = role.trim().toLowerCase();
  if (ROLE_PERMISSIONS[raw]) return raw;
  return LEGACY_ROLE_MAP[raw] ?? ROLES.VIEWER;
}

function isValidRole(role) {
  return Boolean(ROLE_PERMISSIONS[role]);
}

function hasPermission(role, permission) {
  return Boolean(ROLE_PERMISSIONS[normalizeRole(role)]?.has(permission));
}

async function getMembership(userId, programId) {
  if (!userId || !programId) return null;
  const membership = await prisma.programMember.findUnique({
    where: { programId_userId: { programId, userId } },
  });
  if (!membership) return null;
  const normalizedRole = normalizeRole(membership.role);
  if (normalizedRole !== membership.role) {
    await prisma.programMember.update({ where: { id: membership.id }, data: { role: normalizedRole } });
  }
  return { ...membership, role: normalizedRole };
}

async function getProgramIdForBlock(blockId) {
  if (!blockId) return null;
  const block = await prisma.block.findUnique({
    where: { id: blockId },
    select: { isPublished: true, academicYear: { select: { programId: true } } },
  });
  if (!block) return null;
  return { programId: block.academicYear?.programId ?? null, isPublished: block.isPublished };
}

async function assertResidentBelongsToBlockProgram(res, residentId, blockId) {
  if (!residentId || !blockId) {
    res.status(400).json({ error: 'residentId and blockId are required' });
    return null;
  }

  const [resident, blockAccess] = await Promise.all([
    prisma.residentProfile.findUnique({
      where: { id: residentId },
      select: { id: true, programId: true, residentRole: true, isMedStudent: true, isActive: true },
    }),
    getProgramIdForBlock(blockId),
  ]);

  if (!resident) {
    res.status(404).json({ error: 'Resident not found' });
    return null;
  }
  if (!blockAccess?.programId) {
    res.status(404).json({ error: 'Block not found' });
    return null;
  }
  if (resident.programId !== blockAccess.programId) {
    res.status(400).json({ error: 'Resident and block must belong to the same program' });
    return null;
  }

  return { resident, blockAccess };
}

async function requireProgramPermission(req, res, programId, permission) {
  const membership = await getMembership(req.user?.userId, programId);
  if (!membership) {
    res.status(403).json({ error: 'Not a member of this program' });
    return null;
  }
  if (!hasPermission(membership.role, permission)) {
    res.status(403).json({ error: 'Insufficient program permissions' });
    return null;
  }
  return membership;
}

async function requireBlockPermission(req, res, blockId, permission) {
  const blockAccess = await getProgramIdForBlock(blockId);
  if (!blockAccess?.programId) {
    res.status(404).json({ error: 'Block not found' });
    return null;
  }
  return requireProgramPermission(req, res, blockAccess.programId, permission);
}

async function requireBlockView(req, res, blockId) {
  const blockAccess = await getProgramIdForBlock(blockId);
  if (!blockAccess?.programId) {
    res.status(404).json({ error: 'Block not found' });
    return null;
  }
  const membership = await getMembership(req.user?.userId, blockAccess.programId);
  if (!membership) {
    res.status(403).json({ error: 'Not a member of this program' });
    return null;
  }
  if (hasPermission(membership.role, 'view_draft_schedule')) return membership;
  if (blockAccess.isPublished && hasPermission(membership.role, 'view_published_schedule')) return membership;
  res.status(403).json({ error: 'Schedule is not published for viewer access' });
  return null;
}

module.exports = {
  ROLES,
  ROLE_LABELS,
  normalizeRole,
  isValidRole,
  hasPermission,
  getMembership,
  getProgramIdForBlock,
  assertResidentBelongsToBlockProgram,
  requireProgramPermission,
  requireBlockPermission,
  requireBlockView,
};
