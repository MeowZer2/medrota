// Behavioural coverage for section-scoped saving in Program Settings.
//
// Program Settings shows a Save inside General and another inside Scheduling.
// Both edit one Program row, so the rule the UI promises has to be true of the
// API as well: a payload persists the fields it carries and leaves every other
// stored field alone. Otherwise the Scheduling Save would quietly write back
// whatever the General fields happened to hold - including edits the user never
// saved, or values another session changed in the meantime.
//
// The same rule is checked for the registry rows that now edit in place, plus
// the rename validation that stops a blank name reaching the database.

const assert = require('assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../index');
const prisma = require('../lib/prisma');
const { CONFIGURABLE_CHIEF_PERMISSIONS } = require('../lib/roles');

const tag = `SAVE_${Date.now()}`;
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
    const program = await prisma.program.create({
      data: {
        name: `${tag} Program`,
        specialty: 'General Surgery',
        orgId: org.id,
        juniorInHouseCall: true,
        seniorInHouseCall: false,
      },
    });
    created.programIds.push(program.id);
    const adminRow = await prisma.user.create({ data: { name: `${tag} Admin`, email: `${tag.toLowerCase()}-admin@example.invalid`, passwordHash: 'not-used', orgId: org.id } });
    const viewerRow = await prisma.user.create({ data: { name: `${tag} Viewer`, email: `${tag.toLowerCase()}-viewer@example.invalid`, passwordHash: 'not-used', orgId: org.id } });
    const chiefRow = await prisma.user.create({ data: { name: `${tag} Chief`, email: `${tag.toLowerCase()}-chief@example.invalid`, passwordHash: 'not-used', orgId: org.id } });
    created.userIds.push(adminRow.id, viewerRow.id, chiefRow.id);
    await prisma.programMember.create({ data: { programId: program.id, userId: adminRow.id, role: 'program_admin' } });
    await prisma.programMember.create({ data: { programId: program.id, userId: viewerRow.id, role: 'viewer' } });
    await prisma.programMember.create({ data: { programId: program.id, userId: chiefRow.id, role: 'chief_resident' } });
    const admin = token(adminRow);
    const viewer = token(viewerRow);
    const chief = token(chiefRow);

    const stored = () => prisma.program.findUnique({
      where: { id: program.id },
      select: { name: true, specialty: true, juniorInHouseCall: true, seniorInHouseCall: true },
    });

    // -- General saves General ------------------------------------------------

    const generalOnly = await request(`/programs/${program.id}`, admin, {
      method: 'PUT',
      body: JSON.stringify({ name: `${tag} Renamed`, specialty: 'Vascular Surgery' }),
    });
    assert.equal(generalOnly.status, 200, 'a General payload is accepted on its own');

    let after = await stored();
    assert.equal(after.name, `${tag} Renamed`, 'General saves the program name');
    assert.equal(after.specialty, 'Vascular Surgery', 'General saves the specialty');
    assert.equal(after.juniorInHouseCall, true, 'General leaves junior call as stored');
    assert.equal(after.seniorInHouseCall, false, 'General leaves senior call as stored');

    // -- Scheduling saves Scheduling ------------------------------------------

    const schedulingOnly = await request(`/programs/${program.id}`, admin, {
      method: 'PUT',
      body: JSON.stringify({ juniorInHouseCall: false, seniorInHouseCall: true }),
    });
    assert.equal(schedulingOnly.status, 200, 'a Scheduling payload is accepted on its own');

    after = await stored();
    assert.equal(after.juniorInHouseCall, false, 'Scheduling saves junior call');
    assert.equal(after.seniorInHouseCall, true, 'Scheduling saves senior call');
    assert.equal(after.name, `${tag} Renamed`, 'Scheduling leaves the program name as stored');
    assert.equal(after.specialty, 'Vascular Surgery', 'Scheduling leaves the specialty as stored');

    // -- One section cannot publish another section's unsaved values ----------
    //
    // The case that motivated this: a user edits the name in General without
    // saving, moves to Scheduling, and saves there. The Scheduling payload
    // carries no identity fields, so the abandoned name never reaches the row.

    const abandonedName = `${tag} Never Saved`;
    const schedulingAfterAbandonedEdit = await request(`/programs/${program.id}`, admin, {
      method: 'PUT',
      body: JSON.stringify({ juniorInHouseCall: true, seniorInHouseCall: false }),
    });
    assert.equal(schedulingAfterAbandonedEdit.status, 200);
    after = await stored();
    assert.notEqual(after.name, abandonedName, 'an unsaved General edit is not written by a Scheduling save');
    assert.equal(after.name, `${tag} Renamed`, 'the stored name is the last one General actually saved');

    // -- Only real call-type changes are audited ------------------------------

    const auditCountBefore = await prisma.auditEvent.count({ where: { programId: program.id, action: 'PROGRAM_CALL_TYPES_CHANGED' } });
    assert.ok(auditCountBefore > 0, 'saving call types records an audit event');
    assert.equal((await request(`/programs/${program.id}`, admin, { method: 'PUT', body: JSON.stringify({ name: `${tag} Renamed Again` }) })).status, 200);
    const auditCountAfter = await prisma.auditEvent.count({ where: { programId: program.id, action: 'PROGRAM_CALL_TYPES_CHANGED' } });
    assert.equal(auditCountAfter, auditCountBefore, 'an identity-only save records no call-type audit event');

    // -- A rejected payload changes nothing -----------------------------------

    const before = await stored();
    const rejected = await request(`/programs/${program.id}`, admin, {
      method: 'PUT',
      body: JSON.stringify({ name: `${tag} Should Not Persist`, specialty: 'Not A Real Specialty' }),
    });
    assert.equal(rejected.status, 400, 'an invalid specialty is refused');
    assert.deepEqual(await stored(), before, 'a refused save leaves every field as it was');

    const rejectedFlag = await request(`/programs/${program.id}`, admin, {
      method: 'PUT',
      body: JSON.stringify({ juniorInHouseCall: 'yes' }),
    });
    assert.equal(rejectedFlag.status, 400, 'a non-boolean call-type flag is refused');
    assert.deepEqual(await stored(), before, 'a refused call-type save leaves every field as it was');

    // -- Registry rows save the field they edit -------------------------------

    const activity = await request(`/program-configuration/${program.id}/attending-activities`, admin, { method: 'POST', body: JSON.stringify({ name: 'Endoscopy' }) });
    assert.equal(activity.status, 201);
    assert.equal((await request(`/program-configuration/${program.id}/attending-activities/${activity.body.id}`, admin, { method: 'PUT', body: JSON.stringify({ isActive: false }) })).status, 200);
    const renamedActivity = await request(`/program-configuration/${program.id}/attending-activities/${activity.body.id}`, admin, { method: 'PUT', body: JSON.stringify({ name: 'Endoscopy Suite' }) });
    assert.equal(renamedActivity.status, 200);
    assert.equal(renamedActivity.body.name, 'Endoscopy Suite', 'a rename saves the new name');
    assert.equal(renamedActivity.body.isActive, false, 'a rename does not quietly reactivate a deactivated record');

    const blankActivity = await request(`/program-configuration/${program.id}/attending-activities/${activity.body.id}`, admin, { method: 'PUT', body: JSON.stringify({ name: '   ' }) });
    assert.equal(blankActivity.status, 400, 'an activity cannot be renamed to blank');
    assert.equal((await prisma.attendingActivityType.findUnique({ where: { id: activity.body.id } })).name, 'Endoscopy Suite', 'a refused rename leaves the stored name');

    const service = await request(`/program-configuration/${program.id}/clinical-services`, admin, { method: 'POST', body: JSON.stringify({ name: 'Acute Care', description: '  Emergency general surgery and inpatient consult service  ' }) });
    assert.equal(service.status, 201);
    assert.equal(service.body.description, 'Emergency general surgery and inpatient consult service', 'a service description is trimmed and stored');
    const renamedService = await request(`/program-configuration/${program.id}/clinical-services/${service.body.id}`, admin, { method: 'PUT', body: JSON.stringify({ name: 'Acute Care Surgery' }) });
    assert.equal(renamedService.status, 200);
    assert.equal(renamedService.body.description, 'Emergency general surgery and inpatient consult service', 'renaming a service keeps its description');
    const editedService = await request(`/program-configuration/${program.id}/clinical-services/${service.body.id}`, admin, { method: 'PUT', body: JSON.stringify({ description: '  Updated consult coverage  ' }) });
    assert.equal(editedService.body.description, 'Updated consult coverage', 'a service description edit persists trimmed');
    assert.equal((await request(`/program-configuration/${program.id}/clinical-services/${service.body.id}`, admin, { method: 'PUT', body: JSON.stringify({ description: 'x'.repeat(501) }) })).status, 400, 'an excessively long service description is rejected');
    assert.equal((await prisma.programService.findUnique({ where: { id: service.body.id } })).description, 'Updated consult coverage', 'a rejected description edit leaves the stored value intact');
    assert.equal((await request(`/program-configuration/${program.id}/clinical-services/${service.body.id}`, admin, { method: 'PUT', body: JSON.stringify({ isActive: false }) })).body.description, 'Updated consult coverage', 'deactivation preserves a service description');
    assert.equal((await request(`/program-configuration/${program.id}/clinical-services/${service.body.id}`, admin, { method: 'PUT', body: JSON.stringify({ isActive: true }) })).body.description, 'Updated consult coverage', 'restore preserves a service description');
    assert.equal((await request(`/program-configuration/${program.id}/clinical-services/${service.body.id}`, admin, { method: 'PUT', body: JSON.stringify({ name: '' }) })).status, 400, 'a service cannot be renamed to blank');

    // -- Attending rows save the fields they edit -----------------------------

    const staff = await request('/attending/roster', admin, {
      method: 'POST',
      body: JSON.stringify({ programId: program.id, attendingName: 'Dr. Original', email: 'original@example.invalid', phone: '555-0100', officeLocation: 'Level 3', typicalActivities: ['Clinic'] }),
    });
    assert.equal(staff.status, 201);

    const blankEmailStaff = await request('/attending/roster', admin, {
      method: 'POST',
      body: JSON.stringify({ programId: program.id, attendingName: 'Dr. Blank Email', email: '   ', typicalActivities: [] }),
    });
    assert.equal(blankEmailStaff.status, 201, 'a blank attending email is accepted');
    assert.equal(blankEmailStaff.body.email, null, 'a blank attending email is stored as null');

    const validEmailStaff = await request('/attending/roster', admin, {
      method: 'POST',
      body: JSON.stringify({ programId: program.id, attendingName: 'Dr. Valid Email', email: '  Mixed.Local+Tag@Example.ORG  ', typicalActivities: [] }),
    });
    assert.equal(validEmailStaff.status, 201, 'a valid attending email is accepted');
    assert.equal(validEmailStaff.body.email, 'Mixed.Local+Tag@example.org', 'only the email domain is normalized to lowercase');

    const malformedCreate = await request('/attending/roster', admin, {
      method: 'POST',
      body: JSON.stringify({ programId: program.id, attendingName: 'Dr. Invalid Email', email: 'not-an-email', typicalActivities: [] }),
    });
    assert.equal(malformedCreate.status, 400, 'a malformed attending email is rejected during creation');
    assert.equal(malformedCreate.body.error, 'Enter a valid email address.');

    const malformedEdit = await request(`/attending/roster/${validEmailStaff.body.id}`, admin, { method: 'PUT', body: JSON.stringify({ email: 'two@@example.org' }) });
    assert.equal(malformedEdit.status, 400, 'a malformed attending email is rejected during editing');
    assert.equal((await prisma.attendingRoster.findUnique({ where: { id: validEmailStaff.body.id } })).email, 'Mixed.Local+Tag@example.org', 'a rejected email edit leaves the previous value intact');

    assert.equal((await request(`/attending/roster/${validEmailStaff.body.id}`, viewer, { method: 'PUT', body: JSON.stringify({ email: 'viewer-change@example.org' }) })).status, 403, 'a Viewer cannot change attending contact information');
    assert.equal((await prisma.attendingRoster.findUnique({ where: { id: validEmailStaff.body.id } })).email, 'Mixed.Local+Tag@example.org', 'a Viewer contact edit changes nothing');

    const withoutRosterPermission = CONFIGURABLE_CHIEF_PERMISSIONS.filter(permission => permission !== 'manage_attending_roster');
    assert.equal((await request(`/program-configuration/${program.id}/role-permissions`, admin, { method: 'PUT', body: JSON.stringify({ role: 'chief_resident', permissions: withoutRosterPermission }) })).status, 200);
    assert.equal((await request(`/attending/roster/${validEmailStaff.body.id}`, chief, { method: 'PUT', body: JSON.stringify({ email: 'chief-denied@example.org' }) })).status, 403, 'a Chief without roster permission cannot change contact information');
    assert.equal((await request(`/program-configuration/${program.id}/role-permissions`, admin, { method: 'PUT', body: JSON.stringify({ role: 'chief_resident', permissions: CONFIGURABLE_CHIEF_PERMISSIONS }) })).status, 200);
    const chiefEdit = await request(`/attending/roster/${validEmailStaff.body.id}`, chief, { method: 'PUT', body: JSON.stringify({ email: 'Chief.Local@EXAMPLE.ORG' }) });
    assert.equal(chiefEdit.status, 200, 'a Chief with roster permission can change contact information');
    assert.equal(chiefEdit.body.email, 'Chief.Local@example.org');

    const renamedStaff = await request(`/attending/roster/${staff.body.id}`, admin, { method: 'PUT', body: JSON.stringify({ attendingName: '  Dr. Renamed  ' }) });
    assert.equal(renamedStaff.status, 200);
    assert.equal(renamedStaff.body.attendingName, 'Dr. Renamed', 'a rename is stored trimmed');
    assert.equal(renamedStaff.body.email, 'original@example.invalid', 'a rename keeps the stored email');
    assert.equal(renamedStaff.body.phone, '555-0100', 'a rename keeps the stored phone');
    assert.equal(renamedStaff.body.officeLocation, 'Level 3', 'a rename keeps the stored office');
    assert.deepEqual(renamedStaff.body.typicalActivities, ['Clinic'], 'a rename keeps the weekly pattern activities');

    const blankStaff = await request(`/attending/roster/${staff.body.id}`, admin, { method: 'PUT', body: JSON.stringify({ attendingName: '   ' }) });
    assert.equal(blankStaff.status, 400, 'an attending cannot be renamed to blank');
    assert.equal((await prisma.attendingRoster.findUnique({ where: { id: staff.body.id } })).attendingName, 'Dr. Renamed', 'a refused rename leaves the stored name');

    const deactivatedStaff = await request(`/attending/roster/${staff.body.id}`, admin, { method: 'PUT', body: JSON.stringify({ isActive: false }) });
    assert.equal(deactivatedStaff.status, 200);
    assert.equal(deactivatedStaff.body.attendingName, 'Dr. Renamed', 'deactivating does not disturb the contact record');
    assert.equal(deactivatedStaff.body.email, 'original@example.invalid');

    console.log('[settings-save-smoke] section-scoped program saves and registry field updates passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (created.programIds.length) {
      await prisma.auditEvent.deleteMany({ where: { programId: { in: created.programIds } } });
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
  console.error('[settings-save-smoke] failed:', error);
  process.exitCode = 1;
});
