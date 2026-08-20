const prisma = require('../lib/prisma');
const {
  normalizeDateKey,
  dateFromDateKey,
  addDaysToDateKey,
  calculateDaysOnService,
  getInHouseMax,
  getHomeCallMax,
  getAssignmentCallType,
  calculateWeightedCallPoints,
  calculateCompleteWeekendsOff,
  getWeekendKey,
  isFridaySaturdaySunday,
  requiredCompleteWeekendsOff,
  violatesVacation,
  violatesPostCallBeforeVacation,
  isAcademicDayLabel,
} = require('./paroRules');
const { buildResidentState, applyAssignment, checkEligibility } = require('./eligibility');

// What each violation code means in plain language. The code stays the
// machine-readable contract; `rule`, `why` and `remedy` are what a Chief
// Resident actually needs in order to decide what to do.
const RULE_INFO = Object.freeze({
  DUPLICATE_RESIDENT_ON_DAY: {
    rule: 'One resident in two slots',
    why: 'The same person cannot cover both the senior and the junior slot on one day.',
    remedy: 'Open the day and give one of the two slots to someone else.',
  },
  DUPLICATE_ROLE_ON_DAY: {
    rule: 'Two residents in one slot',
    why: 'A call day has exactly one senior and one junior slot, so a duplicate makes the schedule ambiguous.',
    remedy: 'Open the day and remove the resident who should not be on call.',
  },
  MISSING_RESIDENT_AVAILABILITY: {
    rule: 'No block availability',
    why: 'This resident has no availability record for the block, so their vacation and call ceiling are unknown and cannot be respected.',
    remedy: 'Set block availability for them on the Residents page, then validate again.',
  },
  VACATION_CONFLICT: {
    rule: 'On vacation',
    why: 'The resident is on approved vacation on this date.',
    remedy: 'Assign someone else, or correct the vacation dates if they are wrong.',
  },
  POST_CALL_BEFORE_VACATION: {
    rule: 'Post-call into vacation',
    why: 'Being on call the night before vacation starts means the first vacation day is spent post-call.',
    remedy: 'Move this call a day earlier, or give it to another resident.',
  },
  CONSECUTIVE_CALL: {
    rule: 'Consecutive call',
    why: 'PARO does not allow call on two days in a row.',
    remedy: 'Move one of the two calls to a non-adjacent day.',
  },
  IN_HOUSE_MAX_EXCEEDED: {
    rule: 'Over the in-house call maximum',
    why: 'PARO caps in-house call by the number of days the resident is on service in the block.',
    remedy: 'Reassign one of their calls, or check whether their vacation dates are correct.',
  },
  HOME_CALL_MAX_EXCEEDED: {
    rule: 'Over the home-call maximum',
    why: 'PARO caps home call by the number of days the resident is on service in the block.',
    remedy: 'Reassign one of their calls, or check whether their vacation dates are correct.',
  },
  BLENDED_CALL_MAX_EXCEEDED: {
    rule: 'Over the blended call limit',
    why: 'Mixed home and in-house call is weighted 3 and 4 points and may not exceed 30 points in a block.',
    remedy: 'Reduce the resident total, especially their in-house calls, which weigh most.',
  },
  LOCAL_CALL_CAP_EXCEEDED: {
    rule: 'Over the program call ceiling',
    why: 'This is your own limit from block settings or this resident call cap, not a PARO rule.',
    remedy: 'Reassign a call, or raise the ceiling in Block Settings if the limit is wrong.',
  },
  MED_STUDENT_CALL_CAP_EXCEEDED: {
    rule: 'Over the medical-student call ceiling',
    why: 'Medical students have a separate, lower call limit set in block settings.',
    remedy: 'Reassign a call, or adjust the medical-student ceiling in Block Settings.',
  },
  INSUFFICIENT_WEEKENDS_OFF: {
    rule: 'Not enough weekends off',
    why: 'Every resident must keep a minimum number of complete weekends free in the block.',
    remedy: 'Free up a full Friday-to-Sunday weekend for this resident.',
  },
  CONSECUTIVE_HOME_WEEKENDS: {
    rule: 'Home call on consecutive weekends',
    why: 'Home call may not fall on two weekends in a row.',
    remedy: 'Move one of the two weekend calls to another resident or another weekend.',
  },
});

function describeRule(code) {
  return RULE_INFO[code] ?? {
    rule: code.replaceAll('_', ' ').toLowerCase(),
    why: 'This assignment breaks a scheduling rule.',
    remedy: 'Open the day and adjust the assignment.',
  };
}

function buildDateKeys(startDate, endDate) {
  const keys = [];
  const cursor = dateFromDateKey(normalizeDateKey(startDate));
  const end = dateFromDateKey(normalizeDateKey(endDate));
  while (cursor <= end) {
    keys.push(normalizeDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function minimumPositive(...values) {
  const valid = values.map(positiveInteger).filter(value => value !== null);
  return valid.length ? Math.min(...valid) : null;
}

function violation(code, resident, date, message, details = {}, assignments = []) {
  const overrideAssignments = assignments.filter(item => item.isOverride);
  const info = describeRule(code);
  return {
    code,
    severity: 'error',
    residentId: resident?.id ?? null,
    residentName: resident?.name ?? null,
    date: date ?? null,
    message,
    details,
    rule: info.rule,
    why: info.why,
    remedy: info.remedy,
    isOverride: overrideAssignments.length > 0,
    overrideReasons: [...new Set(overrideAssignments.map(item => item.overrideReason).filter(Boolean))],
  };
}

function warning(code, resident, date, message, details = {}) {
  const info = describeRule(code);
  return {
    code,
    severity: 'warning',
    residentId: resident?.id ?? null,
    residentName: resident?.name ?? null,
    date: date ?? null,
    message,
    details,
    rule: info.rule,
    why: info.why,
    remedy: info.remedy,
  };
}

async function loadScheduleBlock(blockId) {
  const block = await prisma.block.findUnique({
    where: { id: blockId },
    include: {
      settings: true,
      academicYear: { include: { program: true, holidays: true } },
      enrollments: { include: { resident: true } },
      flags: true,
      callDays: {
        orderBy: { date: 'asc' },
        include: { assignments: { include: { resident: true } } },
      },
    },
  });
  if (!block) return null;

  const programId = block.academicYear?.programId;
  block.activeServiceResidents = programId
    ? await prisma.residentProfile.findMany({
        where: { programId, isActive: true, isServiceResident: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  return block;
}

function buildVirtualAssignments(block, dayReplacement) {
  const flattened = (block.callDays ?? []).flatMap(callDay =>
    callDay.assignments.map(assignment => ({
      ...assignment,
      dateKey: normalizeDateKey(callDay.date),
    }))
  );
  if (!dayReplacement) return flattened;

  const targetDateKey = normalizeDateKey(dayReplacement.date);
  const retained = flattened.filter(item => item.dateKey !== targetDateKey);
  const residents = new Map();
  for (const enrollment of block.enrollments) residents.set(enrollment.resident.id, enrollment.resident);
  for (const resident of block.activeServiceResidents ?? []) residents.set(resident.id, resident);
  for (const item of flattened) residents.set(item.resident.id, item.resident);

  const replacements = [
    ...(dayReplacement.seniorId ? [{ residentId: dayReplacement.seniorId, roleOnDay: 'senior' }] : []),
    ...(dayReplacement.juniorId ? [{ residentId: dayReplacement.juniorId, roleOnDay: 'junior' }] : []),
  ].map((item, index) => ({
    id: `proposed-${item.roleOnDay}-${index}`,
    ...item,
    resident: residents.get(item.residentId),
    isOverride: true,
    overrideReason: dayReplacement.overrideReason ?? null,
    dateKey: targetDateKey,
  }));

  return [...retained, ...replacements];
}

/**
 * For each uncovered slot, work out which residents were considered and why
 * each one could not take it.
 *
 * The rules are replayed in date order against the stored schedule using the
 * same evaluator the generator uses, so the reasons shown are the reasons the
 * generator actually had, not a separate re-derivation of them.
 */
function analyzeUnfilledSlots(block, assignments, blockDateKeys, programSettings) {
  const settings = {
    maxCallsPerResident: block.settings?.maxCallsPerResident ?? 9,
    maxCallsMedStudent: block.settings?.maxCallsMedStudent ?? 5,
  };
  const enrollmentByResident = new Map((block.enrollments ?? []).map(item => [item.residentId, item]));
  const residentsById = new Map();
  for (const enrollment of block.enrollments ?? []) residentsById.set(enrollment.resident.id, enrollment.resident);
  for (const resident of block.activeServiceResidents ?? []) residentsById.set(resident.id, resident);

  const states = new Map();
  for (const resident of residentsById.values()) {
    states.set(resident.id, buildResidentState({
      resident,
      enrollment: enrollmentByResident.get(resident.id) ?? null,
      blockDateKeys,
      settings,
    }));
  }

  const assignmentsByDate = new Map();
  for (const assignment of assignments) {
    if (!assignmentsByDate.has(assignment.dateKey)) assignmentsByDate.set(assignment.dateKey, []);
    assignmentsByDate.get(assignment.dateKey).push(assignment);
  }

  const holidaySet = new Set((block.academicYear?.holidays ?? []).map(item => normalizeDateKey(item.date)));
  const academicDaySet = new Set(
    (block.flags ?? []).filter(item => isAcademicDayLabel(item.label)).map(item => normalizeDateKey(item.date))
  );
  const avoidAcademicDays = block.settings?.avoidAcademicDays ?? true;

  const unfilled = [];
  for (const dateKey of blockDateKeys) {
    const dayAssignments = assignmentsByDate.get(dateKey) ?? [];
    const filledRoles = new Set(dayAssignments.map(item => item.roleOnDay));
    const skipDay = holidaySet.has(dateKey) || (avoidAcademicDays && academicDaySet.has(dateKey));

    if (!skipDay) {
      for (const roleOnDay of ['senior', 'junior']) {
        if (filledRoles.has(roleOnDay)) continue;

        const candidates = [];
        for (const state of states.values()) {
          const isCandidateRole = state.role === roleOnDay || (roleOnDay === 'junior' && state.isMedStudent);
          if (!isCandidateRole) continue;
          const check = checkEligibility(state, dateKey, roleOnDay, programSettings, blockDateKeys);
          if (check.ok) continue;
          candidates.push({
            residentId: state.id,
            residentName: state.name,
            code: check.code,
            reason: check.label,
          });
        }
        unfilled.push({
          date: dateKey,
          roleOnDay,
          unavailableCount: candidates.length,
          candidates: candidates.sort((a, b) => a.residentName.localeCompare(b.residentName)),
        });
      }
    }

    // Advance state past this day so later days see the correct running load.
    for (const assignment of dayAssignments) {
      const state = states.get(assignment.residentId);
      if (state) applyAssignment(state, dateKey, assignment.roleOnDay, programSettings);
    }
  }
  return unfilled;
}

function validateLoadedSchedule(block, options = {}) {
  const blockDateKeys = buildDateKeys(block.startDate, block.endDate);
  const assignments = buildVirtualAssignments(block, options.dayReplacement);
  const programSettings = {
    juniorInHouseCall: block.academicYear?.program?.juniorInHouseCall ?? true,
    seniorInHouseCall: block.academicYear?.program?.seniorInHouseCall ?? false,
  };
  const enrollmentByResident = new Map((block.enrollments ?? []).map(item => [item.residentId, item]));
  const residentById = new Map();
  for (const enrollment of block.enrollments ?? []) residentById.set(enrollment.resident.id, enrollment.resident);
  for (const resident of block.activeServiceResidents ?? []) residentById.set(resident.id, resident);
  for (const assignment of assignments) {
    if (assignment.resident) residentById.set(assignment.residentId, assignment.resident);
  }

  const violations = [];
  const warnings = [];
  const residents = [];
  const assignmentGroupsByDay = new Map();
  for (const assignment of assignments) {
    if (!assignmentGroupsByDay.has(assignment.dateKey)) assignmentGroupsByDay.set(assignment.dateKey, []);
    assignmentGroupsByDay.get(assignment.dateKey).push(assignment);
  }

  for (const [dateKey, dayAssignments] of assignmentGroupsByDay) {
    const residentCounts = new Map();
    const roleCounts = new Map();
    for (const assignment of dayAssignments) {
      residentCounts.set(assignment.residentId, (residentCounts.get(assignment.residentId) ?? 0) + 1);
      roleCounts.set(assignment.roleOnDay, (roleCounts.get(assignment.roleOnDay) ?? 0) + 1);
    }
    for (const [residentId, count] of residentCounts) {
      if (count > 1) {
        const resident = residentById.get(residentId);
        const affected = dayAssignments.filter(item => item.residentId === residentId);
        violations.push(violation(
          'DUPLICATE_RESIDENT_ON_DAY', resident, dateKey,
          `${resident?.name ?? 'Resident'} occupies more than one call slot on ${dateKey}.`,
          { count }, affected,
        ));
      }
    }
    for (const [roleOnDay, count] of roleCounts) {
      if (count > 1 && ['senior', 'junior'].includes(roleOnDay)) {
        violations.push(violation(
          'DUPLICATE_ROLE_ON_DAY', null, dateKey,
          `More than one resident occupies the ${roleOnDay} slot on ${dateKey}.`,
          { roleOnDay, count }, dayAssignments.filter(item => item.roleOnDay === roleOnDay),
        ));
      }
    }
  }

  for (const resident of residentById.values()) {
    const enrollment = enrollmentByResident.get(resident.id) ?? null;
    const residentAssignments = assignments
      .filter(item => item.residentId === resident.id)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const vacationDateKeys = (enrollment?.vacationDates ?? []).map(normalizeDateKey).filter(Boolean);
    const daysOnService = enrollment ? calculateDaysOnService(blockDateKeys, vacationDateKeys) : null;
    const inHouseAssignments = residentAssignments.filter(
      item => getAssignmentCallType(item.roleOnDay, programSettings) === 'in_house'
    );
    const homeAssignments = residentAssignments.filter(
      item => getAssignmentCallType(item.roleOnDay, programSettings) === 'home'
    );
    const assignedDateKeys = [...new Set(residentAssignments.map(item => item.dateKey))].sort();
    const inHouseMax = daysOnService === null ? null : getInHouseMax(daysOnService);
    const homeCallMax = daysOnService === null ? null : getHomeCallMax(daysOnService);
    const blockCap = positiveInteger(block.settings?.maxCallsPerResident);
    const residentCap = positiveInteger(enrollment?.callCapOverride);
    const localCap = minimumPositive(blockCap, residentCap);
    const medStudentCap = resident.isMedStudent ? nonNegativeInteger(block.settings?.maxCallsMedStudent) : null;

    if (!enrollment && resident.isServiceResident && resident.isActive) {
      const message = `${resident.name} has no block enrollment/availability record.`;
      warnings.push(warning('MISSING_RESIDENT_AVAILABILITY', resident, null, message, {
        action: 'Complete block enrollment and vacation availability before generation.',
      }));
      if (residentAssignments.length > 0) {
        violations.push(violation(
          'MISSING_RESIDENT_AVAILABILITY', resident, residentAssignments[0].dateKey,
          `${resident.name} is assigned despite missing trusted block availability.`,
          { assignmentCount: residentAssignments.length }, residentAssignments,
        ));
      }
    }

    for (const assignment of residentAssignments) {
      if (enrollment && violatesVacation(assignment.dateKey, vacationDateKeys)) {
        violations.push(violation(
          'VACATION_CONFLICT', resident, assignment.dateKey,
          `${resident.name} is assigned while on vacation.`, {}, [assignment],
        ));
      }
      if (enrollment && violatesPostCallBeforeVacation(assignment.dateKey, vacationDateKeys)) {
        violations.push(violation(
          'POST_CALL_BEFORE_VACATION', resident, assignment.dateKey,
          `${resident.name} would be post-call on the first day of vacation.`,
          { vacationStarts: addDaysToDateKey(assignment.dateKey, 1) }, [assignment],
        ));
      }
    }

    for (let index = 1; index < assignedDateKeys.length; index += 1) {
      if (assignedDateKeys[index - 1] === addDaysToDateKey(assignedDateKeys[index], -1)) {
        const affected = residentAssignments.filter(item =>
          item.dateKey === assignedDateKeys[index - 1] || item.dateKey === assignedDateKeys[index]
        );
        violations.push(violation(
          'CONSECUTIVE_CALL', resident, assignedDateKeys[index],
          `${resident.name} has consecutive call periods.`,
          { previousDate: assignedDateKeys[index - 1] }, affected,
        ));
      }
    }

    if (inHouseMax !== null && inHouseAssignments.length > inHouseMax) {
      violations.push(violation(
        'IN_HOUSE_MAX_EXCEEDED', resident, inHouseAssignments.at(-1)?.dateKey,
        `${resident.name} exceeds the in-house call maximum.`,
        { actual: inHouseAssignments.length, limit: inHouseMax, daysOnService }, inHouseAssignments,
      ));
    }
    if (homeCallMax !== null && homeAssignments.length > homeCallMax) {
      violations.push(violation(
        'HOME_CALL_MAX_EXCEEDED', resident, homeAssignments.at(-1)?.dateKey,
        `${resident.name} exceeds the home-call maximum.`,
        { actual: homeAssignments.length, limit: homeCallMax, daysOnService }, homeAssignments,
      ));
    }

    const weightedCallPoints = calculateWeightedCallPoints(homeAssignments.length, inHouseAssignments.length);
    if (weightedCallPoints > 30) {
      violations.push(violation(
        'BLENDED_CALL_MAX_EXCEEDED', resident, residentAssignments.at(-1)?.dateKey,
        `${resident.name} exceeds the blended call limit.`,
        { actual: weightedCallPoints, limit: 30, homeCalls: homeAssignments.length, inHouseCalls: inHouseAssignments.length },
        residentAssignments,
      ));
    }

    if (localCap !== null && residentAssignments.length > localCap) {
      violations.push(violation(
        'LOCAL_CALL_CAP_EXCEEDED', resident, residentAssignments.at(-1)?.dateKey,
        `${resident.name} exceeds the configured local call ceiling.`,
        { actual: residentAssignments.length, limit: localCap, blockCap, residentCap }, residentAssignments,
      ));
    }
    if (medStudentCap !== null && residentAssignments.length > medStudentCap) {
      violations.push(violation(
        'MED_STUDENT_CALL_CAP_EXCEEDED', resident, residentAssignments.at(-1)?.dateKey,
        `${resident.name} exceeds the medical-student call ceiling.`,
        { actual: residentAssignments.length, limit: medStudentCap }, residentAssignments,
      ));
    }

    const requiredWeekends = requiredCompleteWeekendsOff(blockDateKeys);
    const completeWeekendsOff = calculateCompleteWeekendsOff(assignedDateKeys, blockDateKeys);
    if (requiredWeekends > 0 && completeWeekendsOff < requiredWeekends) {
      const weekendAssignments = residentAssignments.filter(item => isFridaySaturdaySunday(item.dateKey));
      violations.push(violation(
        'INSUFFICIENT_WEEKENDS_OFF', resident, weekendAssignments.at(-1)?.dateKey,
        `${resident.name} has fewer than ${requiredWeekends} complete weekends off.`,
        { actual: completeWeekendsOff, required: requiredWeekends }, weekendAssignments,
      ));
    }

    const homeWeekendAssignments = homeAssignments.filter(item => isFridaySaturdaySunday(item.dateKey));
    const homeWeekendKeys = [...new Set(homeWeekendAssignments.map(item => getWeekendKey(item.dateKey)))].sort();
    for (let index = 1; index < homeWeekendKeys.length; index += 1) {
      if (homeWeekendKeys[index - 1] === addDaysToDateKey(homeWeekendKeys[index], -7)) {
        const affected = homeWeekendAssignments.filter(item => {
          const key = getWeekendKey(item.dateKey);
          return key === homeWeekendKeys[index - 1] || key === homeWeekendKeys[index];
        });
        violations.push(violation(
          'CONSECUTIVE_HOME_WEEKENDS', resident, homeWeekendKeys[index],
          `${resident.name} has home call on consecutive weekends.`,
          { previousWeekend: homeWeekendKeys[index - 1] }, affected,
        ));
      }
    }

    residents.push({
      residentId: resident.id,
      residentName: resident.name,
      residentRole: resident.residentRole,
      isMedStudent: resident.isMedStudent,
      availabilityComplete: Boolean(enrollment),
      daysOnService,
      calls: residentAssignments.length,
      homeCalls: homeAssignments.length,
      inHouseCalls: inHouseAssignments.length,
      homeCallMax,
      inHouseCallMax: inHouseMax,
      localCallCap: localCap,
      weightedCallPoints,
      completeWeekendsOff,
    });
  }

  const holidaySet = new Set((block.academicYear?.holidays ?? []).map(item => normalizeDateKey(item.date)));
  const academicDaySet = new Set(
    (block.flags ?? []).filter(item => isAcademicDayLabel(item.label)).map(item => normalizeDateKey(item.date))
  );
  const days = blockDateKeys.map(dateKey => {
    const dayAssignments = assignmentGroupsByDay.get(dateKey) ?? [];
    return {
      date: dateKey,
      isHoliday: holidaySet.has(dateKey),
      isAcademicDay: academicDaySet.has(dateKey),
      seniorAssigned: dayAssignments.some(item => item.roleOnDay === 'senior'),
      juniorAssigned: dayAssignments.some(item => item.roleOnDay === 'junior'),
    };
  });

  return {
    blockId: block.id,
    compliant: violations.length === 0,
    violations,
    warnings,
    residents: residents.sort((a, b) => a.residentName.localeCompare(b.residentName)),
    days,
    unfilledSlots: analyzeUnfilledSlots(block, assignments, blockDateKeys, programSettings),
  };
}

function violationFingerprint(item) {
  return [item.code, item.residentId ?? '', item.date ?? '', JSON.stringify(item.details ?? {})].join('|');
}

async function validateSchedule(blockId) {
  const block = await loadScheduleBlock(blockId);
  if (!block) return null;
  return validateLoadedSchedule(block);
}

async function validateProposedDayAssignments(blockId, dayReplacement) {
  const block = await loadScheduleBlock(blockId);
  if (!block) return null;
  const current = validateLoadedSchedule(block);
  const proposed = validateLoadedSchedule(block, { dayReplacement });
  const existing = new Set(current.violations.map(violationFingerprint));
  return {
    current,
    proposed,
    violations: proposed.violations.filter(item => !existing.has(violationFingerprint(item))),
  };
}

module.exports = {
  buildDateKeys,
  positiveInteger,
  nonNegativeInteger,
  minimumPositive,
  validateLoadedSchedule,
  validateSchedule,
  validateProposedDayAssignments,
};
