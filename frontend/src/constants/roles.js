export const PROGRAM_ROLES = Object.freeze({
  CHIEF_RESIDENT: 'chief_resident',
  PROGRAM_ADMIN: 'program_admin',
  PROGRAM_DIRECTOR: 'program_director',
  VIEWER: 'viewer',
});

export const ROLE_LABELS = Object.freeze({
  [PROGRAM_ROLES.CHIEF_RESIDENT]: 'Chief Resident',
  [PROGRAM_ROLES.PROGRAM_ADMIN]: 'Program Admin',
  [PROGRAM_ROLES.PROGRAM_DIRECTOR]: 'Program Director',
  [PROGRAM_ROLES.VIEWER]: 'Viewer',
});

export const PERMISSIONS = Object.freeze({
  VIEW_DRAFT_SCHEDULE: 'view_draft_schedule',
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

const LEGACY_ROLE_MAP = Object.freeze({
  coordinator: PROGRAM_ROLES.PROGRAM_DIRECTOR,
  admin: PROGRAM_ROLES.PROGRAM_ADMIN,
  builder: PROGRAM_ROLES.CHIEF_RESIDENT,
  editor: PROGRAM_ROLES.CHIEF_RESIDENT,
  viewer: PROGRAM_ROLES.VIEWER,
});

const PERMISSION_ALIASES = Object.freeze({
  edit_residents: PERMISSIONS.MANAGE_RESIDENTS,
  edit_attendings: PERMISSIONS.MANAGE_ATTENDING_SCHEDULE,
  edit_block_settings: PERMISSIONS.MANAGE_BLOCK_SETTINGS,
  clear_schedule: PERMISSIONS.CLEAR_GENERATED_SCHEDULE,
});

const FULL_ACCESS_ROLES = new Set([PROGRAM_ROLES.PROGRAM_ADMIN, PROGRAM_ROLES.PROGRAM_DIRECTOR]);
const VIEWER_PERMISSIONS = new Set(['view_published_schedule', 'export_published_schedule']);

export const ROLE_OPTIONS = Object.freeze([
  { value: PROGRAM_ROLES.CHIEF_RESIDENT, label: ROLE_LABELS[PROGRAM_ROLES.CHIEF_RESIDENT] },
  { value: PROGRAM_ROLES.PROGRAM_ADMIN, label: ROLE_LABELS[PROGRAM_ROLES.PROGRAM_ADMIN] },
  { value: PROGRAM_ROLES.PROGRAM_DIRECTOR, label: ROLE_LABELS[PROGRAM_ROLES.PROGRAM_DIRECTOR] },
  { value: PROGRAM_ROLES.VIEWER, label: ROLE_LABELS[PROGRAM_ROLES.VIEWER] },
]);

export function normalizeRole(role) {
  if (!role || typeof role !== 'string') return PROGRAM_ROLES.VIEWER;
  const raw = role.trim().toLowerCase();
  if (Object.values(PROGRAM_ROLES).includes(raw)) return raw;
  return LEGACY_ROLE_MAP[raw] ?? PROGRAM_ROLES.VIEWER;
}

export function roleLabel(role) {
  return ROLE_LABELS[normalizeRole(role)] ?? 'Viewer';
}

export function hasPermission(role, permission, resolvedPermissions) {
  const normalizedRole = normalizeRole(role);
  const canonical = PERMISSION_ALIASES[permission] ?? permission;
  if (Array.isArray(resolvedPermissions)) return resolvedPermissions.includes(canonical);
  if (FULL_ACCESS_ROLES.has(normalizedRole)) return Object.values(PERMISSIONS).includes(canonical);
  if (normalizedRole === PROGRAM_ROLES.VIEWER) return VIEWER_PERMISSIONS.has(canonical);
  return false;
}
