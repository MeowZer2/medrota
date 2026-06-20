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

const LEGACY_ROLE_MAP = Object.freeze({
  coordinator: PROGRAM_ROLES.PROGRAM_DIRECTOR,
  admin: PROGRAM_ROLES.PROGRAM_ADMIN,
  builder: PROGRAM_ROLES.CHIEF_RESIDENT,
  editor: PROGRAM_ROLES.CHIEF_RESIDENT,
  viewer: PROGRAM_ROLES.VIEWER,
});

const ROLE_PERMISSIONS = Object.freeze({
  [PROGRAM_ROLES.CHIEF_RESIDENT]: new Set([
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
  [PROGRAM_ROLES.PROGRAM_ADMIN]: new Set([
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
    'delete_program',
  ]),
  [PROGRAM_ROLES.PROGRAM_DIRECTOR]: new Set([
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
  [PROGRAM_ROLES.VIEWER]: new Set(['view_published_schedule', 'export_published_schedule']),
});

export const ROLE_OPTIONS = Object.freeze([
  { value: PROGRAM_ROLES.CHIEF_RESIDENT, label: ROLE_LABELS[PROGRAM_ROLES.CHIEF_RESIDENT] },
  { value: PROGRAM_ROLES.PROGRAM_ADMIN, label: ROLE_LABELS[PROGRAM_ROLES.PROGRAM_ADMIN] },
  { value: PROGRAM_ROLES.PROGRAM_DIRECTOR, label: ROLE_LABELS[PROGRAM_ROLES.PROGRAM_DIRECTOR] },
  { value: PROGRAM_ROLES.VIEWER, label: ROLE_LABELS[PROGRAM_ROLES.VIEWER] },
]);

export function normalizeRole(role) {
  if (!role || typeof role !== 'string') return PROGRAM_ROLES.VIEWER;
  const raw = role.trim().toLowerCase();
  if (ROLE_PERMISSIONS[raw]) return raw;
  return LEGACY_ROLE_MAP[raw] ?? PROGRAM_ROLES.VIEWER;
}

export function roleLabel(role) {
  return ROLE_LABELS[normalizeRole(role)] ?? 'Viewer';
}

export function hasPermission(role, permission) {
  return Boolean(ROLE_PERMISSIONS[normalizeRole(role)]?.has(permission));
}
