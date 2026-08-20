const assert = require('node:assert/strict');
const { validateLoadedSchedule } = require('../services/scheduleValidator');

const resident = {
  id: 'validator-resident',
  name: 'Validator Resident',
  residentRole: 'senior',
  isMedStudent: false,
  isServiceResident: true,
  isActive: true,
};
const missing = {
  id: 'missing-resident',
  name: 'Missing Availability Resident',
  residentRole: 'junior',
  isMedStudent: false,
  isServiceResident: true,
  isActive: true,
};
const dateKeys = ['04', '05', '06', '08', '10', '12', '14', '16', '18', '20', '22'];
const callDays = dateKeys.map((day, index) => ({
  id: `day-${day}`,
  date: new Date(`2033-01-${day}T00:00:00.000Z`),
  assignments: [{
    id: `assignment-${day}`,
    residentId: resident.id,
    resident,
    roleOnDay: 'senior',
    isOverride: index < 3,
    overrideReason: index < 3 ? 'documented exception' : null,
  }],
}));
callDays.push({
  id: 'duplicate-day',
  date: new Date('2033-01-04T00:00:00.000Z'),
  assignments: [{
    id: 'duplicate-assignment',
    residentId: resident.id,
    resident,
    roleOnDay: 'junior',
    isOverride: true,
    overrideReason: 'documented exception',
  }],
});
callDays.push({
  id: 'missing-day',
  date: new Date('2033-01-03T00:00:00.000Z'),
  assignments: [{
    id: 'missing-assignment',
    residentId: missing.id,
    resident: missing,
    roleOnDay: 'junior',
    isOverride: true,
    overrideReason: 'legacy assignment',
  }],
});

const block = {
  id: 'validator-block',
  startDate: new Date('2033-01-01T00:00:00.000Z'),
  endDate: new Date('2033-01-28T00:00:00.000Z'),
  settings: { maxCallsPerResident: 2, maxCallsMedStudent: 0 },
  academicYear: {
    program: { juniorInHouseCall: true, seniorInHouseCall: false },
    holidays: [],
  },
  enrollments: [{
    id: 'validator-enrollment',
    residentId: resident.id,
    resident,
    vacationDates: [new Date('2033-01-05T00:00:00.000Z')],
    callCapOverride: null,
  }],
  activeServiceResidents: [resident, missing],
  flags: [],
  callDays,
};

const result = validateLoadedSchedule(block);
const codes = new Set(result.violations.map(item => item.code));
for (const code of [
  'VACATION_CONFLICT',
  'POST_CALL_BEFORE_VACATION',
  'CONSECUTIVE_CALL',
  'HOME_CALL_MAX_EXCEEDED',
  'BLENDED_CALL_MAX_EXCEEDED',
  'LOCAL_CALL_CAP_EXCEEDED',
  'DUPLICATE_RESIDENT_ON_DAY',
  'MISSING_RESIDENT_AVAILABILITY',
]) {
  assert(codes.has(code), `validator should report ${code}`);
}
assert.equal(result.compliant, false);
assert(result.violations.some(item => item.isOverride && item.overrideReasons.includes('documented exception')));
assert(result.warnings.some(item => item.code === 'MISSING_RESIDENT_AVAILABILITY'));

console.log('[schedule-validator-smoke] stored-schedule violation checks passed');
