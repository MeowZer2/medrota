const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeDateKey(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function dateFromDateKey(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function addDaysToDateKey(dateKey, days) {
  const date = dateFromDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return normalizeDateKey(date);
}

function isWeekendDateKey(dateKey) {
  const day = dateFromDateKey(dateKey).getUTCDay();
  return day === 0 || day === 6;
}

function isFridaySaturdaySunday(dateKey) {
  const day = dateFromDateKey(dateKey).getUTCDay();
  return day === 5 || day === 6 || day === 0;
}

function calculateDaysOnService(blockDateKeys, vacationDateKeys = []) {
  const vacationSet = new Set([...vacationDateKeys].map(normalizeDateKey).filter(Boolean));
  return blockDateKeys
    .map(normalizeDateKey)
    .filter(Boolean)
    .filter(dateKey => !vacationSet.has(dateKey))
    .length;
}

function getRangeMax(daysOnService, ranges, lowDivisor, highMax) {
  if (daysOnService <= 0) return 0;
  const found = ranges.find(([min, max]) => daysOnService >= min && daysOnService <= max);
  if (found) return found[2];
  if (daysOnService < ranges[0][0]) return Math.max(1, Math.floor(daysOnService / lowDivisor));
  return highMax;
}

function getInHouseMax(daysOnService) {
  return getRangeMax(daysOnService, [
    [19, 22, 5],
    [23, 26, 6],
    [27, 29, 7],
    [30, 34, 8],
    [35, 38, 9],
  ], 4, 9);
}

function getHomeCallMax(daysOnService) {
  return getRangeMax(daysOnService, [
    [17, 19, 6],
    [20, 22, 7],
    [23, 25, 8],
    [26, 28, 9],
    [29, 30, 10],
  ], 3, 10);
}

function getAssignmentCallType(roleOnDay, programSettings = {}) {
  if (roleOnDay === 'senior') {
    return programSettings.seniorInHouseCall ? 'in_house' : 'home';
  }
  return programSettings.juniorInHouseCall === false ? 'home' : 'in_house';
}

function calculateWeightedCallPoints(homeCalls = 0, inHouseCalls = 0) {
  return (3 * homeCalls) + (4 * inHouseCalls);
}

function isBlendedCallLoadAllowed(homeCalls = 0, inHouseCalls = 0, limit = 30) {
  return calculateWeightedCallPoints(homeCalls, inHouseCalls) <= limit;
}

function getWeekendKey(dateKey) {
  const date = dateFromDateKey(dateKey);
  const day = date.getUTCDay();
  if (day === 5) return normalizeDateKey(date);
  if (day === 6) return addDaysToDateKey(dateKey, -1);
  if (day === 0) return addDaysToDateKey(dateKey, -2);
  return dateKey;
}

function getCompleteWeekendKeys(blockDateKeys) {
  const blockSet = new Set(blockDateKeys.map(normalizeDateKey).filter(Boolean));
  const weekendKeys = new Set();

  for (const dateKey of blockSet) {
    const date = dateFromDateKey(dateKey);
    if (date.getUTCDay() !== 5) continue;

    const saturday = addDaysToDateKey(dateKey, 1);
    const sunday = addDaysToDateKey(dateKey, 2);
    if (blockSet.has(saturday) && blockSet.has(sunday)) {
      weekendKeys.add(dateKey);
    }
  }

  return [...weekendKeys].sort();
}

function calculateCompleteWeekendsOff(assignmentDateKeys = [], blockDateKeys = []) {
  const assignedWeekendKeys = new Set(
    assignmentDateKeys
      .map(normalizeDateKey)
      .filter(Boolean)
      .filter(isFridaySaturdaySunday)
      .map(getWeekendKey)
  );

  return getCompleteWeekendKeys(blockDateKeys)
    .filter(weekendKey => !assignedWeekendKeys.has(weekendKey))
    .length;
}

function hasConsecutiveCall(candidateDateKey, assignmentDateKeys = []) {
  const assigned = new Set(assignmentDateKeys.map(normalizeDateKey).filter(Boolean));
  return assigned.has(addDaysToDateKey(candidateDateKey, -1))
    || assigned.has(addDaysToDateKey(candidateDateKey, 1));
}

function hasConsecutiveHomeCallWeekend(candidateDateKey, assignmentDateKeys = []) {
  if (!isFridaySaturdaySunday(candidateDateKey)) return false;

  const candidateWeekend = getWeekendKey(candidateDateKey);
  const previousWeekend = addDaysToDateKey(candidateWeekend, -7);
  const nextWeekend = addDaysToDateKey(candidateWeekend, 7);
  const assignedWeekendKeys = new Set(
    assignmentDateKeys
      .map(normalizeDateKey)
      .filter(Boolean)
      .filter(isFridaySaturdaySunday)
      .map(getWeekendKey)
  );

  return assignedWeekendKeys.has(previousWeekend) || assignedWeekendKeys.has(nextWeekend);
}

function violatesVacation(candidateDateKey, vacationDateKeys = []) {
  const vacationSet = new Set(vacationDateKeys.map(normalizeDateKey).filter(Boolean));
  return vacationSet.has(candidateDateKey);
}

function violatesPostCallBeforeVacation(candidateDateKey, vacationDateKeys = []) {
  const vacationSet = new Set(vacationDateKeys.map(normalizeDateKey).filter(Boolean));
  return vacationSet.has(addDaysToDateKey(candidateDateKey, 1));
}

function requiredCompleteWeekendsOff(blockDateKeys = []) {
  const completeWeekendCount = getCompleteWeekendKeys(blockDateKeys).length;
  if (completeWeekendCount === 0) return 0;
  return Math.min(2, Math.ceil(completeWeekendCount / 2));
}

function isAcademicDayLabel(label) {
  return typeof label === 'string' && /academic/i.test(label);
}

module.exports = {
  normalizeDateKey,
  dateFromDateKey,
  addDaysToDateKey,
  isWeekendDateKey,
  isFridaySaturdaySunday,
  calculateDaysOnService,
  getInHouseMax,
  getHomeCallMax,
  getAssignmentCallType,
  calculateWeightedCallPoints,
  isBlendedCallLoadAllowed,
  getWeekendKey,
  getCompleteWeekendKeys,
  calculateCompleteWeekendsOff,
  hasConsecutiveCall,
  hasConsecutiveHomeCallWeekend,
  violatesVacation,
  violatesPostCallBeforeVacation,
  requiredCompleteWeekendsOff,
  isAcademicDayLabel,
};
