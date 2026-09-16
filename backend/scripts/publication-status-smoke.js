const assert = require('node:assert/strict');
const { canonicalSchedule, publicationState } = require('../services/publicationStatus');

const baseline = {
  block: { number: 1, startDate: '2026-03-07T00:00:00.000Z', endDate: '2026-03-10T00:00:00.000Z', programName: 'Program', specialty: 'Medicine', holidays: [{ date: '2026-03-08T00:00:00.000Z', name: 'Holiday' }] },
  attendingEntries: [{ id: 'a', date: '2026-03-08T00:00:00.000Z', attendingName: 'Dr. Long', activityLabel: 'Ward', isCallDay: false }],
  callDays: [{ id: 'day', date: '2026-03-08T00:00:00.000Z', isHoliday: true, holidayName: 'Holiday', assignments: [{ id: 'assignment', roleOnDay: 'senior', residentId: 'senior-a', resident: { id: 'senior-a', name: 'Dr. Resident' } }] }],
};
const clone = () => structuredClone(baseline);
const current = clone();
current.attendingEntries[0].id = 'new-row-id';
current.callDays[0].createdAt = '2030-01-01T00:00:00.000Z';
current.callDays[0].assignments[0].overrideReason = 'Administrative note';
assert.deepEqual(canonicalSchedule(current), canonicalSchedule(baseline));
assert.equal(publicationState({ isPublished: false }, null, current), 'never_published');
assert.equal(publicationState({ isPublished: true }, baseline, current), 'current');
assert.equal(publicationState({ isPublished: false }, baseline, current), 'unpublished');

for (const mutate of [
  draft => { draft.callDays[0].assignments[0].residentId = 'senior-b'; },
  draft => { draft.attendingEntries[0].activityLabel = 'Clinic'; },
  draft => { draft.attendingEntries[0].isCallDay = true; },
  draft => { draft.block.holidays[0].name = 'Changed holiday'; },
  draft => { draft.block.programName = 'Renamed program'; },
]) {
  const changed = clone();
  mutate(changed);
  assert.equal(publicationState({ isPublished: true }, baseline, changed), 'changes_unpublished');
  assert.equal(publicationState({ isPublished: true }, changed, changed), 'current');
}

console.log('Publication status canonical comparison: passed');
