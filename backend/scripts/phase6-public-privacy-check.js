const assert = require('assert');
const { shapePublicSchedule } = require('../services/publicScheduleShape');

const FORBIDDEN_KEYS = new Set([
  'id',
  'userId',
  'residentId',
  'residentProfileId',
  'assignmentId',
  'callDayId',
  'blockId',
  'programId',
  'organizationId',
  'email',
  'isOverride',
  'overrideReason',
  'diagnostics',
  'snapshotJson',
]);

function collectForbiddenKeys(value, path = '$', hits = []) {
  if (!value || typeof value !== 'object') return hits;

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeys(item, `${path}[${index}]`, hits));
    return hits;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_KEYS.has(key)) hits.push(childPath);
    collectForbiddenKeys(child, childPath, hits);
  }
  return hits;
}

const dirtySnapshot = {
  block: {
    id: 'block-private',
    programId: 'program-private',
    organizationId: 'org-private',
    number: 6,
    startDate: '2026-07-01T00:00:00.000Z',
    endDate: '2026-07-03T00:00:00.000Z',
    programName: 'Internal Medicine',
    specialty: 'Medicine',
    diagnostics: { warnings: ['private'] },
    holidays: [
      {
        id: 'holiday-private',
        academicYearId: 'year-private',
        date: '2026-07-01T00:00:00.000Z',
        name: 'Public Holiday',
      },
    ],
  },
  attendingEntries: [
    {
      id: 'attending-private',
      blockId: 'block-private',
      date: '2026-07-01T00:00:00.000Z',
      attendingName: 'Dr Public',
      activityLabel: 'Ward',
      notes: 'internal note',
      isCallDay: true,
    },
  ],
  callDays: [
    {
      id: 'call-day-private',
      blockId: 'block-private',
      date: '2026-07-01T00:00:00.000Z',
      isHoliday: true,
      holidayName: 'Public Holiday',
      assignments: [
        {
          id: 'assignment-private',
          assignmentId: 'assignment-private',
          callDayId: 'call-day-private',
          residentId: 'resident-private',
          residentProfileId: 'resident-private',
          roleOnDay: 'senior',
          isOverride: true,
          overrideReason: 'private reason',
          resident: {
            id: 'resident-private',
            programId: 'program-private',
            name: 'Resident Public',
            email: 'private@example.test',
            residentRole: 'senior',
          },
        },
      ],
    },
  ],
};

const dirtyFlags = [
  {
    id: 'flag-private',
    blockId: 'block-private',
    date: '2026-07-02T00:00:00.000Z',
    label: 'Clinic',
    color: '#2563EB',
  },
];

const shaped = shapePublicSchedule({
  snapshot: dirtySnapshot,
  publishedAt: '2026-07-04T12:00:00.000Z',
  flags: dirtyFlags,
});

const hits = collectForbiddenKeys(shaped);
assert.deepStrictEqual(hits, [], `Forbidden public keys leaked: ${hits.join(', ')}`);
assert.strictEqual(shaped.block.programName, 'Internal Medicine');
assert.strictEqual(shaped.callDays[0].assignments[0].resident.name, 'Resident Public');
assert.strictEqual(shaped.callDays[0].assignments[0].status, 'assigned');

console.log('[phase6-public-privacy] public schedule shape passed');
