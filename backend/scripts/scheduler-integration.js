require('dotenv').config();

const assert = require('node:assert/strict');
const prisma = require('../lib/prisma');
const { generateSchedule } = require('../services/scheduler');
const { validateSchedule } = require('../services/scheduleValidator');
const {
  normalizeDateKey,
  calculateDaysOnService,
  getInHouseMax,
  getHomeCallMax,
  getAssignmentCallType,
  calculateWeightedCallPoints,
} = require('../services/paroRules');

const tag = `SCHED_ONLY_${Date.now()}_${Math.random().toString(16).slice(2)}`;

async function cleanup(orgId) {
  if (!orgId) return;
  const programs = await prisma.program.findMany({ where: { orgId }, select: { id: true } });
  const programIds = programs.map(item => item.id);
  const years = await prisma.academicYear.findMany({ where: { programId: { in: programIds } }, select: { id: true } });
  const yearIds = years.map(item => item.id);
  const blocks = await prisma.block.findMany({ where: { academicYearId: { in: yearIds } }, select: { id: true } });
  const blockIds = blocks.map(item => item.id);
  const callDays = await prisma.callDay.findMany({ where: { blockId: { in: blockIds } }, select: { id: true } });
  const callDayIds = callDays.map(item => item.id);

  if (callDayIds.length) await prisma.callAssignment.deleteMany({ where: { callDayId: { in: callDayIds } } });
  if (blockIds.length) {
    await prisma.scheduleVersion.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.dayFlag.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.callDay.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.attendingEntry.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.blockEnrollment.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.blockSettings.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.block.deleteMany({ where: { id: { in: blockIds } } });
  }
  if (yearIds.length) {
    await prisma.publicHoliday.deleteMany({ where: { academicYearId: { in: yearIds } } });
    await prisma.academicYear.deleteMany({ where: { id: { in: yearIds } } });
  }
  if (programIds.length) {
    await prisma.attendingScheduleTemplate.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.attendingRoster.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.residentProfile.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.invite.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.programMember.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.program.deleteMany({ where: { id: { in: programIds } } });
  }
  await prisma.organization.delete({ where: { id: orgId } });
}

function dateKeys(start, days) {
  const values = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  for (let index = 0; index < days; index += 1) {
    values.push(normalizeDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return values;
}

async function main() {
  let orgId;
  try {
    const org = await prisma.organization.create({ data: { name: tag, country: 'CA', status: 'active' } });
    orgId = org.id;
    const program = await prisma.program.create({
      data: { name: `${tag}_PROGRAM`, specialty: 'Internal Medicine', orgId: org.id, juniorInHouseCall: true, seniorInHouseCall: false },
    });
    const year = await prisma.academicYear.create({
      data: { programId: program.id, startDate: new Date('2032-01-01T00:00:00Z'), endDate: new Date('2032-12-31T00:00:00Z') },
    });
    const [block, constrainedBlock] = await Promise.all([
      prisma.block.create({ data: { academicYearId: year.id, number: 1, startDate: new Date('2032-01-01T00:00:00Z'), endDate: new Date('2032-01-28T00:00:00Z') } }),
      prisma.block.create({ data: { academicYearId: year.id, number: 2, startDate: new Date('2032-02-01T00:00:00Z'), endDate: new Date('2032-02-10T00:00:00Z') } }),
    ]);
    await Promise.all([
      prisma.blockSettings.create({ data: { blockId: block.id, maxCallsPerResident: 6, maxCallsMedStudent: 2, avoidAcademicDays: true } }),
      prisma.blockSettings.create({ data: { blockId: constrainedBlock.id, maxCallsPerResident: 1, maxCallsMedStudent: 0, avoidAcademicDays: true } }),
    ]);

    const seniors = [];
    const juniors = [];
    for (let index = 0; index < 5; index += 1) {
      seniors.push(await prisma.residentProfile.create({
        data: { programId: program.id, name: `${tag}_SENIOR_${index}`, pgyLevel: '4', residentRole: 'senior', isServiceResident: true },
      }));
      juniors.push(await prisma.residentProfile.create({
        data: { programId: program.id, name: `${tag}_JUNIOR_${index}`, pgyLevel: '2', residentRole: 'junior', isServiceResident: true },
      }));
    }
    const missingAvailability = await prisma.residentProfile.create({
      data: { programId: program.id, name: `${tag}_MISSING`, pgyLevel: '2', residentRole: 'junior', isServiceResident: true },
    });

    const vacation = ['2032-01-10', '2032-01-11', '2032-01-12'].map(value => new Date(`${value}T00:00:00Z`));
    await prisma.blockEnrollment.createMany({
      data: [
        ...seniors.map((resident, index) => ({ blockId: block.id, residentId: resident.id, vacationDates: index === 0 ? vacation : [] })),
        ...juniors.map((resident, index) => ({ blockId: block.id, residentId: resident.id, vacationDates: index === 0 ? vacation : [] })),
        { blockId: constrainedBlock.id, residentId: seniors[0].id, vacationDates: [] },
        { blockId: constrainedBlock.id, residentId: juniors[0].id, vacationDates: [] },
      ],
    });
    await prisma.dayFlag.create({ data: { blockId: block.id, date: new Date('2032-01-15T00:00:00Z'), label: 'Academic day' } });

    const manualDay = await prisma.callDay.create({ data: { blockId: block.id, date: new Date('2032-01-01T00:00:00Z') } });
    const manualAssignment = await prisma.callAssignment.create({
      data: { callDayId: manualDay.id, residentId: seniors[0].id, roleOnDay: 'senior', isOverride: true, overrideReason: `${tag}_MANUAL` },
    });

    const summary = await generateSchedule(block.id);
    assert(summary.warnings.some(item => item.code === 'MISSING_RESIDENT_AVAILABILITY' && item.residentId === missingAvailability.id));
    assert(summary.excludedResidents.some(item => item.residentId === missingAvailability.id));
    assert(summary.unassignedDates.includes('2032-01-15'), 'academic day must remain unassigned');

    const assignments = await prisma.callAssignment.findMany({
      where: { callDay: { blockId: block.id } },
      include: { callDay: true, resident: true },
      orderBy: { callDay: { date: 'asc' } },
    });
    assert(assignments.some(item => item.id === manualAssignment.id), 'manual override must survive generation');
    assert(!assignments.some(item => item.residentId === missingAvailability.id), 'missing availability must not become full availability');

    for (const resident of [seniors[0], juniors[0]]) {
      const residentDates = assignments.filter(item => item.residentId === resident.id).map(item => normalizeDateKey(item.callDay.date));
      assert(!residentDates.includes('2032-01-09'), 'resident must not be post-call on first vacation day');
      assert(!residentDates.some(value => ['2032-01-10', '2032-01-11', '2032-01-12'].includes(value)), 'resident must not be assigned during vacation');
    }

    const blockKeys = dateKeys('2032-01-01', 28);
    for (const resident of [...seniors, ...juniors]) {
      const residentAssignments = assignments.filter(item => item.residentId === resident.id);
      const residentDates = [...new Set(residentAssignments.map(item => normalizeDateKey(item.callDay.date)))].sort();
      assert(residentAssignments.length <= 6, 'configured local cap must be enforced');
      for (let index = 1; index < residentDates.length; index += 1) {
        const prior = new Date(`${residentDates[index - 1]}T00:00:00Z`);
        const current = new Date(`${residentDates[index]}T00:00:00Z`);
        assert.notEqual((current - prior) / 86400000, 1, 'generated schedule must not contain consecutive calls');
      }
      const vacationKeys = resident.id === seniors[0].id || resident.id === juniors[0].id
        ? vacation.map(normalizeDateKey)
        : [];
      const daysOnService = calculateDaysOnService(blockKeys, vacationKeys);
      const inHouse = residentAssignments.filter(item => getAssignmentCallType(item.roleOnDay, program) === 'in_house').length;
      const home = residentAssignments.length - inHouse;
      assert(inHouse <= getInHouseMax(daysOnService));
      assert(home <= getHomeCallMax(daysOnService));
      assert(calculateWeightedCallPoints(home, inHouse) <= 30);
    }

    const validation = await validateSchedule(block.id);
    assert.equal(validation.compliant, true, `generated assignments must satisfy hard rules: ${validation.violations.map(item => item.code).join(', ')}`);
    assert(validation.warnings.some(item => item.code === 'MISSING_RESIDENT_AVAILABILITY'));

    const constrained = await generateSchedule(constrainedBlock.id);
    assert(constrained.unassigned > 0, 'an unfillable block must retain unassigned dates');
    assert(constrained.warnings.some(item => /No PARO-eligible/.test(item.message)), 'unfilled dates must include actionable eligibility warnings');
    const constrainedAssignments = await prisma.callAssignment.findMany({ where: { callDay: { blockId: constrainedBlock.id } } });
    assert(constrainedAssignments.filter(item => item.residentId === seniors[0].id).length <= 1);
    assert(constrainedAssignments.filter(item => item.residentId === juniors[0].id).length <= 1);

    // Generation must be idempotent. Callers that do not pre-clear used to get a
    // second resident written into an already-filled role slot, which is how
    // legacy duplicate role rows were produced.
    const before = await prisma.callAssignment.findMany({
      where: { callDay: { blockId: block.id } },
      select: { id: true, callDayId: true, residentId: true, roleOnDay: true, isOverride: true },
      orderBy: { id: 'asc' },
    });
    await generateSchedule(block.id);
    const after = await prisma.callAssignment.findMany({
      where: { callDay: { blockId: block.id } },
      select: { id: true, callDayId: true, residentId: true, roleOnDay: true, isOverride: true },
      orderBy: { id: 'asc' },
    });
    assert.deepEqual(after, before, 'regenerating without clearing must not change stored assignments');
    const slotKeys = after.map(item => `${item.callDayId}:${item.roleOnDay}`);
    assert.equal(new Set(slotKeys).size, slotKeys.length, 'regeneration must not duplicate a role slot');

    console.log('[scheduler-integration] generation and stored-schedule validation checks passed');
  } finally {
    await cleanup(orgId);
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('[scheduler-integration] failed:', error.message);
  process.exitCode = 1;
});
