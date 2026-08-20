const assert = require('assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../index');
const prisma = require('../lib/prisma');
const { CONFIGURABLE_CHIEF_PERMISSIONS, resolvePermissions } = require('../lib/roles');

const tag = `CFG_${Date.now()}`;
const created = { orgIds: [], programIds: [], userIds: [] };

function token(user) {
  return jwt.sign({ userId: user.id, email: user.email, name: user.name }, process.env.JWT_SECRET, { expiresIn: '10m' });
}

async function main() {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, authToken, options = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(authToken ? { authorization: `Bearer ${authToken}` } : {}), ...(options.headers ?? {}) },
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  try {
    const org = await prisma.organization.create({ data: { name: `${tag} Org`, country: 'CA' } });
    created.orgIds.push(org.id);
    const otherOrg = await prisma.organization.create({ data: { name: `${tag} Other`, country: 'CA' } });
    created.orgIds.push(otherOrg.id);
    const program = await prisma.program.create({ data: { name: `${tag} Program`, specialty: 'General Surgery', orgId: org.id } });
    const otherProgram = await prisma.program.create({ data: { name: `${tag} Other Program`, specialty: 'General Surgery', orgId: otherOrg.id } });
    created.programIds.push(program.id, otherProgram.id);
    const academicYear = await prisma.academicYear.create({ data: { programId: program.id, startDate: new Date('2035-07-01'), endDate: new Date('2036-06-30') } });
    const block = await prisma.block.create({ data: { academicYearId: academicYear.id, number: 1, startDate: new Date('2035-07-01'), endDate: new Date('2035-07-28') } });

    async function user(label, role, targetProgram = program) {
      const row = await prisma.user.create({ data: { name: `${tag} ${label}`, email: `${tag.toLowerCase()}-${label.toLowerCase()}@example.invalid`, passwordHash: 'not-used', orgId: targetProgram.orgId } });
      created.userIds.push(row.id);
      await prisma.programMember.create({ data: { programId: targetProgram.id, userId: row.id, role } });
      return { row, token: token(row) };
    }

    const admin = await user('Admin', 'program_admin');
    const director = await user('Director', 'program_director');
    const chief = await user('Chief', 'chief_resident');
    const viewer = await user('Viewer', 'viewer');
    const outsider = await user('Outsider', 'program_admin', otherProgram);

    const legacyDefaults = await resolvePermissions(program.id, 'chief_resident');
    assert(legacyDefaults.includes('manage_residents'), 'legacy programs keep current Chief Resident management access');
    assert(!legacyDefaults.includes('manage_scheduling_rules'), 'future rules management begins disabled for legacy programs');

    const adminService = await request(`/program-configuration/${program.id}/clinical-services`, admin.token, { method: 'POST', body: JSON.stringify({ name: 'Acute Care Surgery' }) });
    assert.equal(adminService.status, 201);
    const directorService = await request(`/program-configuration/${program.id}/clinical-services`, director.token, { method: 'POST', body: JSON.stringify({ name: 'Colorectal' }) });
    assert.equal(directorService.status, 201, 'Program Director retains full service management');
    const duplicate = await request(`/program-configuration/${program.id}/clinical-services`, admin.token, { method: 'POST', body: JSON.stringify({ name: '  acute   care surgery ' }) });
    assert.equal(duplicate.status, 409, 'normalized duplicate service names are rejected');
    assert.equal((await request(`/program-configuration/${program.id}/clinical-services`, viewer.token, { method: 'POST', body: JSON.stringify({ name: 'Viewer Service' }) })).status, 403);

    const configured = CONFIGURABLE_CHIEF_PERMISSIONS.filter(permission => legacyDefaults.includes(permission) && permission !== 'manage_clinical_services' && permission !== 'manage_residents');
    const disable = await request(`/program-configuration/${program.id}/role-permissions`, admin.token, { method: 'PUT', body: JSON.stringify({ role: 'chief_resident', permissions: configured }) });
    assert.equal(disable.status, 200);
    assert.equal((await request(`/program-configuration/${program.id}/clinical-services`, chief.token, { method: 'POST', body: JSON.stringify({ name: 'Chief denied' }) })).status, 403);
    const enable = await request(`/program-configuration/${program.id}/role-permissions`, director.token, { method: 'PUT', body: JSON.stringify({ role: 'chief_resident', permissions: [...configured, 'manage_clinical_services'] }) });
    assert.equal(enable.status, 200, 'Program Director always retains permission configuration access');
    assert.equal((await request(`/program-configuration/${program.id}/clinical-services`, chief.token, { method: 'POST', body: JSON.stringify({ name: 'Chief managed' }) })).status, 201);
    assert.equal((await request(`/program-configuration/${program.id}/role-permissions`, viewer.token, { method: 'PUT', body: JSON.stringify({ role: 'viewer', permissions: ['manage_residents'] }) })).status, 403, 'Viewer cannot use a permission payload to gain write access');
    assert.equal((await request(`/program-configuration/${program.id}/role-permissions`, outsider.token, { method: 'PUT', body: JSON.stringify({ role: 'chief_resident', permissions: [] }) })).status, 403, 'cross-program permission configuration is rejected');

    const activity = await request(`/program-configuration/${program.id}/attending-activities`, admin.token, { method: 'POST', body: JSON.stringify({ name: 'Endoscopy' }) });
    assert.equal(activity.status, 201);
    const renamed = await request(`/program-configuration/${program.id}/attending-activities/${activity.body.id}`, admin.token, { method: 'PUT', body: JSON.stringify({ name: 'Advanced Endoscopy' }) });
    assert.equal(renamed.status, 200);
    const roster = await request('/attending/roster', admin.token, { method: 'POST', body: JSON.stringify({ programId: program.id, attendingName: 'Dr. Registry', email: 'registry@example.invalid', phone: '555-0100', officeLocation: 'Clinic 4', typicalActivities: [] }) });
    assert.equal(roster.status, 201);
    const template = await request(`/attending-template/${program.id}`, admin.token, { method: 'POST', body: JSON.stringify({ attendingName: 'Dr. Registry', dayOfWeek: 0, activityLabel: 'Advanced Endoscopy' }) });
    assert.equal(template.status, 200);
    assert.equal(template.body.activityTypeId, activity.body.id, 'weekly pattern links to the custom activity type');
    const entry = await request('/attending', admin.token, { method: 'POST', body: JSON.stringify({ blockId: block.id, attendingName: 'Dr. Registry', date: '2035-07-02', activityLabel: 'Advanced Endoscopy' }) });
    assert.equal(entry.status, 201);
    const deactivated = await request(`/program-configuration/${program.id}/attending-activities/${activity.body.id}`, admin.token, { method: 'PUT', body: JSON.stringify({ isActive: false }) });
    assert.equal(deactivated.status, 200);
    const [storedTemplate, storedEntry] = await Promise.all([
      prisma.attendingScheduleTemplate.findUnique({ where: { id: template.body.id } }),
      prisma.attendingEntry.findUnique({ where: { id: entry.body.id } }),
    ]);
    assert.equal(storedTemplate.activityLabel, 'Advanced Endoscopy');
    assert.equal(storedEntry.activityLabel, 'Advanced Endoscopy', 'activity deactivation preserves existing attending entries');
    assert.equal((await request('/attending', admin.token, { method: 'POST', body: JSON.stringify({ blockId: block.id, attendingName: 'Dr. Other', date: '2035-07-03', activityLabel: 'Advanced Endoscopy' }) })).status, 400, 'inactive activities cannot be selected for new entries');

    console.log('[program-configuration-smoke] registries, history preservation, and flexible authorization passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (created.programIds.length) {
      await prisma.attendingEntry.deleteMany({ where: { block: { academicYear: { programId: { in: created.programIds } } } } });
      await prisma.callDay.deleteMany({ where: { block: { academicYear: { programId: { in: created.programIds } } } } });
      await prisma.block.deleteMany({ where: { academicYear: { programId: { in: created.programIds } } } });
      await prisma.academicYear.deleteMany({ where: { programId: { in: created.programIds } } });
      await prisma.attendingScheduleTemplate.deleteMany({ where: { programId: { in: created.programIds } } });
      await prisma.attendingRoster.deleteMany({ where: { programId: { in: created.programIds } } });
      await prisma.attendingActivityType.deleteMany({ where: { programId: { in: created.programIds } } });
      await prisma.programService.deleteMany({ where: { programId: { in: created.programIds } } });
      await prisma.programRolePermission.deleteMany({ where: { programId: { in: created.programIds } } });
      await prisma.programMember.deleteMany({ where: { programId: { in: created.programIds } } });
      await prisma.program.deleteMany({ where: { id: { in: created.programIds } } });
    }
    if (created.userIds.length) await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    if (created.orgIds.length) await prisma.organization.deleteMany({ where: { id: { in: created.orgIds } } });
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('[program-configuration-smoke] failed:', error);
  process.exitCode = 1;
});
