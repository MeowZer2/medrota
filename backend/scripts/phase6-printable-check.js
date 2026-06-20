const assert = require('assert');
const { createPrintableScheduleHtml } = require('../services/printableSchedule');

const forbiddenPublicValues = [
  'private-id',
  'resident-private',
  'assignment-private',
  'call-day-private',
  'block-private',
  'program-private',
  'private@example.test',
  'private admin note',
  'override reason',
  'isOverride',
  'overrideReason',
  'diagnostics',
  'snapshotJson',
];

const baseSchedule = {
  block: {
    number: 4,
    startDateKey: '2026-09-01',
    endDateKey: '2026-09-03',
    programName: 'Internal Medicine',
    specialty: 'Medicine',
    holidays: [{ id: 'private-id', dateKey: '2026-09-02', name: 'Public Holiday' }],
  },
  publishedAt: '2026-08-31T12:00:00.000Z',
  attendingEntries: [
    {
      id: 'private-id',
      blockId: 'block-private',
      dateKey: '2026-09-01',
      attendingName: 'Dr Ward',
      activityLabel: 'Ward',
      isCallDay: false,
      notes: 'private admin note',
    },
    {
      dateKey: '2026-09-01',
      attendingName: 'Dr Call',
      activityLabel: 'Call',
      isCallDay: true,
    },
  ],
  callDays: [
    {
      id: 'call-day-private',
      blockId: 'block-private',
      dateKey: '2026-09-01',
      assignments: [
        {
          id: 'assignment-private',
          residentId: 'resident-private',
          isOverride: true,
          overrideReason: 'override reason',
          roleOnDay: 'senior',
          resident: {
            id: 'resident-private',
            email: 'private@example.test',
            name: 'Resident Safe',
          },
        },
      ],
    },
  ],
  flags: [{ id: 'private-id', dateKey: '2026-09-03', label: 'Teaching', color: '#2563EB' }],
  diagnostics: 'diagnostics',
  snapshotJson: { blockId: 'block-private', programId: 'program-private' },
};

const publicSchedule = {
  block: baseSchedule.block,
  publishedAt: baseSchedule.publishedAt,
  attendingEntries: baseSchedule.attendingEntries.map(({ dateKey, attendingName, activityLabel, isCallDay }) => ({
    dateKey,
    attendingName,
    activityLabel,
    isCallDay,
  })),
  callDays: baseSchedule.callDays.map(callDay => ({
    dateKey: callDay.dateKey,
    assignments: callDay.assignments.map(assignment => ({
      roleOnDay: assignment.roleOnDay,
      resident: { name: assignment.resident.name },
    })),
  })),
  flags: baseSchedule.flags.map(({ dateKey, label, color }) => ({ dateKey, label, color })),
};

const protectedSchedule = {
  ...publicSchedule,
  attendingEntries: baseSchedule.attendingEntries,
};

function assertPrintableBasics(html) {
  assert(html.startsWith('<!doctype html>'), 'printable HTML should be a complete document');
  for (const header of ['Date', 'Day', 'Holiday / Flag', 'Attending Call', 'Attending Activities', 'Senior Resident', 'Junior Resident / Med Student', 'Status / Notes']) {
    assert(html.includes(header), `missing printable header: ${header}`);
  }
  assert(html.includes('Resident Safe'), 'resident display name should render');
  assert(html.includes('Dr Call'), 'attending call should render');
  assert(html.includes('<tr>'), 'schedule rows should render');
}

const publicHtml = createPrintableScheduleHtml(publicSchedule, { includeNotes: false });
assertPrintableBasics(publicHtml);
for (const forbidden of forbiddenPublicValues) {
  assert(!publicHtml.includes(forbidden), `forbidden public printable value leaked: ${forbidden}`);
}

const protectedHtml = createPrintableScheduleHtml(protectedSchedule, { includeNotes: true });
assertPrintableBasics(protectedHtml);
assert(protectedHtml.includes('private admin note'), 'protected printable output may include operational notes');
assert(!protectedHtml.includes('private@example.test'), 'protected printable output should not include emails');
assert(!protectedHtml.includes('override reason'), 'protected printable output should not include override reasons');

console.log('[phase6-printable] printable HTML checks passed');
