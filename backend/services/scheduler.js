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
} = require('./paroRules');

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

function makeResidentState(enrollment, blockDateKeys, cfg) {
  const vacationDateKeys = vacationKeysFromEnrollment(enrollment);
  const daysOnService = calculateDaysOnService(blockDateKeys, vacationDateKeys);
  const isMedStudent = Boolean(enrollment.resident.isMedStudent);

  return {
    id: enrollment.resident.id,
    name: enrollment.resident.name,
    role: enrollment.resident.residentRole,
    isMedStudent,
    vacationDateKeys,
    daysOnService,
    inHouseMax: getInHouseMax(daysOnService),
    homeMax: getHomeCallMax(daysOnService),
    totalCallCap: enrollment.callCapOverride ?? null,
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

function checkEligible(resident, dateKey, roleOnDay, programSettings, blockDateKeys) {
  if (violatesVacation(dateKey, resident.vacationDateKeys)) return { ok: false, reason: 'vacation' };
  if (violatesPostCallBeforeVacation(dateKey, resident.vacationDateKeys)) return { ok: false, reason: 'post-call-before-vacation' };
  if (hasConsecutiveCall(dateKey, [...resident.assignedDateKeys])) return { ok: false, reason: 'consecutive-call' };

  const callType = getAssignmentCallType(roleOnDay, programSettings);
  const nextHomeCalls = resident.homeCalls + (callType === 'home' ? 1 : 0);
  const nextInHouseCalls = resident.inHouseCalls + (callType === 'in_house' ? 1 : 0);
  const nextTotalCalls = nextHomeCalls + nextInHouseCalls;

  if (resident.totalCallCap !== null && nextTotalCalls > resident.totalCallCap) {
    return { ok: false, reason: `block-call-cap(${totalCalls(resident)}/${resident.totalCallCap})` };
  }

  if (resident.medStudentCallCap !== null && nextTotalCalls > resident.medStudentCallCap) {
    return { ok: false, reason: `med-student-cap(${totalCalls(resident)}/${resident.medStudentCallCap})` };
  }

  if (callType === 'in_house' && nextInHouseCalls > resident.inHouseMax) {
    return { ok: false, reason: `in-house-cap(${resident.inHouseCalls}/${resident.inHouseMax})` };
  }

  if (callType === 'home' && nextHomeCalls > resident.homeMax) {
    return { ok: false, reason: `home-call-cap(${resident.homeCalls}/${resident.homeMax})` };
  }

  if (callType === 'home' && hasConsecutiveHomeCallWeekend(dateKey, [...resident.homeCallDateKeys])) {
    return { ok: false, reason: 'consecutive-home-call-weekends' };
  }

  if (!isBlendedCallLoadAllowed(nextHomeCalls, nextInHouseCalls)) {
    return { ok: false, reason: 'blended-call-load' };
  }

  const requiredWeekendsOff = requiredCompleteWeekendsOff(blockDateKeys);
  if (requiredWeekendsOff > 0 && isFridaySaturdaySunday(dateKey)) {
    const weekendsOff = calculateCompleteWeekendsOff([...resident.assignedDateKeys, dateKey], blockDateKeys);
    if (weekendsOff < requiredWeekendsOff) {
      return { ok: false, reason: `complete-weekends-off(${weekendsOff}/${requiredWeekendsOff})` };
    }
  }

  return { ok: true, callType };
}

function sortCandidates(candidates) {
  return candidates.sort((a, b) => {
    const callDelta = totalCalls(a) - totalCalls(b);
    if (callDelta !== 0) return callDelta;

    const weightDelta =
      calculateWeightedCallPoints(a.homeCalls, a.inHouseCalls)
      - calculateWeightedCallPoints(b.homeCalls, b.inHouseCalls);
    if (weightDelta !== 0) return weightDelta;

    return a.sortOrder - b.sortOrder;
  });
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
      .filter(f => /academic/i.test(f.label ?? ''))
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
    enrollmentByResidentId.set(enrollment.resident.id, enrollment);
  }
  for (const resident of activeServiceResidents) {
    if (!enrollmentByResidentId.has(resident.id)) {
      enrollmentByResidentId.set(resident.id, {
        resident,
        vacationDates: [],
        academicDayPref: null,
        callCapOverride: null,
      });
    }
  }

  const enrollmentSource = [...enrollmentByResidentId.values()];
  const usedFallback = enrollmentSource.length > block.enrollments.length;
  const residents = enrollmentSource.map((enrollment, index) => ({
    ...makeResidentState(enrollment, blockDateKeys, cfg),
    sortOrder: index,
  }));

  const residentById = new Map(residents.map(resident => [resident.id, resident]));
  const regularResidents = residents.filter(resident => !resident.isMedStudent);
  const medStudents = residents.filter(resident => resident.isMedStudent);

  const existingCallDays = await prisma.callDay.findMany({
    where: { blockId },
    include: {
      assignments: {
        where: { isOverride: true },
        include: { resident: true },
      },
    },
  });

  const overrideByDateKey = new Map();
  const warnings = [];

  for (const callDay of existingCallDays) {
    const dateKey = normalizeDateKey(callDay.date);
    const info = { callDay, hasSenior: false, hasJunior: false, assignments: callDay.assignments };

    for (const assignment of callDay.assignments) {
      if (assignment.roleOnDay === 'senior') info.hasSenior = true;
      if (assignment.roleOnDay === 'junior') info.hasJunior = true;

      const resident = residentById.get(assignment.residentId);
      if (!resident) continue;

      if (violatesVacation(dateKey, resident.vacationDateKeys)) {
        warnings.push({ date: dateKey, message: `Manual override for ${resident.name} falls on vacation` });
      }
      if (violatesPostCallBeforeVacation(dateKey, resident.vacationDateKeys)) {
        warnings.push({ date: dateKey, message: `Manual override for ${resident.name} is post-call before vacation` });
      }
      if (hasConsecutiveCall(dateKey, [...resident.assignedDateKeys])) {
        warnings.push({ date: dateKey, message: `Manual override for ${resident.name} creates consecutive call` });
      }

      incrementResidentCall(resident, dateKey, assignment.roleOnDay, programSettings);
    }

    if (callDay.assignments.length > 0) overrideByDateKey.set(dateKey, info);
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

    return { eligible: sortCandidates(eligible), rejectedReasons };
  }

  for (const dateKey of blockDateKeys) {
    const date = dateFromDateKey(dateKey);
    const isHoliday = holidaySet.has(dateKey);
    const isAcademicDay = cfg.avoidAcademicDays && academicDaySet.has(dateKey);
    const overrideInfo = overrideByDateKey.get(dateKey);
    const callDay = overrideInfo?.callDay ?? await prisma.callDay.create({
      data: { blockId, date, isHoliday },
    });

    let hasSenior = overrideInfo?.hasSenior ?? false;
    let hasJunior = overrideInfo?.hasJunior ?? false;
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
    usedFallback,
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
