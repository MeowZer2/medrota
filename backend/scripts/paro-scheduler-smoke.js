const assert = require('assert');

const {
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
} = require('../services/paroRules');

const blockDates = [
  '2026-07-03',
  '2026-07-04',
  '2026-07-05',
  '2026-07-10',
  '2026-07-11',
  '2026-07-12',
  '2026-07-17',
  '2026-07-18',
  '2026-07-19',
  '2026-07-24',
  '2026-07-25',
  '2026-07-26',
];

assert.strictEqual(getInHouseMax(19), 5, '19-22 in-house days should allow 5 calls');
assert.strictEqual(getInHouseMax(26), 6, '23-26 in-house days should allow 6 calls');
assert.strictEqual(getInHouseMax(29), 7, '27-29 in-house days should allow 7 calls');
assert.strictEqual(getInHouseMax(34), 8, '30-34 in-house days should allow 8 calls');
assert.strictEqual(getInHouseMax(38), 9, '35-38 in-house days should allow 9 calls');

assert.strictEqual(getHomeCallMax(17), 6, '17-19 home-call days should allow 6 calls');
assert.strictEqual(getHomeCallMax(22), 7, '20-22 home-call days should allow 7 calls');
assert.strictEqual(getHomeCallMax(25), 8, '23-25 home-call days should allow 8 calls');
assert.strictEqual(getHomeCallMax(28), 9, '26-28 home-call days should allow 9 calls');
assert.strictEqual(getHomeCallMax(30), 10, '29-30 home-call days should allow 10 calls');

assert.strictEqual(calculateDaysOnService(['2026-07-01', '2026-07-02'], ['2026-07-02']), 1);
assert.strictEqual(getAssignmentCallType('junior', { juniorInHouseCall: true, seniorInHouseCall: false }), 'in_house');
assert.strictEqual(getAssignmentCallType('senior', { juniorInHouseCall: true, seniorInHouseCall: false }), 'home');
assert.strictEqual(getAssignmentCallType('senior', { seniorInHouseCall: true }), 'in_house');
assert.strictEqual(calculateWeightedCallPoints(3, 4), 25);
assert.strictEqual(isBlendedCallLoadAllowed(3, 5), true);
assert.strictEqual(isBlendedCallLoadAllowed(2, 7), false);

assert.strictEqual(hasConsecutiveCall('2026-07-02', ['2026-07-01']), true);
assert.strictEqual(hasConsecutiveCall('2026-07-02', ['2026-07-04']), false);
assert.strictEqual(hasConsecutiveHomeCallWeekend('2026-07-10', ['2026-07-03']), true);
assert.strictEqual(hasConsecutiveHomeCallWeekend('2026-07-17', ['2026-07-03']), false);
assert.strictEqual(violatesVacation('2026-07-02', ['2026-07-02']), true);
assert.strictEqual(violatesPostCallBeforeVacation('2026-07-01', ['2026-07-02']), true);
assert.strictEqual(requiredCompleteWeekendsOff(blockDates), 2);
assert.strictEqual(calculateCompleteWeekendsOff(['2026-07-03', '2026-07-10'], blockDates), 2);
assert.strictEqual(calculateCompleteWeekendsOff(['2026-07-03', '2026-07-10', '2026-07-17'], blockDates), 1);

console.log('PARO scheduler smoke checks passed');
