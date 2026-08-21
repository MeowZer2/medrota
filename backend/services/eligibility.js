// Shared PARO eligibility evaluation.
//
// The generator uses this to choose a resident; the validator uses the same
// code to explain why an unfilled slot could not be filled. Keeping one
// implementation means the explanation shown to a Chief Resident is always the
// real reason the generator skipped someone, not a re-description of it.

const {
  isFridaySaturdaySunday,
  getInHouseMax,
  getHomeCallMax,
  getAssignmentCallType,
  calculateWeightedCallPoints,
  isBlendedCallLoadAllowed,
  calculateCompleteWeekendsOff,
  calculateDaysOnService,
  hasConsecutiveCall,
  hasConsecutiveHomeCallWeekend,
  violatesVacation,
  violatesPostCallBeforeVacation,
  requiredCompleteWeekendsOff,
  normalizeDateKey,
} = require('./paroRules');

// Machine-readable rejection codes with the wording a Chief Resident reads.
const REJECTION_LABELS = Object.freeze({
  VACATION: 'On vacation',
  POST_CALL_BEFORE_VACATION: 'Would be post-call on the first day of vacation',
  CONSECUTIVE_CALL: 'Already on call the day before or after',
  LOCAL_CALL_CAP: 'At the block call ceiling',
  MED_STUDENT_CALL_CAP: 'At the medical-student call ceiling',
  IN_HOUSE_MAX: 'At the PARO in-house call maximum',
  HOME_CALL_MAX: 'At the PARO home-call maximum',
  CONSECUTIVE_HOME_WEEKENDS: 'Would create home call on consecutive weekends',
  BLENDED_CALL_LOAD: 'At the blended call-load limit',
  INSUFFICIENT_WEEKENDS_OFF: 'Needs this weekend off to keep the required weekends free',
  ROLE_MISMATCH: 'Not eligible for this slot',
  MISSING_AVAILABILITY: 'No block availability on record',
  INACTIVE: 'Not an active resident',
  OTHER_UNAVAILABLE: 'Unavailable for this block day',
  ACADEMIC_FULL_DAY: 'Protected for a full academic day',
});

function rejectionLabel(code) {
  return REJECTION_LABELS[code] ?? 'Not eligible';
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function smallestPositive(...values) {
  const valid = values.map(positiveInteger).filter(value => value !== null);
  return valid.length ? Math.min(...valid) : null;
}

/**
 * Build the mutable per-resident state the eligibility rules read.
 *
 * `enrollment` may be null, which marks the resident as having no trusted block
 * availability.
 */
function buildResidentState({ resident, enrollment, blockDateKeys, settings = {} }) {
  const vacationDateKeys = (enrollment?.vacationDates ?? []).map(normalizeDateKey).filter(Boolean);
  const otherUnavailableDateKeys = (enrollment?.otherUnavailableDates ?? []).map(normalizeDateKey).filter(Boolean);
  const daysOnService = calculateDaysOnService(blockDateKeys, [...vacationDateKeys, ...otherUnavailableDateKeys]);
  const isMedStudent = Boolean(resident.isMedStudent);

  return {
    id: resident.id,
    name: resident.name,
    role: resident.residentRole,
    isMedStudent,
    isActive: resident.isActive !== false,
    availabilityComplete: Boolean(enrollment),
    vacationDateKeys,
    otherUnavailableDateKeys,
    academicTimes: Array.isArray(enrollment?.academicTimes) ? enrollment.academicTimes : [],
    avoidAcademicDays: settings.avoidAcademicDays !== false,
    daysOnService,
    inHouseMax: getInHouseMax(daysOnService),
    homeMax: getHomeCallMax(daysOnService),
    totalCallCap: smallestPositive(settings.maxCallsPerResident, enrollment?.callCapOverride),
    medStudentCallCap: isMedStudent ? (settings.maxCallsMedStudent ?? null) : null,
    assignedDateKeys: new Set(),
    homeCallDateKeys: new Set(),
    inHouseCallDateKeys: new Set(),
    homeCalls: 0,
    inHouseCalls: 0,
    sortOrder: 0,
  };
}

function totalCalls(state) {
  return state.homeCalls + state.inHouseCalls;
}

function applyAssignment(state, dateKey, roleOnDay, programSettings) {
  const callType = getAssignmentCallType(roleOnDay, programSettings);
  state.assignedDateKeys.add(dateKey);
  if (callType === 'in_house') {
    state.inHouseCalls += 1;
    state.inHouseCallDateKeys.add(dateKey);
  } else {
    state.homeCalls += 1;
    state.homeCallDateKeys.add(dateKey);
  }
}

/**
 * Can this resident take this slot on this date?
 *
 * Returns { ok: true, callType } or { ok: false, code, reason, label }.
 * `reason` keeps the compact form used in generator logs and warning text;
 * `code` and `label` are for anything that has to be read by a person.
 */
function checkEligibility(state, dateKey, roleOnDay, programSettings, blockDateKeys) {
  const reject = (code, reason) => ({ ok: false, code, reason: reason ?? code, label: rejectionLabel(code) });

  if (!state.isActive) return reject('INACTIVE', 'inactive');
  if (!state.availabilityComplete) return reject('MISSING_AVAILABILITY', 'missing-availability');
  if (state.role !== roleOnDay && !(roleOnDay === 'junior' && state.isMedStudent)) {
    return reject('ROLE_MISMATCH', 'role-mismatch');
  }
  if (violatesVacation(dateKey, state.vacationDateKeys)) return reject('VACATION', 'vacation');
  if (violatesVacation(dateKey, state.otherUnavailableDateKeys ?? [])) return reject('OTHER_UNAVAILABLE', 'other-unavailable');
  if (state.avoidAcademicDays && (state.academicTimes ?? []).some(entry => {
    if (entry?.period !== 'Full day') return false;
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${dateKey}T00:00:00.000Z`));
    return entry.day === weekday;
  })) return reject('ACADEMIC_FULL_DAY', 'academic-full-day');
  if (violatesPostCallBeforeVacation(dateKey, state.vacationDateKeys)) {
    return reject('POST_CALL_BEFORE_VACATION', 'post-call-before-vacation');
  }
  if (hasConsecutiveCall(dateKey, [...state.assignedDateKeys])) {
    return reject('CONSECUTIVE_CALL', 'consecutive-call');
  }

  const callType = getAssignmentCallType(roleOnDay, programSettings);
  const nextHomeCalls = state.homeCalls + (callType === 'home' ? 1 : 0);
  const nextInHouseCalls = state.inHouseCalls + (callType === 'in_house' ? 1 : 0);
  const nextTotalCalls = nextHomeCalls + nextInHouseCalls;

  if (state.totalCallCap !== null && nextTotalCalls > state.totalCallCap) {
    return reject('LOCAL_CALL_CAP', `block-call-cap(${totalCalls(state)}/${state.totalCallCap})`);
  }
  if (state.medStudentCallCap !== null && nextTotalCalls > state.medStudentCallCap) {
    return reject('MED_STUDENT_CALL_CAP', `med-student-cap(${totalCalls(state)}/${state.medStudentCallCap})`);
  }
  if (callType === 'in_house' && nextInHouseCalls > state.inHouseMax) {
    return reject('IN_HOUSE_MAX', `in-house-cap(${state.inHouseCalls}/${state.inHouseMax})`);
  }
  if (callType === 'home' && nextHomeCalls > state.homeMax) {
    return reject('HOME_CALL_MAX', `home-call-cap(${state.homeCalls}/${state.homeMax})`);
  }
  if (callType === 'home' && hasConsecutiveHomeCallWeekend(dateKey, [...state.homeCallDateKeys])) {
    return reject('CONSECUTIVE_HOME_WEEKENDS', 'consecutive-home-call-weekends');
  }
  if (!isBlendedCallLoadAllowed(nextHomeCalls, nextInHouseCalls)) {
    return reject('BLENDED_CALL_LOAD', 'blended-call-load');
  }

  const requiredWeekendsOff = requiredCompleteWeekendsOff(blockDateKeys);
  if (requiredWeekendsOff > 0 && isFridaySaturdaySunday(dateKey)) {
    const weekendsOff = calculateCompleteWeekendsOff([...state.assignedDateKeys, dateKey], blockDateKeys);
    if (weekendsOff < requiredWeekendsOff) {
      return reject('INSUFFICIENT_WEEKENDS_OFF', `complete-weekends-off(${weekendsOff}/${requiredWeekendsOff})`);
    }
  }

  return { ok: true, callType };
}

module.exports = {
  REJECTION_LABELS,
  rejectionLabel,
  buildResidentState,
  applyAssignment,
  checkEligibility,
  totalCalls,
  smallestPositive,
  calculateWeightedCallPoints,
};
