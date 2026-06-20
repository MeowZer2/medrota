const assert = require('assert');
const { ROLES, normalizeRole, hasPermission } = require('../lib/roles');

assert.strictEqual(normalizeRole('admin'), ROLES.PROGRAM_ADMIN);
assert.strictEqual(normalizeRole('coordinator'), ROLES.PROGRAM_ADMIN);
assert.strictEqual(normalizeRole('builder'), ROLES.CHIEF_RESIDENT);
assert.strictEqual(normalizeRole('editor'), ROLES.CHIEF_RESIDENT);
assert.strictEqual(normalizeRole('unknown'), ROLES.VIEWER);

assert.strictEqual(hasPermission(ROLES.CHIEF_RESIDENT, 'generate_schedule'), true);
assert.strictEqual(hasPermission(ROLES.CHIEF_RESIDENT, 'manage_users'), false);
assert.strictEqual(hasPermission(ROLES.PROGRAM_ADMIN, 'delete_program'), true);
assert.strictEqual(hasPermission(ROLES.PROGRAM_DIRECTOR, 'delete_program'), false);
assert.strictEqual(hasPermission(ROLES.VIEWER, 'view_published_schedule'), true);
assert.strictEqual(hasPermission(ROLES.VIEWER, 'view_draft_schedule'), false);
assert.strictEqual(hasPermission(ROLES.VIEWER, 'manual_assign_calls'), false);

console.log('[role-permission-smoke] role mapping and permission checks passed');
