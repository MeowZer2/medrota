// Behavioural coverage for the deactivate/restore lifecycle of the program
// registries: attending roster entries, attending activity types, and clinical
// services.
//
// The rules being pinned down are the ones a user notices:
//   - deactivating removes a record from the active list used by schedulers,
//   - it never destroys the record or the history that references it,
//   - restoring puts it back into circulation,
//   - and only roles holding the matching permission may do either.

const assert = require('assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../index');
const prisma = require('../lib/prisma');
const { CONFIGURABLE_CHIEF_PERMISSIONS } = require('../lib/roles');

const tag = `REG_${Date.now()}`;
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

    // -- attending roster lifecycle -------------------------------------------

    const keptStaff = await request('/attending/roster', admin.token, { method: 'POST', body: JSON.stringify({ programId: program.id, attendingName: 'Dr. Kept', typicalActivities: [] }) });
    const retiringStaff = await request('/attending/roster', admin.token, { method: 'POST', body: JSON.stringify({ programId: program.id, attendingName: 'Dr. Retiring', email: 'retiring@example.invalid', typicalActivities: [] }) });
    assert.equal(keptStaff.status, 201);
    assert.equal(retiringStaff.status, 201);

    // History that must survive a later deactivation.
    const staffEntry = await request('/attending', admin.token, { method: 'POST', body: JSON.stringify({ blockId: block.id, attendingName: 'Dr. Retiring', date: '2035-07-04', activityLabel: '' }) });
    assert.equal(staffEntry.status, 201);

    const deactivateStaff = await request(`/attending/roster/${retiringStaff.body.id}`, admin.token, { method: 'PUT', body: JSON.stringify({ isActive: false }) });
    assert.equal(deactivateStaff.status, 200, 'an Admin can deactivate an attending');
    assert.equal(deactivateStaff.body.isActive, false);

    const activeRoster = await request(`/attending/roster?programId=${program.id}`, admin.token);
    assert.equal(activeRoster.status, 200);
    assert.deepEqual(activeRoster.body.map(item => item.attendingName), ['Dr. Kept'], 'the default roster is the scheduling selector source and excludes inactive staff');

    const fullRoster = await request(`/attending/roster?programId=${program.id}&includeInactive=true`, admin.token);
    assert.equal(fullRoster.body.length, 2, 'inactive staff are still retrievable for review and restore');
    assert.equal(fullRoster.body.find(item => item.attendingName === 'Dr. Retiring').isActive, false);

    const preservedEntry = await request(`/attending?blockId=${block.id}`, admin.token);
    assert(preservedEntry.body.some(entry => entry.attendingName === 'Dr. Retiring'), 'deactivating an attending preserves their historical schedule entries');

    const restoreStaff = await request(`/attending/roster/${retiringStaff.body.id}`, admin.token, { method: 'PUT', body: JSON.stringify({ isActive: true }) });
    assert.equal(restoreStaff.status, 200, 'an Admin can restore an attending');
    assert.equal(restoreStaff.body.isActive, true);
    const restoredRoster = await request(`/attending/roster?programId=${program.id}`, admin.token);
    assert.equal(restoredRoster.body.length, 2, 'a restored attending is selectable again');

    // DELETE is a soft delete; the record and its history stay put.
    const softDelete = await request(`/attending/roster/${retiringStaff.body.id}`, director.token, { method: 'DELETE' });
    assert.equal(softDelete.status, 200, 'a Program Director can deactivate an attending');
    assert.equal(softDelete.body.entry.isActive, false);
    assert.equal((await request(`/attending/roster?programId=${program.id}`, admin.token)).body.length, 1);
    assert.equal((await request(`/attending/roster?programId=${program.id}&includeInactive=true`, admin.token)).body.length, 2, 'a deactivated attending is never destroyed');
    assert.equal((await request(`/attending/roster/${retiringStaff.body.id}`, admin.token, { method: 'PUT', body: JSON.stringify({ isActive: true }) })).status, 200);

    // -- attending activity lifecycle -----------------------------------------

    const activity = await request(`/program-configuration/${program.id}/attending-activities`, admin.token, { method: 'POST', body: JSON.stringify({ name: 'Vascular Clinic' }) });
    assert.equal(activity.status, 201);

    const template = await request(`/attending-template/${program.id}`, admin.token, { method: 'POST', body: JSON.stringify({ attendingName: 'Dr. Kept', dayOfWeek: 1, activityLabel: 'Vascular Clinic' }) });
    assert.equal(template.status, 200);
    const historicalEntry = await request('/attending', admin.token, { method: 'POST', body: JSON.stringify({ blockId: block.id, attendingName: 'Dr. Kept', date: '2035-07-02', activityLabel: 'Vascular Clinic' }) });
    assert.equal(historicalEntry.status, 201);

    const deactivateActivity = await request(`/program-configuration/${program.id}/attending-activities/${activity.body.id}`, admin.token, { method: 'PUT', body: JSON.stringify({ isActive: false }) });
    assert.equal(deactivateActivity.status, 200, 'an Admin can deactivate an activity type');
    assert.equal(deactivateActivity.body.isActive, false);

    const listedActivities = await request(`/program-configuration/${program.id}/attending-activities`, admin.token);
    const listedActivity = listedActivities.body.find(item => item.id === activity.body.id);
    assert.equal(listedActivity.isActive, false, 'the registry still reports an inactive activity so it can be restored');
    assert.equal(listedActivity._count.attendingEntries, 1, 'reference counts explain why an inactive type is worth keeping');
    assert.equal(listedActivity._count.attendingTemplates, 1);

    assert.equal(
      (await request('/attending', admin.token, { method: 'POST', body: JSON.stringify({ blockId: block.id, attendingName: 'Dr. Kept', date: '2035-07-03', activityLabel: 'Vascular Clinic' }) })).status,
      400,
      'an inactive activity cannot be chosen for a new daily entry',
    );
    assert.equal(
      (await request(`/attending-template/${program.id}`, admin.token, { method: 'POST', body: JSON.stringify({ attendingName: 'Dr. Kept', dayOfWeek: 2, activityLabel: 'Vascular Clinic' }) })).status,
      400,
      'an inactive activity cannot be chosen for a new weekly pattern day',
    );

    const readableHistory = await request(`/attending?blockId=${block.id}`, admin.token);
    assert.equal(
      readableHistory.body.find(entry => entry.id === historicalEntry.body.id).activityLabel,
      'Vascular Clinic',
      'an existing entry referencing an inactive activity still reads back with its label',
    );
    const readableTemplate = await request(`/attending-template?programId=${program.id}`, admin.token);
    assert.equal(
      readableTemplate.body.find(row => row.attendingName === 'Dr. Kept').days.find(day => day.dayOfWeek === 1).activityLabel,
      'Vascular Clinic',
      'an existing weekly pattern day referencing an inactive activity still reads back with its label',
    );
    // Editing an entry that already points at the inactive type stays allowed,
    // otherwise historical rows would become uneditable.
    assert.equal(
      (await request(`/attending/${historicalEntry.body.id}`, admin.token, { method: 'PUT', body: JSON.stringify({ activityLabel: 'Vascular Clinic', notes: 'unchanged type' }) })).status,
      200,
      'an entry already on an inactive type can still be edited',
    );

    const restoreActivity = await request(`/program-configuration/${program.id}/attending-activities/${activity.body.id}`, director.token, { method: 'PUT', body: JSON.stringify({ isActive: true }) });
    assert.equal(restoreActivity.status, 200, 'a Program Director can restore an activity type');
    assert.equal(restoreActivity.body.isActive, true);
    assert.equal(
      (await request('/attending', admin.token, { method: 'POST', body: JSON.stringify({ blockId: block.id, attendingName: 'Dr. Kept', date: '2035-07-03', activityLabel: 'Vascular Clinic' }) })).status,
      201,
      'a restored activity is selectable for new entries again',
    );
    assert.equal(
      (await request(`/attending-template/${program.id}`, admin.token, { method: 'POST', body: JSON.stringify({ attendingName: 'Dr. Kept', dayOfWeek: 2, activityLabel: 'Vascular Clinic' }) })).status,
      200,
      'a restored activity is selectable for new weekly pattern days again',
    );

    // -- clinical service lifecycle -------------------------------------------

    const service = await request(`/program-configuration/${program.id}/clinical-services`, admin.token, { method: 'POST', body: JSON.stringify({ name: 'Limb Preservation' }) });
    assert.equal(service.status, 201);
    assert.equal((await request(`/program-configuration/${program.id}/clinical-services/${service.body.id}`, admin.token, { method: 'PUT', body: JSON.stringify({ isActive: false }) })).body.isActive, false);
    const servicesAfter = await request(`/program-configuration/${program.id}/clinical-services`, admin.token);
    assert.equal(servicesAfter.body.find(item => item.id === service.body.id).isActive, false, 'an inactive service is still listed so it can be restored');
    assert.equal((await request(`/program-configuration/${program.id}/clinical-services/${service.body.id}`, admin.token, { method: 'PUT', body: JSON.stringify({ isActive: true }) })).body.isActive, true);

    // -- authorization on deactivate and restore ------------------------------

    for (const [label, path] of [
      ['attending roster', `/attending/roster/${retiringStaff.body.id}`],
      ['attending activity', `/program-configuration/${program.id}/attending-activities/${activity.body.id}`],
      ['clinical service', `/program-configuration/${program.id}/clinical-services/${service.body.id}`],
    ]) {
      for (const state of [false, true]) {
        assert.equal(
          (await request(path, viewer.token, { method: 'PUT', body: JSON.stringify({ isActive: state }) })).status,
          403,
          `a Viewer cannot set isActive=${state} on a ${label}`,
        );
        assert.equal(
          (await request(path, outsider.token, { method: 'PUT', body: JSON.stringify({ isActive: state }) })).status,
          403,
          `a member of another program cannot set isActive=${state} on a ${label}`,
        );
      }
    }
    assert.equal((await request(`/attending/roster/${retiringStaff.body.id}`, viewer.token, { method: 'DELETE' })).status, 403, 'a Viewer cannot soft-delete an attending');

    // A Chief Resident follows the configured program permissions, in both
    // directions, for the registry that each permission actually governs.
    const withoutRegistryPermissions = CONFIGURABLE_CHIEF_PERMISSIONS.filter(permission => permission !== 'manage_attending_roster' && permission !== 'manage_clinical_services');
    assert.equal((await request(`/program-configuration/${program.id}/role-permissions`, admin.token, { method: 'PUT', body: JSON.stringify({ role: 'chief_resident', permissions: withoutRegistryPermissions }) })).status, 200);
    assert.equal((await request(`/attending/roster/${retiringStaff.body.id}`, chief.token, { method: 'PUT', body: JSON.stringify({ isActive: false }) })).status, 403, 'a Chief without manage_attending_roster cannot deactivate an attending');
    assert.equal((await request(`/program-configuration/${program.id}/attending-activities/${activity.body.id}`, chief.token, { method: 'PUT', body: JSON.stringify({ isActive: false }) })).status, 403, 'a Chief without manage_attending_roster cannot deactivate an activity');
    assert.equal((await request(`/program-configuration/${program.id}/clinical-services/${service.body.id}`, chief.token, { method: 'PUT', body: JSON.stringify({ isActive: false }) })).status, 403, 'a Chief without manage_clinical_services cannot deactivate a service');

    assert.equal((await request(`/program-configuration/${program.id}/role-permissions`, admin.token, { method: 'PUT', body: JSON.stringify({ role: 'chief_resident', permissions: CONFIGURABLE_CHIEF_PERMISSIONS }) })).status, 200);
    assert.equal((await request(`/attending/roster/${retiringStaff.body.id}`, chief.token, { method: 'PUT', body: JSON.stringify({ isActive: false }) })).status, 200, 'a Chief granted manage_attending_roster can deactivate an attending');
    assert.equal((await request(`/attending/roster/${retiringStaff.body.id}`, chief.token, { method: 'PUT', body: JSON.stringify({ isActive: true }) })).status, 200, 'a Chief granted manage_attending_roster can restore an attending');
    assert.equal((await request(`/program-configuration/${program.id}/attending-activities/${activity.body.id}`, chief.token, { method: 'PUT', body: JSON.stringify({ isActive: false }) })).status, 200);
    assert.equal((await request(`/program-configuration/${program.id}/attending-activities/${activity.body.id}`, chief.token, { method: 'PUT', body: JSON.stringify({ isActive: true }) })).status, 200, 'a Chief granted manage_attending_roster can restore an activity');
    assert.equal((await request(`/program-configuration/${program.id}/clinical-services/${service.body.id}`, chief.token, { method: 'PUT', body: JSON.stringify({ isActive: false }) })).status, 200);
    assert.equal((await request(`/program-configuration/${program.id}/clinical-services/${service.body.id}`, chief.token, { method: 'PUT', body: JSON.stringify({ isActive: true }) })).status, 200, 'a Chief granted manage_clinical_services can restore a service');

    console.log('[registry-lifecycle-smoke] roster, activity, and service deactivate/restore lifecycles and their authorization passed');
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
  console.error('[registry-lifecycle-smoke] failed:', error);
  process.exitCode = 1;
});
