const prisma = require('./prisma');
const { effectiveResidentRole } = require('../services/residentLifecycle');

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

const PERMISSIONS = Object.freeze({
  VIEW_DRAFT_SCHEDULE: 'view_draft_schedule',
  VIEW_PUBLISHED_SCHEDULE: 'view_published_schedule',
  EXPORT_PUBLISHED_SCHEDULE: 'export_published_schedule',
  MANAGE_RESIDENTS: 'manage_residents',
  MANAGE_BLOCK_AVAILABILITY: 'manage_block_availability',
  MANAGE_ATTENDING_ROSTER: 'manage_attending_roster',
  MANAGE_ATTENDING_SCHEDULE: 'manage_attending_schedule',
  MANAGE_BLOCK_SETTINGS: 'manage_block_settings',
  MANAGE_SCHEDULING_RULES: 'manage_scheduling_rules',
  MANUAL_ASSIGN_CALLS: 'manual_assign_calls',
  GENERATE_SCHEDULE: 'generate_schedule',
  CLEAR_GENERATED_SCHEDULE: 'clear_generated_schedule',
  VALIDATE_SCHEDULE: 'validate_schedule',
  PUBLISH_SCHEDULE: 'publish_schedule',
  EXPORT_DRAFT_SCHEDULE: 'export_draft_schedule',
  VIEW_AUDIT_HISTORY: 'view_audit_history',
  MANAGE_CLINICAL_SERVICES: 'manage_clinical_services',
  EDIT_PROGRAM_SETTINGS: 'edit_program_settings',
  MANAGE_USERS: 'manage_users',
  CREATE_ACADEMIC_YEAR: 'create_academic_year',
  CONFIGURE_ROLE_PERMISSIONS: 'configure_role_permissions',
});

const CONFIGURABLE_CHIEF_PERMISSIONS = Object.freeze([
  PERMISSIONS.MANAGE_RESIDENTS,
  PERMISSIONS.MANAGE_BLOCK_AVAILABILITY,
  PERMISSIONS.MANAGE_ATTENDING_ROSTER,
  PERMISSIONS.MANAGE_ATTENDING_SCHEDULE,
  PERMISSIONS.MANAGE_BLOCK_SETTINGS,
  PERMISSIONS.MANAGE_SCHEDULING_RULES,
  PERMISSIONS.MANUAL_ASSIGN_CALLS,
  PERMISSIONS.GENERATE_SCHEDULE,
  PERMISSIONS.CLEAR_GENERATED_SCHEDULE,
  PERMISSIONS.VALIDATE_SCHEDULE,
  PERMISSIONS.PUBLISH_SCHEDULE,
  PERMISSIONS.EXPORT_DRAFT_SCHEDULE,
  PERMISSIONS.VIEW_AUDIT_HISTORY,
  PERMISSIONS.MANAGE_CLINICAL_SERVICES,
]);

const CHIEF_FIXED_PERMISSIONS = Object.freeze([PERMISSIONS.VIEW_DRAFT_SCHEDULE]);
const DEFAULT_CHIEF_PERMISSIONS = Object.freeze([
  ...CHIEF_FIXED_PERMISSIONS,
  ...CONFIGURABLE_CHIEF_PERMISSIONS.filter(permission => permission !== PERMISSIONS.MANAGE_SCHEDULING_RULES),
]);
const VIEWER_PERMISSIONS = Object.freeze([
  PERMISSIONS.VIEW_PUBLISHED_SCHEDULE,
  PERMISSIONS.EXPORT_PUBLISHED_SCHEDULE,
]);
const FULL_PROGRAM_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

const PERMISSION_ALIASES = Object.freeze({
  edit_residents: PERMISSIONS.MANAGE_RESIDENTS,
  edit_attendings: PERMISSIONS.MANAGE_ATTENDING_SCHEDULE,
  edit_block_settings: PERMISSIONS.MANAGE_BLOCK_SETTINGS,
  clear_schedule: PERMISSIONS.CLEAR_GENERATED_SCHEDULE,
});

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.CHIEF_RESIDENT]: new Set(DEFAULT_CHIEF_PERMISSIONS),
  [ROLES.PROGRAM_ADMIN]: new Set(FULL_PROGRAM_PERMISSIONS),
  [ROLES.PROGRAM_DIRECTOR]: new Set(FULL_PROGRAM_PERMISSIONS),
  [ROLES.VIEWER]: new Set(VIEWER_PERMISSIONS),
});

function normalizeRole(role) {
  if (!role || typeof role !== 'string') return ROLES.VIEWER;
  const raw = role.trim().toLowerCase();
  if (ROLE_PERMISSIONS[raw]) return raw;
  return LEGACY_ROLE_MAP[raw] ?? ROLES.VIEWER;
}

function normalizePermission(permission) {
  return PERMISSION_ALIASES[permission] ?? permission;
}

function isValidRole(role) {
  return Boolean(ROLE_PERMISSIONS[role]);
}

function isCanonicalPermission(permission) {
  return FULL_PROGRAM_PERMISSIONS.includes(permission);
}

function hasPermission(role, permission) {
  return Boolean(ROLE_PERMISSIONS[normalizeRole(role)]?.has(normalizePermission(permission)));
}

async function resolvePermissions(programId, role) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === ROLES.PROGRAM_ADMIN || normalizedRole === ROLES.PROGRAM_DIRECTOR) {
    return [...FULL_PROGRAM_PERMISSIONS];
  }
  if (normalizedRole === ROLES.VIEWER) return [...VIEWER_PERMISSIONS];

  const rows = await prisma.programRolePermission.findMany({
    where: { programId, role: ROLES.CHIEF_RESIDENT },
    select: { permission: true, enabled: true },
  });
  if (rows.length === 0) return [...DEFAULT_CHIEF_PERMISSIONS];
  const configured = rows
    .filter(row => row.enabled && CONFIGURABLE_CHIEF_PERMISSIONS.includes(row.permission))
    .map(row => row.permission);
  return [...new Set([...CHIEF_FIXED_PERMISSIONS, ...configured])];
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
  const [resident, blockAccess, block] = await Promise.all([
    prisma.residentProfile.findUnique({
      where: { id: residentId },
      select: { id: true, programId: true, residentRole: true, residentRoleOverride: true, pgyLevel: true, programStartDate: true, isMedStudent: true, isServiceResident: true, isActive: true },
    }),
    getProgramIdForBlock(blockId),
    prisma.block.findUnique({ where: { id: blockId }, include: { academicYear: { include: { program: true } } } }),
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
  resident.residentRole = effectiveResidentRole(resident, block?.academicYear?.program, block?.academicYear?.startDate ?? block?.startDate).role;
  return { resident, blockAccess, block };
}

async function requireProgramPermission(req, res, programId, permission) {
  const membership = await getMembership(req.user?.userId, programId);
  if (!membership) {
    res.status(403).json({ error: 'Not a member of this program' });
    return null;
  }
  const canonicalPermission = normalizePermission(permission);
  if (!isCanonicalPermission(canonicalPermission)) {
    res.status(403).json({ error: 'Unknown program permission' });
    return null;
  }
  const permissions = await resolvePermissions(programId, membership.role);
  if (!permissions.includes(canonicalPermission)) {
    res.status(403).json({ error: 'Insufficient program permissions' });
    return null;
  }
  return { ...membership, permissions };
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
  const permissions = await resolvePermissions(blockAccess.programId, membership.role);
  if (permissions.includes(PERMISSIONS.VIEW_DRAFT_SCHEDULE)) return { ...membership, permissions };
  if (blockAccess.isPublished && permissions.includes(PERMISSIONS.VIEW_PUBLISHED_SCHEDULE)) return { ...membership, permissions };
  res.status(403).json({ error: 'Schedule is not published for viewer access' });
  return null;
}

module.exports = {
  ROLES,
  ROLE_LABELS,
  PERMISSIONS,
  CONFIGURABLE_CHIEF_PERMISSIONS,
  DEFAULT_CHIEF_PERMISSIONS,
  FULL_PROGRAM_PERMISSIONS,
  normalizeRole,
  normalizePermission,
  isValidRole,
  isCanonicalPermission,
  hasPermission,
  resolvePermissions,
  getMembership,
  getProgramIdForBlock,
  assertResidentBelongsToBlockProgram,
  requireProgramPermission,
  requireBlockPermission,
  requireBlockView,
};
