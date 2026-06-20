const assert = require('assert');
const { HEADERS, createScheduleWorkbook } = require('../services/excelExport');

const forbiddenValues = [
  'private-id',
  'resident-private',
  'assignment-private',
  'call-day-private',
  'block-private',
  'program-private',
  'private@example.test',
  'private admin note',
  'override reason',
  'diagnostics',
  'snapshotJson',
];

const publicSchedule = {
  block: {
    number: 3,
    startDateKey: '2026-08-26',
    endDateKey: '2026-08-28',
    programName: 'Internal Medicine',
    specialty: 'Medicine',
    holidays: [{ dateKey: '2026-08-27', name: 'Public Holiday' }],
  },
  publishedAt: '2026-08-25T12:00:00.000Z',
  attendingEntries: [
    {
      id: 'private-id',
      blockId: 'block-private',
      dateKey: '2026-08-26',
      attendingName: 'Dr Safe',
      activityLabel: 'Ward',
      isCallDay: false,
      notes: 'private admin note',
    },
    {
      dateKey: '2026-08-26',
      attendingName: 'Dr Call',
      activityLabel: 'Call',
      isCallDay: true,
    },
  ],
  callDays: [
    {
      id: 'call-day-private',
      dateKey: '2026-08-26',
      assignments: [
        {
          id: 'assignment-private',
          residentId: 'resident-private',
          isOverride: true,
          overrideReason: 'override reason',
          roleOnDay: 'senior',
          resident: { id: 'resident-private', email: 'private@example.test', name: 'Resident Safe' },
        },
      ],
    },
  ],
  flags: [{ id: 'private-id', dateKey: '2026-08-28', label: 'Teaching', color: '#2563EB' }],
  diagnostics: 'diagnostics',
  snapshotJson: { blockId: 'block-private', programId: 'program-private' },
};

async function main() {
  const { workbook } = createScheduleWorkbook(publicSchedule, { includeNotes: false });
  assert(workbook, 'workbook should be created');

  const sheet = workbook.getWorksheet('Schedule');
  assert(sheet, 'Schedule sheet should exist');

  const headerValues = sheet.getRow(4).values.slice(1);
  assert.deepStrictEqual(headerValues, HEADERS, 'expected Excel headers should exist');

  const values = [];
  sheet.eachRow(row => {
    row.eachCell(cell => {
      if (cell.value !== null && cell.value !== undefined) values.push(String(cell.value));
    });
  });

  const joined = values.join('\n');
  for (const forbidden of forbiddenValues) {
    assert(!joined.includes(forbidden), `forbidden public Excel value leaked: ${forbidden}`);
  }
  assert(joined.includes('Resident Safe'), 'resident display name should be exported');
  assert(joined.includes('Dr Call'), 'attending call should be exported');

  const buffer = await workbook.xlsx.writeBuffer();
  assert(buffer.byteLength > 0, 'workbook buffer should be non-empty');

  console.log('[phase6-excel] workbook export checks passed');
}

main().catch(err => {
  console.error('[phase6-excel] failed:', err);
  process.exit(1);
});
