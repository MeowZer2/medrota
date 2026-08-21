require('dotenv').config();

const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const app = require('../index');
const { calculatePgyLevel, effectivePgy, effectiveResidentRole, normalizeAcademicTimes, academicTimesValidationError, syncAutomaticEnrollmentsForBlock } = require('../services/residentLifecycle');
const { buildResidentDisplayNames } = require('../services/residentDisplayName');
const { shapeProtectedSchedule } = require('../services/excelExport');

const tag = `RESIDENT_WORKFLOW_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

async function cleanup(orgIds) {
  const programs = await prisma.program.findMany({ where: { orgId: { in: orgIds } }, select: { id: true } });
  const programIds = programs.map(item => item.id);
  const years = await prisma.academicYear.findMany({ where: { programId: { in: programIds } }, select: { id: true } });
  const blocks = await prisma.block.findMany({ where: { academicYearId: { in: years.map(item => item.id) } }, select: { id: true } });
  const blockIds = blocks.map(item => item.id);
  const callDays = await prisma.callDay.findMany({ where: { blockId: { in: blockIds } }, select: { id: true } });
  await prisma.callAssignment.deleteMany({ where: { callDayId: { in: callDays.map(item => item.id) } } });
  await prisma.auditEvent.deleteMany({ where: { programId: { in: programIds } } });
  await prisma.scheduleVersion.deleteMany({ where: { blockId: { in: blockIds } } });
  await prisma.dayFlag.deleteMany({ where: { blockId: { in: blockIds } } });
  await prisma.callDay.deleteMany({ where: { blockId: { in: blockIds } } });
  await prisma.attendingEntry.deleteMany({ where: { blockId: { in: blockIds } } });
  await prisma.blockEnrollment.deleteMany({ where: { blockId: { in: blockIds } } });
  await prisma.blockSettings.deleteMany({ where: { blockId: { in: blockIds } } });
  await prisma.block.deleteMany({ where: { id: { in: blockIds } } });
  await prisma.publicHoliday.deleteMany({ where: { academicYearId: { in: years.map(item => item.id) } } });
  await prisma.academicYear.deleteMany({ where: { id: { in: years.map(item => item.id) } } });
  await prisma.programRolePermission.deleteMany({ where: { programId: { in: programIds } } });
  await prisma.residentProfile.deleteMany({ where: { programId: { in: programIds } } });
  await prisma.programMember.deleteMany({ where: { programId: { in: programIds } } });
  await prisma.program.deleteMany({ where: { id: { in: programIds } } });
  await prisma.user.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
}

async function main() {
  assert.equal(calculatePgyLevel('2025-07-01', '2027-07-01'), 3, 'academic-year progression must produce PGY-3');
  assert.equal(calculatePgyLevel('2025-10-01', '2027-07-01'), 2, 'off-cycle progression must wait for the anniversary');
  assert.equal(effectivePgy({ pgyLevel: '4' }, '2027-07-01').source, 'manual', 'legacy PGY must remain readable');
  assert.equal(effectiveResidentRole({ pgyLevel: '3', programStartDate: new Date('2025-07-01'), residentRole: 'senior' }, { juniorPgyLevels: [1, 2, 3] }, '2027-07-01').role, 'junior');
  assert.equal(effectiveResidentRole({ pgyLevel: '3', programStartDate: new Date('2025-07-01'), residentRole: 'junior', residentRoleOverride: 'senior' }, { juniorPgyLevels: [1, 2, 3] }, '2027-07-01').role, 'senior');

  const displayResidents = [
    { id: 'u', name: 'Morgan Jones' },
    { id: 'a', name: 'Alex Smith', pgyLevel: '2' },
    { id: 'j', name: 'Jamie Smith', pgyLevel: '3' },
    { id: 'aa', name: 'Andrew Stone', pgyLevel: '1' },
    { id: 'ab', name: 'Alex Stone', pgyLevel: '2' },
    { id: 'exact-a', name: 'Sam Lee', pgyLevel: '2', isServiceResident: true },
    { id: 'exact-b', name: 'Sam Lee', pgyLevel: '2', isServiceResident: true },
  ];
  const names = buildResidentDisplayNames(displayResidents);
  assert.equal(names.get('u'), 'Dr. Jones');
  assert.equal(names.get('a'), 'Dr. A. Smith');
  assert.equal(names.get('j'), 'Dr. J. Smith');
  assert.equal(names.get('aa'), 'Dr. Andrew Stone');
  assert.equal(names.get('ab'), 'Dr. Alex Stone');
  assert.notEqual(names.get('exact-a'), names.get('exact-b'), 'identical names must receive an additional safe differentiator');
  const exportShape = shapeProtectedSchedule({
    number: 1,
    startDate: new Date('2027-07-01Z'),
    endDate: new Date('2027-07-01Z'),
    academicYear: { program: { name: 'Test Program', specialty: 'Surgery' }, holidays: [] },
    enrollments: [{ resident: displayResidents[1] }, { resident: displayResidents[2] }],
    callDays: [{ date: new Date('2027-07-01Z'), assignments: [{ roleOnDay: 'senior', resident: displayResidents[1] }] }],
  });
  assert.equal(exportShape.callDays[0].assignments[0].resident.name, 'Dr. A. Smith', 'draft exports must disambiguate against the full block roster');
  assert.deepEqual(normalizeAcademicTimes([{ day: 'Tuesday', period: 'AM' }, { day: 'Tuesday', period: 'PM' }, { day: 'Tuesday', period: 'AM' }]), [{ day: 'Tuesday', period: 'AM' }, { day: 'Tuesday', period: 'PM' }]);
  assert.match(academicTimesValidationError([{ day: 'Tuesday', period: 'AM' }, { day: 'Tuesday', period: 'AM' }]), /unique/);

  const orgIds = [];
  let server;
  try {
    const [org, foreignOrg] = await Promise.all([
      prisma.organization.create({ data: { name: tag, country: 'CA', status: 'active' } }),
      prisma.organization.create({ data: { name: `${tag}_FOREIGN`, country: 'CA', status: 'active' } }),
    ]);
    orgIds.push(org.id, foreignOrg.id);
    const [program, foreignProgram] = await Promise.all([
      prisma.program.create({ data: { name: `${tag}_PROGRAM`, specialty: 'Vascular Surgery', orgId: org.id, juniorPgyLevels: [1, 2, 3] } }),
      prisma.program.create({ data: { name: `${tag}_FOREIGN_PROGRAM`, specialty: 'General Surgery', orgId: foreignOrg.id } }),
    ]);
    const [year, futureYear, foreignYear] = await Promise.all([
      prisma.academicYear.create({ data: { programId: program.id, startDate: new Date('2027-07-01Z'), endDate: new Date('2028-06-30Z') } }),
      prisma.academicYear.create({ data: { programId: program.id, startDate: new Date('2030-07-01Z'), endDate: new Date('2031-06-30Z') } }),
      prisma.academicYear.create({ data: { programId: foreignProgram.id, startDate: new Date('2027-07-01Z'), endDate: new Date('2028-06-30Z') } }),
    ]);
    const [block1, block2, outsideBlock, foreignBlock] = await Promise.all([
      prisma.block.create({ data: { academicYearId: year.id, number: 1, startDate: new Date('2027-07-01Z'), endDate: new Date('2027-07-28Z') } }),
      prisma.block.create({ data: { academicYearId: year.id, number: 2, startDate: new Date('2027-07-29Z'), endDate: new Date('2027-08-25Z') } }),
      prisma.block.create({ data: { academicYearId: futureYear.id, number: 1, startDate: new Date('2030-07-01Z'), endDate: new Date('2030-07-28Z') } }),
      prisma.block.create({ data: { academicYearId: foreignYear.id, number: 1, startDate: new Date('2027-07-01Z'), endDate: new Date('2027-07-28Z') } }),
    ]);
    await Promise.all([block1, block2, outsideBlock, foreignBlock].map(block => prisma.blockSettings.create({ data: { blockId: block.id, maxCallsPerResident: 5 } })));
    const [chief, viewer] = await Promise.all([
      prisma.user.create({ data: { name: `${tag}_CHIEF`, email: `${tag.toLowerCase()}_chief@example.test`, passwordHash: 'unused', orgId: org.id } }),
      prisma.user.create({ data: { name: `${tag}_VIEWER`, email: `${tag.toLowerCase()}_viewer@example.test`, passwordHash: 'unused', orgId: org.id } }),
    ]);
    await prisma.programMember.createMany({ data: [{ programId: program.id, userId: chief.id, role: 'chief_resident' }, { programId: program.id, userId: viewer.id, role: 'viewer' }] });
    const [inService, offService, student, foreignResident] = await Promise.all([
      prisma.residentProfile.create({ data: { programId: program.id, name: 'Alex Smith', pgyLevel: '1', residentRole: 'junior', programStartDate: new Date('2025-07-01Z'), expectedCompletionDate: new Date('2028-06-30Z') } }),
      prisma.residentProfile.create({ data: { programId: program.id, name: 'Jamie Smith', pgyLevel: '3', residentRole: 'senior', isServiceResident: false, homeProgram: 'General Surgery' } }),
      prisma.residentProfile.create({ data: { programId: program.id, name: 'Taylor Learner', pgyLevel: '1', residentRole: 'junior', isServiceResident: false, isMedStudent: true } }),
      prisma.residentProfile.create({ data: { programId: foreignProgram.id, name: 'Foreign Resident', pgyLevel: '2', residentRole: 'junior' } }),
    ]);

    await syncAutomaticEnrollmentsForBlock(block1.id);
    await syncAutomaticEnrollmentsForBlock(outsideBlock.id);
    assert.ok(await prisma.blockEnrollment.findUnique({ where: { blockId_residentId: { blockId: block1.id, residentId: inService.id } } }), 'eligible in-service resident must auto-enroll');
    assert.equal(await prisma.blockEnrollment.findUnique({ where: { blockId_residentId: { blockId: outsideBlock.id, residentId: inService.id } } }), null, 'resident outside training period must not auto-enroll');
    assert.equal(await prisma.blockEnrollment.count({ where: { residentId: offService.id } }), 0, 'off-service resident must not auto-enroll');
    assert.equal(await prisma.blockEnrollment.count({ where: { residentId: student.id } }), 0, 'medical student must remain block-specific');

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    const token = user => jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '5m' });
    async function request(path, user, options = {}) {
      const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { Authorization: `Bearer ${token(user)}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    }

    const createdViaApi = await request('/residents', chief, {
      method: 'POST',
      body: JSON.stringify({
        programId: program.id,
        name: 'Casey Audit',
        programStartDate: '2027-07-01',
        expectedCompletionDate: '2030-06-30',
        email: 'casey.audit@example.test',
        phone: '555-0100',
      }),
    });
    assert.equal(createdViaApi.status, 201);
    assert.equal((await request(`/residents/${createdViaApi.body.id}`, chief, {
      method: 'PUT',
      body: JSON.stringify({ expectedCompletionDate: '2029-06-30' }),
    })).status, 200);
    assert.equal((await request(`/residents/${createdViaApi.body.id}`, chief, { method: 'DELETE' })).status, 200);
    const inactiveEnrollment = await request(`/residents/${createdViaApi.body.id}/enroll`, chief, { method: 'POST', body: JSON.stringify({ blockId: block1.id }) });
    assert.equal(inactiveEnrollment.status, 409, 'inactive resident enrollment must be rejected by the backend');

    for (const target of [block1, block2]) {
      const add = await request(`/residents/${offService.id}/enroll`, chief, { method: 'POST', body: JSON.stringify({ blockId: target.id }) });
      assert.ok([200, 201].includes(add.status));
    }
    assert.equal(await prisma.blockEnrollment.count({ where: { residentId: offService.id } }), 2, 'same off-service profile must be reusable across blocks');
    await request(`/residents/${student.id}/enroll`, chief, { method: 'POST', body: JSON.stringify({ blockId: block1.id }) });
    await request(`/residents/${offService.id}/enroll`, chief, { method: 'POST', body: JSON.stringify({ blockId: block1.id }) });
    assert.equal(await prisma.blockEnrollment.count({ where: { blockId: block1.id, residentId: offService.id } }), 1, 'duplicate enrollment must be impossible');

    const availability = await request(`/residents/${inService.id}`, chief, { method: 'PUT', body: JSON.stringify({ blockId: block1.id, vacationDates: ['2027-07-10'], otherUnavailableDates: ['2027-07-11'], academicTimes: [{ day: 'Tuesday', period: 'AM' }, { day: 'Tuesday', period: 'PM' }], availabilityConfirmed: true, callCapOverride: 5 }) });
    assert.equal(availability.status, 200);
    const persisted = await prisma.blockEnrollment.findUnique({ where: { blockId_residentId: { blockId: block1.id, residentId: inService.id } } });
    assert.deepEqual(persisted.academicTimes, [{ day: 'Tuesday', period: 'AM' }, { day: 'Tuesday', period: 'PM' }]);

    const composition = await request(`/residents/block/${block1.id}/composition`, chief);
    assert.equal(composition.status, 200);
    const shaped = composition.body.inBlock.find(item => item.id === inService.id);
    assert.equal(shaped.pgyLevel, '3');
    assert.equal(shaped.pgySource, 'calculated');
    assert.equal(shaped.residentRole, 'junior');
    assert.equal(shaped.workload.blockDays, 28);
    assert.equal(shaped.workload.daysOnService, 26);
    assert.equal(shaped.workload.callType, 'in_house');
    assert.equal(shaped.workload.paroMaximum, 6);
    assert.equal(shaped.workload.localMaximum, 5);
    assert.equal(composition.body.inBlock.find(item => item.id === inService.id).displayName, 'Dr. A. Smith');

    const callDay = await prisma.callDay.create({ data: { blockId: block1.id, date: new Date('2027-07-03Z') } });
    await prisma.callAssignment.create({ data: { callDayId: callDay.id, residentId: offService.id, roleOnDay: 'senior' } });
    const blockedRemoval = await request(`/residents/${offService.id}/enroll/${block1.id}`, chief, { method: 'DELETE' });
    assert.equal(blockedRemoval.status, 409);
    assert.equal(blockedRemoval.body.code, 'RESIDENT_HAS_ASSIGNMENTS');
    const safeRemoval = await request(`/residents/${offService.id}/enroll/${block2.id}`, chief, { method: 'DELETE' });
    assert.equal(safeRemoval.status, 200);
    await prisma.residentProfile.update({ where: { id: offService.id }, data: { isActive: false } });
    const unresolvedReadiness = await request(`/blocks/${block1.id}/readiness`, chief);
    assert.equal(unresolvedReadiness.status, 200);
    assert.ok(unresolvedReadiness.body.residents.unresolvedRecords.some(item => item.residentId === offService.id));
    assert.ok(unresolvedReadiness.body.blockers.some(item => item.code === 'UNRESOLVED_RESIDENT_RECORDS'));
    await prisma.residentProfile.update({ where: { id: offService.id }, data: { isActive: true } });

    const crossProgram = await request(`/residents/${foreignResident.id}/enroll`, chief, { method: 'POST', body: JSON.stringify({ blockId: block1.id }) });
    assert.equal(crossProgram.status, 400, 'cross-program enrollment must be rejected');
    await prisma.programRolePermission.createMany({ data: [
      { programId: program.id, role: 'chief_resident', permission: 'manage_residents', enabled: false },
      { programId: program.id, role: 'chief_resident', permission: 'manage_block_availability', enabled: true },
    ] });
    const blockOnlyUpdate = await request(`/residents/${inService.id}`, chief, { method: 'PUT', body: JSON.stringify({ blockId: block1.id, availabilityConfirmed: true }) });
    assert.equal(blockOnlyUpdate.status, 200, 'block availability permission must remain independently usable');
    const directoryEscalation = await request(`/residents/${inService.id}`, chief, { method: 'PUT', body: JSON.stringify({ blockId: block1.id, name: 'Unauthorized Rename', availabilityConfirmed: true }) });
    assert.equal(directoryEscalation.status, 403, 'block availability permission must not authorize directory changes');
    const viewerMutation = await request(`/residents/${student.id}/enroll`, viewer, { method: 'POST', body: JSON.stringify({ blockId: block2.id }) });
    assert.equal(viewerMutation.status, 403, 'viewer must not mutate block composition');
    const actions = await prisma.auditEvent.findMany({ where: { programId: program.id }, select: { action: true, metadataJson: true } });
    assert.ok(actions.some(item => item.action === 'resident.created'));
    assert.ok(actions.some(item => item.action === 'resident.updated'));
    assert.ok(actions.some(item => item.action === 'resident.deactivated'));
    assert.ok(actions.some(item => item.action === 'resident_training_dates.updated'));
    assert.ok(actions.some(item => item.action === 'block_resident.added'));
    assert.ok(actions.some(item => item.action === 'block_resident.removed'));
    assert.ok(actions.some(item => item.action === 'block_availability.updated'));
    assert.ok(actions.every(item => !JSON.stringify(item.metadataJson).includes('casey.audit@example.test') && !JSON.stringify(item.metadataJson).includes('555-0100')), 'audit metadata must not contain private contact values');
    console.log('Resident workflow smoke passed.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await cleanup(orgIds);
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
