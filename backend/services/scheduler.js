/**
 * MedRota Auto-Scheduler
 *
 * Generates non-override call assignments for a block while preserving manual
 * overrides. PARO eligibility is treated as a hard constraint: if no eligible
 * resident exists for a role/date, the date is left partially unassigned and a
 * warning is returned.
 */

const prisma = require('../lib/prisma');
const {
  normalizeDateKey,
  dateFromDateKey,
  addDaysToDateKey,
  isFridaySaturdaySunday,
  calculateDaysOnService,
  getInHouseMax,
  getHomeCallMax,
  getAssignmentCallType,
  calculateWeightedCallPoints,
  isBlendedCallLoadAllowed,
  calculateCompleteWeekendsOff,
  hasConsecutiveCall,
  hasConsecutiveHomeCallWeekend,
  violatesVacation,
  violatesPostCallBeforeVacation,
  requiredCompleteWeekendsOff,
  isAcademicDayLabel,
} = require('./paroRules');
const { minimumPositive, validateSchedule } = require('./scheduleValidator');
const { checkEligibility } = require('./eligibility');

function startOfLogicalDay(value) {
  const dateKey = normalizeDateKey(value);
  return dateFromDateKey(dateKey);
}

function buildDateKeys(startDate, endDate) {
  const dateKeys = [];
  const cursor = startOfLogicalDay(startDate);
  const end = startOfLogicalDay(endDate);

  while (cursor <= end) {
    dateKeys.push(normalizeDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dateKeys;
}

function vacationKeysFromEnrollment(enrollment) {
  return (enrollment.vacationDates ?? [])
    .map(normalizeDateKey)
    .filter(Boolean);
}

function makeResidentState(enrollment, blockDateKeys, cfg, availabilityComplete = true) {
  const vacationDateKeys = vacationKeysFromEnrollment(enrollment);
  const daysOnService = calculateDaysOnService(blockDateKeys, vacationDateKeys);
  const isMedStudent = Boolean(enrollment.resident.isMedStudent);

  return {
    id: enrollment.resident.id,
    name: enrollment.resident.name,
    role: enrollment.resident.residentRole,
    isMedStudent,
    isActive: enrollment.resident.isActive !== false,
    availabilityComplete,
    vacationDateKeys,
    daysOnService,
    inHouseMax: getInHouseMax(daysOnService),
    homeMax: getHomeCallMax(daysOnService),
    totalCallCap: minimumPositive(cfg.maxCallsPerResident, enrollment.callCapOverride),
    blockCallCap: minimumPositive(cfg.maxCallsPerResident),
    residentCallCap: minimumPositive(enrollment.callCapOverride),
    medStudentCallCap: isMedStudent ? cfg.maxCallsMedStudent : null,
    assignedDateKeys: new Set(),
    homeCallDateKeys: new Set(),
    inHouseCallDateKeys: new Set(),
    homeCalls: 0,
    inHouseCalls: 0,
    warnings: [],
    sortOrder: 0,
  };
}

function totalCalls(resident) {
  return resident.homeCalls + resident.inHouseCalls;
}

function incrementResidentCall(resident, dateKey, roleOnDay, programSettings) {
  const callType = getAssignmentCallType(roleOnDay, programSettings);
  resident.assignedDateKeys.add(dateKey);

  if (callType === 'in_house') {
    resident.inHouseCalls += 1;
    resident.inHouseCallDateKeys.add(dateKey);
  } else {
    resident.homeCalls += 1;
    resident.homeCallDateKeys.add(dateKey);
  }
}

function formatEligibilityReasons(reasons) {
  const counts = reasons.reduce((acc, reason) => {
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts)
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(', ');
}

// Eligibility lives in services/eligibility.js so the validator can explain an
// unfilled slot using exactly the rule that rejected each candidate.
function checkEligible(resident, dateKey, roleOnDay, programSettings, blockDateKeys) {
  return checkEligibility(resident, dateKey, roleOnDay, programSettings, blockDateKeys);
}

// Ties are common: on most days several residents sit on the same call count.
// Breaking them on raw roster index makes the generator prefer whoever the
// database happens to return first, every single day, which concentrates the
// leftover calls on a fixed roster position. Rotating the starting point by the
// day's ordinal keeps the choice fully deterministic while giving each position
// its turn at the front of the queue.
//
// The rotation is taken over the candidate's rank within its own role pool, not
// over the whole roster: rotating a pool of 4 juniors modulo an 8-person roster
// would advance their order unevenly and reintroduce the bias it is meant to
// remove.
function rotatedOrder(resident, rotation, poolSize) {
  const rank = resident.poolRank ?? resident.sortOrder;
  if (!poolSize) return rank;
  return ((rank - rotation) % poolSize + poolSize) % poolSize;
}

function sortCandidates(candidates, rotation = 0, poolSize = 0) {
  return candidates.sort((a, b) => {
    const callDelta = totalCalls(a) - totalCalls(b);
    if (callDelta !== 0) return callDelta;

    const weightDelta =
      calculateWeightedCallPoints(a.homeCalls, a.inHouseCalls)
      - calculateWeightedCallPoints(b.homeCalls, b.inHouseCalls);
    if (weightDelta !== 0) return weightDelta;

    const rotationDelta =
      rotatedOrder(a, rotation, poolSize) - rotatedOrder(b, rotation, poolSize);
    if (rotationDelta !== 0) return rotationDelta;

    return a.sortOrder - b.sortOrder;
  });
}

// Rank each resident within the pool they actually compete in.
function assignPoolRanks(pool) {
  const byRole = new Map();
  for (const resident of [...pool].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const key = resident.role;
    if (!byRole.has(key)) byRole.set(key, 0);
    resident.poolRank = byRole.get(key);
    resident.poolSize = 0;
    byRole.set(key, byRole.get(key) + 1);
  }
  for (const resident of pool) resident.poolSize = byRole.get(resident.role) ?? 0;
}

function buildSummaryRow(resident) {
  return {
    name: resident.name,
    role: resident.role,
    isMedStudent: resident.isMedStudent,
    calls: totalCalls(resident),
    homeCalls: resident.homeCalls,
    inHouseCalls: resident.inHouseCalls,
    daysOnService: resident.daysOnService,
    homeCallMax: resident.homeMax,
    inHouseCallMax: resident.inHouseMax,
    weightedCallPoints: calculateWeightedCallPoints(resident.homeCalls, resident.inHouseCalls),
    availabilityComplete: resident.availabilityComplete,
    localCallCap: resident.totalCallCap,
  };
}

async function generateSchedule(blockId) {
  const block = await prisma.block.findUnique({
    where: { id: blockId },
    include: {
      settings: true,
      academicYear: { include: { holidays: true, program: true } },
      enrollments: { include: { resident: true } },
      flags: true,
    },
  });

  if (!block) throw new Error(`Block ${blockId} not found`);

  const blockDateKeys = buildDateKeys(block.startDate, block.endDate);
  const programSettings = {
    juniorInHouseCall: block.academicYear?.program?.juniorInHouseCall ?? true,
    seniorInHouseCall: block.academicYear?.program?.seniorInHouseCall ?? false,
  };
  const cfg = {
    allowAttendingOnlyDays: block.settings?.allowAttendingOnlyDays ?? false,
    avoidAcademicDays: block.settings?.avoidAcademicDays ?? true,
    maxCallsMedStudent: block.settings?.maxCallsMedStudent ?? 5,
    maxCallsPerResident: block.settings?.maxCallsPerResident ?? 9,
  };

  console.log(`[scheduler] blockId=${blockId} number=${block.number}`);
  console.log(`[scheduler] dates=${blockDateKeys[0]} to ${blockDateKeys[blockDateKeys.length - 1]}`);
  console.log(`[scheduler] callTypes=${JSON.stringify(programSettings)} cfg=${JSON.stringify(cfg)}`);

  const holidaySet = new Set(
    block.academicYear.holidays
      .map(h => normalizeDateKey(h.date))
      .filter(Boolean)
  );
  const academicDaySet = new Set(
    (block.flags ?? [])
      .filter(f => isAcademicDayLabel(f.label))
      .map(f => normalizeDateKey(f.date))
      .filter(Boolean)
  );

  const programId = block.academicYear?.program?.id;
  const activeServiceResidents = programId
    ? await prisma.residentProfile.findMany({
        where: { programId, isActive: true, isServiceResident: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  const enrollmentByResidentId = new Map();
  for (const enrollment of block.enrollments) {
    enrollment._availabilityComplete = true;
    enrollmentByResidentId.set(enrollment.resident.id, enrollment);
  }
  const missingAvailabilityResidents = [];
  for (const resident of activeServiceResidents) {
    if (!enrollmentByResidentId.has(resident.id)) {
      missingAvailabilityResidents.push(resident);
      enrollmentByResidentId.set(resident.id, {
        resident,
        vacationDates: [],
        academicDayPref: null,
        callCapOverride: null,
        _availabilityComplete: false,
      });
    }
  }

  const enrollmentSource = [...enrollmentByResidentId.values()];
  const residents = enrollmentSource.map((enrollment, index) => ({
    ...makeResidentState(enrollment, blockDateKeys, cfg, enrollment._availabilityComplete !== false),
    sortOrder: index,
  }));

  const residentById = new Map(residents.map(resident => [resident.id, resident]));
  const regularResidents = residents.filter(resident =>
    !resident.isMedStudent && resident.isActive && resident.availabilityComplete
  );
  const medStudents = residents.filter(resident =>
    resident.isMedStudent && resident.isActive && resident.availabilityComplete
  );
  assignPoolRanks(regularResidents);
  assignPoolRanks(medStudents);

  // Every stored assignment is loaded, not only manual overrides. Callers that
  // want a fresh plan clear the generated rows first (POST /schedule/generate
  // does). Treating an already-filled slot as filled keeps generation
  // idempotent: running it twice is a no-op instead of writing a second
  // resident into the same role slot.
  const existingCallDays = await prisma.callDay.findMany({
    where: { blockId },
    include: { assignments: { include: { resident: true } } },
  });

  const existingByDateKey = new Map();
  const warnings = missingAvailabilityResidents.map(resident => ({
    code: 'MISSING_RESIDENT_AVAILABILITY',
    residentId: resident.id,
    residentName: resident.name,
    message: `${resident.name} was excluded from auto-generation because block enrollment/availability is incomplete.`,
    action: 'Complete block enrollment and vacation availability, then generate again.',
  }));

  for (const callDay of existingCallDays) {
    const dateKey = normalizeDateKey(callDay.date);
    const info = { callDay, hasSenior: false, hasJunior: false, assignments: callDay.assignments };

    for (const assignment of callDay.assignments) {
      if (assignment.roleOnDay === 'senior') info.hasSenior = true;
      if (assignment.roleOnDay === 'junior') info.hasJunior = true;

      const resident = residentById.get(assignment.residentId);
      if (!resident) continue;

      // Only a manual override deserves an override warning. A generated row
      // that survived because the caller did not clear is simply carried over.
      if (assignment.isOverride) {
        if (violatesVacation(dateKey, resident.vacationDateKeys)) {
          warnings.push({ date: dateKey, message: `Manual override for ${resident.name} falls on vacation` });
        }
        if (violatesPostCallBeforeVacation(dateKey, resident.vacationDateKeys)) {
          warnings.push({ date: dateKey, message: `Manual override for ${resident.name} is post-call before vacation` });
        }
        if (hasConsecutiveCall(dateKey, [...resident.assignedDateKeys])) {
          warnings.push({ date: dateKey, message: `Manual override for ${resident.name} creates consecutive call` });
        }
      }

      incrementResidentCall(resident, dateKey, assignment.roleOnDay, programSettings);
    }

    if (callDay.assignments.length > 0) existingByDateKey.set(dateKey, info);
  }

  const dayMap = new Map();

  async function assignResident({ callDayId, resident, dateKey, roleOnDay }) {
    await prisma.callAssignment.create({
      data: { callDayId, residentId: resident.id, roleOnDay },
    });
    incrementResidentCall(resident, dateKey, roleOnDay, programSettings);
  }

  function eligibleResidents(pool, roleOnDay, dateKey) {
    const eligible = [];
    const rejectedReasons = [];

    for (const resident of pool) {
      if (resident.role !== roleOnDay) continue;
      const check = checkEligible(resident, dateKey, roleOnDay, programSettings, blockDateKeys);
      if (check.ok) {
        eligible.push(resident);
      } else {
        rejectedReasons.push(check.reason);
        console.log(`  [skip] ${resident.name} (${roleOnDay}) on ${dateKey}: ${check.reason}`);
      }
    }

    // The day's ordinal in the block rotates which roster position wins a tie.
    const rotation = blockDateKeys.indexOf(dateKey);
    const poolSize = eligible[0]?.poolSize ?? 0;
    return { eligible: sortCandidates(eligible, rotation, poolSize), rejectedReasons };
  }

  for (const dateKey of blockDateKeys) {
    const date = dateFromDateKey(dateKey);
    const isHoliday = holidaySet.has(dateKey);
    const isAcademicDay = cfg.avoidAcademicDays && academicDaySet.has(dateKey);
    const existingInfo = existingByDateKey.get(dateKey);
    const callDay = existingInfo?.callDay ?? await prisma.callDay.upsert({
      where: { blockId_date: { blockId, date } },
      update: { isHoliday },
      create: { blockId, date, isHoliday },
    });

    let hasSenior = existingInfo?.hasSenior ?? false;
    let hasJunior = existingInfo?.hasJunior ?? false;
    dayMap.set(dateKey, { callDayId: callDay.id, hasSenior, hasJunior, skipped: false });

    if (isHoliday) {
      console.log(`[scheduler] ${dateKey} holiday - skipping generated assignments`);
      continue;
    }

    if (isAcademicDay) {
      warnings.push({ date: dateKey, message: 'Skipped academic day' });
      dayMap.get(dateKey).skipped = true;
      console.log(`[scheduler] ${dateKey} academic day - skipping generated assignments`);
      continue;
    }

    if (!hasSenior && !cfg.allowAttendingOnlyDays) {
      const { eligible, rejectedReasons } = eligibleResidents(regularResidents, 'senior', dateKey);
      if (eligible.length > 0) {
        await assignResident({ callDayId: callDay.id, resident: eligible[0], dateKey, roleOnDay: 'senior' });
        hasSenior = true;
        console.log(`  -> assigned senior: ${eligible[0].name}`);
      } else {
        const suffix = rejectedReasons.length ? ` (${formatEligibilityReasons(rejectedReasons)})` : '';
        warnings.push({ date: dateKey, message: `No PARO-eligible senior available${suffix}` });
      }
    }

    if (!hasJunior) {
      const { eligible, rejectedReasons } = eligibleResidents(regularResidents, 'junior', dateKey);
      if (eligible.length > 0) {
        await assignResident({ callDayId: callDay.id, resident: eligible[0], dateKey, roleOnDay: 'junior' });
        hasJunior = true;
        console.log(`  -> assigned junior: ${eligible[0].name}`);
      } else {
        const suffix = rejectedReasons.length ? ` (${formatEligibilityReasons(rejectedReasons)})` : '';
        warnings.push({ date: dateKey, message: `No PARO-eligible junior available${suffix}` });
      }
    }

    dayMap.get(dateKey).hasSenior = hasSenior;
    dayMap.get(dateKey).hasJunior = hasJunior;
  }

  if (medStudents.length > 0) {
    console.log(`[scheduler] Phase 2: assigning ${medStudents.length} med student(s) when junior coverage is empty`);

    for (const dateKey of blockDateKeys) {
      const info = dayMap.get(dateKey);
      if (!info || holidaySet.has(dateKey) || info.skipped) continue;
      if (!info.hasSenior || info.hasJunior) continue;

      const { eligible, rejectedReasons } = eligibleResidents(medStudents, 'junior', dateKey);
      if (eligible.length === 0) {
        const suffix = rejectedReasons.length ? ` (${formatEligibilityReasons(rejectedReasons)})` : '';
        warnings.push({ date: dateKey, message: `No PARO-eligible med student available${suffix}` });
        continue;
      }

      await assignResident({ callDayId: info.callDayId, resident: eligible[0], dateKey, roleOnDay: 'junior' });
      info.hasJunior = true;
      console.log(`  [med-student] assigned ${eligible[0].name} on ${dateKey}`);
    }
  }

  const workDays = blockDateKeys.filter(dateKey => !holidaySet.has(dateKey)).length;
  const assignedCount = [...dayMap.values()]
    .filter(info => info.hasSenior || info.hasJunior)
    .length;
  const unassignedDates = [...dayMap.entries()]
    .filter(([dateKey, info]) => !holidaySet.has(dateKey) && (!info.hasSenior || !info.hasJunior))
    .map(([dateKey]) => dateKey);
  const callSummary = residents
    .map(buildSummaryRow)
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));

  const validation = await validateSchedule(blockId);
  for (const item of validation?.violations ?? []) {
    if (!item.isOverride) continue;
    warnings.push({
      code: item.code,
      date: item.date,
      residentId: item.residentId,
      residentName: item.residentName,
      message: `Manual override: ${item.message}`,
      overrideReasons: item.overrideReasons,
    });
  }

  console.log(`[scheduler] done - assigned=${assignedCount}/${workDays} warnings=${warnings.length}`);
  console.log('[scheduler] call summary:', callSummary.map(r => `${r.name}(${r.calls})`).join(', '));

  return {
    totalDays: blockDateKeys.length,
    workDays,
    assigned: assignedCount,
    unassigned: unassignedDates.length,
    unassignedDates,
    warnings,
    callSummary,
    availabilityComplete: missingAvailabilityResidents.length === 0,
    excludedResidents: missingAvailabilityResidents.map(resident => ({
      residentId: resident.id,
      residentName: resident.name,
      reason: 'Missing block enrollment/availability',
    })),
  };
}

async function clearSchedule(blockId) {
  const callDays = await prisma.callDay.findMany({ where: { blockId } });
  const callDayIds = callDays.map(d => d.id);
  if (callDayIds.length > 0) {
    await prisma.callAssignment.deleteMany({ where: { callDayId: { in: callDayIds }, isOverride: false } });
  }
  const { count } = await prisma.callDay.deleteMany({ where: { blockId, assignments: { none: {} } } });
  return { cleared: count };
}

module.exports = { generateSchedule, clearSchedule };
