const assert = require('assert');

const blockId = 'phase5-block';
const dates = ['2026-01-01', '2026-01-02', '2026-01-03'];
const dateObj = iso => new Date(`${iso}T00:00:00.000Z`);

const residents = [
  { id: 'senior-override', programId: 'program-1', name: 'Senior Override', residentRole: 'senior', isMedStudent: false, isActive: true, isServiceResident: true, createdAt: dateObj('2025-01-01') },
  { id: 'junior-override', programId: 'program-1', name: 'Junior Override', residentRole: 'junior', isMedStudent: false, isActive: true, isServiceResident: true, createdAt: dateObj('2025-01-02') },
  { id: 'senior-generated', programId: 'program-1', name: 'Senior Generated', residentRole: 'senior', isMedStudent: false, isActive: true, isServiceResident: true, createdAt: dateObj('2025-01-03') },
  { id: 'junior-generated', programId: 'program-1', name: 'Junior Generated', residentRole: 'junior', isMedStudent: false, isActive: true, isServiceResident: true, createdAt: dateObj('2025-01-04') },
  { id: 'med-student', programId: 'program-1', name: 'Med Student', residentRole: 'junior', isMedStudent: true, isActive: true, isServiceResident: true, createdAt: dateObj('2025-01-05') },
];

const existingCallDays = [
  {
    id: 'call-day-override',
    blockId,
    date: dateObj(dates[0]),
    assignments: [
      { id: 'override-senior', callDayId: 'call-day-override', residentId: 'senior-override', roleOnDay: 'senior', isOverride: true, resident: residents[0] },
      { id: 'override-junior', callDayId: 'call-day-override', residentId: 'junior-override', roleOnDay: 'junior', isOverride: true, resident: residents[1] },
    ],
  },
];

const createdCallDays = [];
const createdAssignments = [];
const deleteManyCalls = [];

const prisma = {
  block: {
    findUnique: async () => ({
      id: blockId,
      number: 1,
      startDate: dateObj(dates[0]),
      endDate: dateObj(dates[2]),
      settings: {
        maxCallsPerResident: 1,
        maxCallsMedStudent: 0,
        allowWeekendConsecutive: false,
        avoidAcademicDays: true,
        limitWeekendCalls: true,
      },
      academicYear: {
        holidays: [],
        program: { id: 'program-1' },
      },
      enrollments: residents.map((resident, index) => ({
        id: `enrollment-${index + 1}`,
        blockId,
        residentId: resident.id,
        resident,
        vacationDates: [],
        academicDayPref: null,
        callCapOverride: null,
      })),
      flags: [{ id: 'academic-flag', blockId, date: dateObj(dates[1]), label: 'Academic day', color: '#F59E0B' }],
    }),
  },
  residentProfile: {
    findMany: async () => residents,
  },
  callDay: {
    findMany: async (args = {}) => {
      if (args.include?.assignments?.where?.isOverride) return existingCallDays;
      return [...existingCallDays, ...createdCallDays];
    },
    create: async ({ data }) => {
      const row = { id: `created-call-day-${createdCallDays.length + 1}`, ...data, assignments: [] };
      createdCallDays.push(row);
      return row;
    },
    upsert: async ({ where, update, create }) => {
      const key = where.blockId_date;
      const existing = [...existingCallDays, ...createdCallDays].find(row =>
        row.blockId === key.blockId && row.date.getTime() === key.date.getTime()
      );
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row = { id: `created-call-day-${createdCallDays.length + 1}`, ...create, assignments: [] };
      createdCallDays.push(row);
      return row;
    },
    deleteMany: async (args) => {
      deleteManyCalls.push({ model: 'callDay', args });
      return { count: 1 };
    },
  },
  callAssignment: {
    create: async ({ data }) => {
      const row = { id: `created-assignment-${createdAssignments.length + 1}`, ...data };
      createdAssignments.push(row);
      return row;
    },
    deleteMany: async (args) => {
      deleteManyCalls.push({ model: 'callAssignment', args });
      return { count: 2 };
    },
  },
};

const prismaPath = require.resolve('../lib/prisma');
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: prisma };

const { generateSchedule, clearSchedule } = require('../services/scheduler');

async function main() {
  const summary = await generateSchedule(blockId);

  assert.strictEqual(summary.assigned, 2, 'override day and generated day should count as assigned');
  assert.deepStrictEqual(summary.unassignedDates, [dates[1]], 'academic day should be reported unassigned');
  assert(summary.warnings.some(w => w.date === dates[1] && /academic/i.test(w.message)), 'academic day warning should be returned');

  const byResident = new Map(summary.callSummary.map(r => [r.name, r.calls]));
  assert.strictEqual(byResident.get('Senior Override'), 1, 'manual override senior should count toward call totals');
  assert.strictEqual(byResident.get('Junior Override'), 1, 'manual override junior should count toward call totals');
  assert.strictEqual(byResident.get('Med Student'), 0, 'maxCallsMedStudent=0 should prevent med student assignment');

  assert(createdAssignments.every(a => a.isOverride !== true), 'generated assignments must not be marked as overrides');
  assert(!createdAssignments.some(a => a.callDayId === 'call-day-override'), 'generate must not add assignments to an override-covered day');

  const allAssignments = [
    ...existingCallDays.flatMap(d => d.assignments.map(a => ({ ...a, date: dates[0] }))),
    ...createdAssignments.map(a => {
      const day = createdCallDays.find(d => d.id === a.callDayId);
      return { ...a, date: day.date.toISOString().slice(0, 10) };
    }),
  ];
  for (const day of dates) {
    const dayAssignments = allAssignments.filter(a => a.date === day);
    assert.strictEqual(new Set(dayAssignments.map(a => a.residentId)).size, dayAssignments.length, `duplicate resident on ${day}`);
    assert(dayAssignments.filter(a => a.roleOnDay === 'junior').length <= 1, `more than one junior on ${day}`);
  }

  await clearSchedule(blockId);
  const assignmentDelete = deleteManyCalls.find(c => c.model === 'callAssignment');
  const callDayDelete = deleteManyCalls.find(c => c.model === 'callDay');
  assert.strictEqual(assignmentDelete.args.where.isOverride, false, 'clearSchedule should delete generated assignments only');
  assert.deepStrictEqual(callDayDelete.args.where.assignments, { none: {} }, 'clearSchedule should delete only empty CallDays');

  console.log('Phase 5 smoke checks passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
