// Deterministic, anonymized scheduling fixtures for the acceptance harness.
//
// Every fixture lives inside its own organization tagged ACCEPT_ONLY_* so the
// harness can remove exactly what it created and nothing else. Resident names
// are synthetic ("Senior 1", "Junior 3") and carry no clinician identity.

const prisma = require('../../lib/prisma');
const { normalizeDateKey, dateFromDateKey, addDaysToDateKey } = require('../../services/paroRules');

function makeTag(prefix) {
  return `ACCEPT_ONLY_${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function dateRange(startKey, days) {
  const keys = [];
  let cursor = startKey;
  for (let index = 0; index < days; index += 1) {
    keys.push(cursor);
    cursor = addDaysToDateKey(cursor, 1);
  }
  return keys;
}

// Inclusive vacation range, expanded to the individual dates the schema stores.
function vacationRange(startKey, endKey) {
  const keys = [];
  let cursor = startKey;
  while (cursor <= endKey) {
    keys.push(cursor);
    cursor = addDaysToDateKey(cursor, 1);
  }
  return keys;
}

function dayOfWeek(dateKey) {
  return dateFromDateKey(dateKey).getUTCDay();
}

/**
 * Build one isolated scheduling world.
 *
 * spec: {
 *   tag, startKey, days,
 *   program: { juniorInHouseCall, seniorInHouseCall },
 *   settings: { ...BlockSettings },
 *   seniors: n, juniors: n, medStudents: n,
 *   vacations: { 'Senior 1': [[start, end]], ... },
 *   callCaps: { 'Junior 2': 4 },
 *   enrollAll: bool,  unenrolled: ['Junior 4'],
 *   academicWeekday: 2 (Tuesday) | null,
 *   holidays: ['2034-01-15'],
 *   attendingEveryDay: bool,
 * }
 */
async function buildScenario(spec) {
  const tag = spec.tag;
  const blockDateKeys = dateRange(spec.startKey, spec.days);
  const endKey = blockDateKeys[blockDateKeys.length - 1];

  const org = await prisma.organization.create({
    data: { name: `${tag}_ORG`, country: 'CA', status: 'active' },
  });
  const program = await prisma.program.create({
    data: {
      name: `${tag}_PROGRAM`,
      specialty: 'General Surgery',
      orgId: org.id,
      juniorInHouseCall: spec.program?.juniorInHouseCall ?? true,
      seniorInHouseCall: spec.program?.seniorInHouseCall ?? false,
    },
  });
  const year = await prisma.academicYear.create({
    data: {
      programId: program.id,
      startDate: dateFromDateKey(addDaysToDateKey(spec.startKey, -60)),
      endDate: dateFromDateKey(addDaysToDateKey(endKey, 60)),
    },
  });
  const block = await prisma.block.create({
    data: {
      academicYearId: year.id,
      number: spec.blockNumber ?? 1,
      startDate: dateFromDateKey(spec.startKey),
      endDate: dateFromDateKey(endKey),
    },
  });
  await prisma.blockSettings.create({
    data: {
      blockId: block.id,
      allowWeekendConsecutive: false,
      allowAttendingOnlyDays: false,
      avoidAcademicDays: true,
      maxCallsPerResident: 9,
      maxCallsMedStudent: 5,
      limitWeekendCalls: true,
      ...(spec.settings ?? {}),
    },
  });

  // Residents are created in a fixed order so roster order is reproducible.
  const residents = [];
  for (let index = 1; index <= (spec.seniors ?? 0); index += 1) {
    residents.push(await prisma.residentProfile.create({
      data: {
        programId: program.id,
        name: `Senior ${index}`,
        pgyLevel: String(3 + (index % 3)),
        residentRole: 'senior',
        isServiceResident: true,
        isActive: true,
      },
    }));
  }
  for (let index = 1; index <= (spec.juniors ?? 0); index += 1) {
    residents.push(await prisma.residentProfile.create({
      data: {
        programId: program.id,
        name: `Junior ${index}`,
        pgyLevel: String(1 + (index % 2)),
        residentRole: 'junior',
        isServiceResident: true,
        isActive: true,
      },
    }));
  }
  for (let index = 1; index <= (spec.medStudents ?? 0); index += 1) {
    residents.push(await prisma.residentProfile.create({
      data: {
        programId: program.id,
        name: `Student ${index}`,
        pgyLevel: 'Medical Student',
        residentRole: 'junior',
        isMedStudent: true,
        isServiceResident: true,
        isActive: true,
      },
    }));
  }

  const byName = new Map(residents.map(resident => [resident.name, resident]));
  const unenrolled = new Set(spec.unenrolled ?? []);
  const vacationsByName = spec.vacations ?? {};
  const capsByName = spec.callCaps ?? {};

  // Enrollment insertion order becomes the generator's tie-break order, so the
  // fairness harness can vary it deliberately.
  const enrollmentOrder = spec.enrollmentOrder
    ? spec.enrollmentOrder.map(name => {
        const resident = byName.get(name);
        if (!resident) throw new Error(`enrollmentOrder names unknown resident "${name}"`);
        return resident;
      })
    : residents;
  if (spec.enrollmentOrder && enrollmentOrder.length !== residents.length) {
    throw new Error('enrollmentOrder must list every resident exactly once');
  }

  for (const resident of enrollmentOrder) {
    if (unenrolled.has(resident.name)) continue;
    const ranges = vacationsByName[resident.name] ?? [];
    const vacationKeys = ranges.flatMap(([from, to]) => vacationRange(from, to));
    await prisma.blockEnrollment.create({
      data: {
        blockId: block.id,
        residentId: resident.id,
        vacationDates: vacationKeys.map(dateFromDateKey),
        callCapOverride: capsByName[resident.name] ?? null,
      },
    });
  }

  // One academic day per week, on a fixed weekday.
  const academicDates = [];
  if (spec.academicWeekday !== null && spec.academicWeekday !== undefined) {
    for (const dateKey of blockDateKeys) {
      if (dayOfWeek(dateKey) === spec.academicWeekday) {
        academicDates.push(dateKey);
        await prisma.dayFlag.create({
          data: { blockId: block.id, date: dateFromDateKey(dateKey), label: 'Academic day' },
        });
      }
    }
  }

  const holidayDates = spec.holidays ?? [];
  for (const dateKey of holidayDates) {
    await prisma.publicHoliday.create({
      data: { academicYearId: year.id, date: dateFromDateKey(dateKey), name: 'Statutory holiday' },
    });
  }

  if (spec.attendingEveryDay) {
    for (const dateKey of blockDateKeys) {
      await prisma.attendingEntry.create({
        data: {
          blockId: block.id,
          attendingName: `Attending ${(blockDateKeys.indexOf(dateKey) % 4) + 1}`,
          date: dateFromDateKey(dateKey),
          activityLabel: 'On call',
          isCallDay: true,
        },
      });
    }
  }

  return {
    tag,
    orgId: org.id,
    programId: program.id,
    academicYearId: year.id,
    blockId: block.id,
    blockDateKeys,
    startKey: spec.startKey,
    endKey,
    residents,
    residentByName: byName,
    academicDates,
    holidayDates,
    // Days the generator is expected to try to cover.
    coverableDateKeys: blockDateKeys.filter(
      dateKey => !holidayDates.includes(dateKey) && !academicDates.includes(dateKey),
    ),
  };
}

async function destroyScenario(orgId) {
  if (!orgId) return;
  const programs = await prisma.program.findMany({ where: { orgId }, select: { id: true } });
  const programIds = programs.map(row => row.id);
  const years = await prisma.academicYear.findMany({ where: { programId: { in: programIds } }, select: { id: true } });
  const yearIds = years.map(row => row.id);
  const blocks = await prisma.block.findMany({ where: { academicYearId: { in: yearIds } }, select: { id: true } });
  const blockIds = blocks.map(row => row.id);
  const callDays = await prisma.callDay.findMany({ where: { blockId: { in: blockIds } }, select: { id: true } });
  const callDayIds = callDays.map(row => row.id);

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
  const users = await prisma.user.findMany({ where: { orgId }, select: { id: true } });
  if (users.length) {
    await prisma.programMember.deleteMany({ where: { userId: { in: users.map(u => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } });
  }
  await prisma.organization.deleteMany({ where: { id: orgId } });
}

/** Per-resident call metrics for one block, used by acceptance and fairness. */
async function collectMetrics(scenario) {
  const assignments = await prisma.callAssignment.findMany({
    where: { callDay: { blockId: scenario.blockId } },
    include: { callDay: true, resident: true },
  });
  const program = await prisma.program.findUnique({ where: { id: scenario.programId } });

  const rows = new Map();
  for (const resident of scenario.residents) {
    rows.set(resident.id, {
      name: resident.name,
      role: resident.residentRole,
      isMedStudent: resident.isMedStudent,
      calls: 0,
      weekendCalls: 0,
      weekdayCalls: 0,
      homeCalls: 0,
      inHouseCalls: 0,
      dates: [],
    });
  }
  for (const assignment of assignments) {
    const row = rows.get(assignment.residentId);
    if (!row) continue;
    const key = normalizeDateKey(assignment.callDay.date);
    const weekend = [0, 6].includes(dayOfWeek(key));
    const inHouse = assignment.roleOnDay === 'senior'
      ? Boolean(program.seniorInHouseCall)
      : program.juniorInHouseCall !== false;
    row.calls += 1;
    row.dates.push(key);
    if (weekend) row.weekendCalls += 1; else row.weekdayCalls += 1;
    if (inHouse) row.inHouseCalls += 1; else row.homeCalls += 1;
  }
  for (const row of rows.values()) {
    row.dates.sort();
    row.weightedBurden = (3 * row.homeCalls) + (4 * row.inHouseCalls);
  }

  const assignedByDay = new Map();
  for (const assignment of assignments) {
    const key = normalizeDateKey(assignment.callDay.date);
    if (!assignedByDay.has(key)) assignedByDay.set(key, new Set());
    assignedByDay.get(key).add(assignment.roleOnDay);
  }
  const unfilledSlots = [];
  for (const dateKey of scenario.coverableDateKeys) {
    const roles = assignedByDay.get(dateKey) ?? new Set();
    if (!roles.has('senior')) unfilledSlots.push({ date: dateKey, roleOnDay: 'senior' });
    if (!roles.has('junior')) unfilledSlots.push({ date: dateKey, roleOnDay: 'junior' });
  }

  return { rows: [...rows.values()], unfilledSlots, totalAssignments: assignments.length };
}

function spread(values) {
  if (values.length === 0) return { min: 0, max: 0, range: 0, mean: 0, stdDev: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return {
    min,
    max,
    range: max - min,
    mean: Number(mean.toFixed(2)),
    stdDev: Number(Math.sqrt(variance).toFixed(2)),
  };
}

module.exports = {
  makeTag,
  buildScenario,
  destroyScenario,
  collectMetrics,
  spread,
  dateRange,
  vacationRange,
  dayOfWeek,
};
