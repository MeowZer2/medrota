const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { generateSchedule, clearSchedule } = require('../services/scheduler');

const RUN_ID = `PHASE5_DB_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const ORG_NAME = `MedRota ${RUN_ID}`;
const dateObj = iso => new Date(`${iso}T00:00:00.000Z`);

async function cleanupOrg(orgId) {
  const programs = await prisma.program.findMany({
    where: { orgId },
    select: { id: true },
  });
  const programIds = programs.map(p => p.id);

  const years = programIds.length
    ? await prisma.academicYear.findMany({ where: { programId: { in: programIds } }, select: { id: true } })
    : [];
  const yearIds = years.map(y => y.id);

  const blocks = yearIds.length
    ? await prisma.block.findMany({ where: { academicYearId: { in: yearIds } }, select: { id: true } })
    : [];
  const blockIds = blocks.map(b => b.id);

  const callDays = blockIds.length
    ? await prisma.callDay.findMany({ where: { blockId: { in: blockIds } }, select: { id: true } })
    : [];
  const callDayIds = callDays.map(d => d.id);

  if (callDayIds.length) await prisma.callAssignment.deleteMany({ where: { callDayId: { in: callDayIds } } });
  if (blockIds.length) {
    await prisma.scheduleVersion.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.dayFlag.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.attendingEntry.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.callDay.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.blockEnrollment.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.blockSettings.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.block.deleteMany({ where: { id: { in: blockIds } } });
  }
  if (yearIds.length) await prisma.publicHoliday.deleteMany({ where: { academicYearId: { in: yearIds } } });
  if (yearIds.length) await prisma.academicYear.deleteMany({ where: { id: { in: yearIds } } });
  if (programIds.length) {
    await prisma.attendingScheduleTemplate.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.attendingRoster.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.residentProfile.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.invite.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.programMember.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.program.deleteMany({ where: { id: { in: programIds } } });
  }
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
}

async function cleanupOldRuns() {
  const oldOrgs = await prisma.organization.findMany({
    where: { name: { startsWith: 'MedRota PHASE5_DB_' } },
    select: { id: true, name: true },
  });
  for (const org of oldOrgs) {
    console.log(`[phase5-db] removing old isolated test org ${org.name}`);
    await cleanupOrg(org.id);
  }
}

async function createFixture() {
  return prisma.organization.create({
    data: {
      name: ORG_NAME,
      country: 'Test',
      programs: {
        create: {
          name: `${RUN_ID} Program`,
          specialty: 'Internal Medicine',
          residents: {
            create: [
              { name: `${RUN_ID} Senior Override`, pgyLevel: 'PGY-3', residentRole: 'senior', isMedStudent: false },
              { name: `${RUN_ID} Junior Override`, pgyLevel: 'PGY-1', residentRole: 'junior', isMedStudent: false },
              { name: `${RUN_ID} Senior Generated`, pgyLevel: 'PGY-3', residentRole: 'senior', isMedStudent: false },
              { name: `${RUN_ID} Junior Generated`, pgyLevel: 'PGY-1', residentRole: 'junior', isMedStudent: false },
              { name: `${RUN_ID} Med Student`, pgyLevel: 'MS4', residentRole: 'junior', isMedStudent: true },
            ],
          },
          academicYears: {
            create: {
              startDate: dateObj('2026-01-01'),
              endDate: dateObj('2026-12-31'),
              blocks: {
                create: {
                  number: 99,
                  startDate: dateObj('2026-01-01'),
                  endDate: dateObj('2026-01-03'),
                  settings: {
                    create: {
                      maxCallsPerResident: 1,
                      maxCallsMedStudent: 0,
                      avoidAcademicDays: true,
                      allowWeekendConsecutive: false,
                      allowAttendingOnlyDays: false,
                    },
                  },
                  flags: {
                    create: {
                      date: dateObj('2026-01-02'),
                      label: 'Academic day',
                      color: '#F59E0B',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    include: {
      programs: {
        include: {
          residents: true,
          academicYears: { include: { blocks: true } },
        },
      },
    },
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  await cleanupOldRuns();

  const org = await createFixture();
  const program = org.programs[0];
  const block = program.academicYears[0].blocks[0];
  const residentByName = new Map(program.residents.map(r => [r.name.replace(`${RUN_ID} `, ''), r]));

  const manualCallDay = await prisma.callDay.create({
    data: { blockId: block.id, date: dateObj('2026-01-01') },
  });

  await prisma.callAssignment.createMany({
    data: [
      {
        callDayId: manualCallDay.id,
        residentId: residentByName.get('Senior Override').id,
        roleOnDay: 'senior',
        isOverride: true,
        overrideReason: 'phase5-db-check',
      },
      {
        callDayId: manualCallDay.id,
        residentId: residentByName.get('Junior Override').id,
        roleOnDay: 'junior',
        isOverride: true,
        overrideReason: 'phase5-db-check',
      },
    ],
  });

  let reloaded = await prisma.callAssignment.findMany({
    where: { callDay: { blockId: block.id }, isOverride: true },
    include: { resident: true, callDay: true },
  });
  assert(reloaded.length === 2, 'manual override assignments did not persist after fresh read');

  const summary = await generateSchedule(block.id);
  assert(summary.callSummary.some(r => r.name.endsWith('Senior Override') && r.calls === 1), 'override senior was not counted in callSummary');
  assert(summary.callSummary.some(r => r.name.endsWith('Junior Override') && r.calls === 1), 'override junior was not counted in callSummary');
  assert(summary.callSummary.some(r => r.name.endsWith('Med Student') && r.calls === 0), 'maxCallsMedStudent=0 was not honored');
  assert(summary.unassignedDates.includes('2026-01-02'), 'academic day was not reported unassigned');
  assert(summary.warnings.some(w => w.date === '2026-01-02' && /academic/i.test(w.message)), 'academic day warning was not returned');

  reloaded = await prisma.callAssignment.findMany({
    where: { callDay: { blockId: block.id } },
    include: { resident: true, callDay: true },
    orderBy: { createdAt: 'asc' },
  });
  const overrideRows = reloaded.filter(a => a.isOverride);
  const generatedRows = reloaded.filter(a => !a.isOverride);
  assert(overrideRows.length === 2, 'auto-generate deleted or changed manual overrides');
  assert(generatedRows.length > 0, 'auto-generate did not create generated assignments');

  for (const callDay of await prisma.callDay.findMany({ where: { blockId: block.id }, include: { assignments: true } })) {
    const residentIds = callDay.assignments.map(a => a.residentId);
    assert(new Set(residentIds).size === residentIds.length, `duplicate resident assignment on ${callDay.date.toISOString()}`);
    assert(callDay.assignments.filter(a => a.roleOnDay === 'junior').length <= 1, `more than one junior on ${callDay.date.toISOString()}`);
  }

  await clearSchedule(block.id);
  const afterClear = await prisma.callAssignment.findMany({
    where: { callDay: { blockId: block.id } },
  });
  assert(afterClear.length === 2 && afterClear.every(a => a.isOverride), 'clearSchedule did not preserve only overrides');

  await prisma.blockSettings.update({
    where: { blockId: block.id },
    data: { maxCallsPerResident: 2, maxCallsMedStudent: 1, avoidAcademicDays: false },
  });
  const settingsReload = await prisma.blockSettings.findUnique({ where: { blockId: block.id } });
  assert(settingsReload.maxCallsPerResident === 2, 'maxCallsPerResident did not persist');
  assert(settingsReload.maxCallsMedStudent === 1, 'maxCallsMedStudent did not persist');
  assert(settingsReload.avoidAcademicDays === false, 'avoidAcademicDays did not persist');

  const publicToken = crypto.randomUUID();
  const version = await prisma.scheduleVersion.create({
    data: {
      blockId: block.id,
      snapshotJson: { source: 'phase5-db-check', runId: RUN_ID },
      publishedBy: null,
    },
  });
  await prisma.block.update({
    where: { id: block.id },
    data: { isPublished: true, publicToken },
  });
  const publishedReload = await prisma.block.findUnique({
    where: { id: block.id },
    include: { versions: { orderBy: { publishedAt: 'desc' } } },
  });
  assert(publishedReload.isPublished === true, 'published state did not persist');
  assert(publishedReload.publicToken === publicToken, 'public token did not persist');
  assert(publishedReload.versions.some(v => v.id === version.id), 'schedule version did not persist');

  await cleanupOrg(org.id);
  const deleted = await prisma.organization.findUnique({ where: { id: org.id } });
  assert(!deleted, 'isolated test organization cleanup failed');

  console.log('Phase 5 DB persistence checks passed');
}

main()
  .catch(err => {
    console.error('[phase5-db] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
