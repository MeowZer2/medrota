const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { ROLES } = require('../lib/roles');

const PASSWORD = 'QA_only_password_123!';
const ORG_NAME = 'MedRota QA';
const PROGRAM_NAME = 'QA Vascular Surgery';
const START = new Date(Date.UTC(2026, 5, 15));
const END = new Date(Date.UTC(2026, 5, 28));

const USERS = [
  {
    name: 'QA_ONLY Chief Resident QA',
    email: 'qa-chief@medrota.local',
    role: ROLES.CHIEF_RESIDENT,
  },
  {
    name: 'QA_ONLY Program Admin QA',
    email: 'qa-admin@medrota.local',
    role: ROLES.PROGRAM_ADMIN,
  },
  {
    name: 'QA_ONLY Program Director QA',
    email: 'qa-director@medrota.local',
    role: ROLES.PROGRAM_DIRECTOR,
  },
  {
    name: 'QA_ONLY Viewer QA',
    email: 'qa-viewer@medrota.local',
    role: ROLES.VIEWER,
  },
];

const RESIDENTS = [
  { name: 'QA_ONLY Senior Resident', pgyLevel: 'PGY-4', residentRole: 'senior', email: 'qa-senior@medrota.local', isMedStudent: false },
  { name: 'QA_ONLY Junior Resident', pgyLevel: 'PGY-2', residentRole: 'junior', email: 'qa-junior@medrota.local', isMedStudent: false },
  { name: 'QA_ONLY Med Student', pgyLevel: 'MS4', residentRole: 'junior', email: 'qa-medstudent@medrota.local', isMedStudent: true },
  { name: 'QA_ONLY Alternate Senior', pgyLevel: 'PGY-5', residentRole: 'senior', email: 'qa-alt-senior@medrota.local', isMedStudent: false },
  { name: 'QA_ONLY Alternate Junior', pgyLevel: 'PGY-1', residentRole: 'junior', email: 'qa-alt-junior@medrota.local', isMedStudent: false },
];

function day(offset) {
  const d = new Date(START);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

async function findOrCreateOrganization() {
  const existing = await prisma.organization.findFirst({ where: { name: ORG_NAME } });
  if (existing) {
    return prisma.organization.update({
      where: { id: existing.id },
      data: { country: 'US', status: 'active' },
    });
  }
  return prisma.organization.create({
    data: { name: ORG_NAME, country: 'US', status: 'active' },
  });
}

async function findOrCreateProgram(orgId) {
  const existing = await prisma.program.findFirst({ where: { name: PROGRAM_NAME, orgId } });
  if (existing) {
    return prisma.program.update({
      where: { id: existing.id },
      data: { specialty: 'Vascular Surgery' },
    });
  }
  return prisma.program.create({
    data: { name: PROGRAM_NAME, specialty: 'Vascular Surgery', orgId },
  });
}

async function findOrCreateAcademicYear(programId) {
  const existing = await prisma.academicYear.findFirst({
    where: { programId, startDate: START },
  });
  if (existing) {
    return prisma.academicYear.update({
      where: { id: existing.id },
      data: { endDate: END },
    });
  }
  return prisma.academicYear.create({
    data: { programId, startDate: START, endDate: END },
  });
}

async function findOrCreateBlock(academicYearId) {
  const existing = await prisma.block.findFirst({ where: { academicYearId, number: 1 } });
  if (existing) {
    return prisma.block.update({
      where: { id: existing.id },
      data: { startDate: START, endDate: END, isPublished: true },
    });
  }
  return prisma.block.create({
    data: { academicYearId, number: 1, startDate: START, endDate: END, isPublished: true },
  });
}

async function upsertBlockSettings(blockId) {
  return prisma.blockSettings.upsert({
    where: { blockId },
    update: {
      maxCallsPerResident: 5,
      maxCallsMedStudent: 1,
      allowWeekendConsecutive: false,
      allowAttendingOnlyDays: true,
      avoidAcademicDays: true,
      limitWeekendCalls: true,
    },
    create: {
      blockId,
      maxCallsPerResident: 5,
      maxCallsMedStudent: 1,
      allowWeekendConsecutive: false,
      allowAttendingOnlyDays: true,
      avoidAcademicDays: true,
      limitWeekendCalls: true,
    },
  });
}

async function upsertUser(user, orgId, passwordHash) {
  return prisma.user.upsert({
    where: { email: user.email },
    update: {
      name: user.name,
      passwordHash,
      org: { connect: { id: orgId } },
    },
    create: {
      name: user.name,
      email: user.email,
      passwordHash,
      org: { connect: { id: orgId } },
    },
  });
}

async function upsertMembership(programId, userId, role) {
  const existing = await prisma.programMember.findFirst({ where: { programId, userId } });
  if (existing) {
    return prisma.programMember.update({ where: { id: existing.id }, data: { role } });
  }
  return prisma.programMember.create({ data: { programId, userId, role } });
}

async function upsertResident(programId, resident) {
  const existing = await prisma.residentProfile.findFirst({
    where: { programId, name: resident.name },
  });
  const data = {
    pgyLevel: resident.pgyLevel,
    residentRole: resident.residentRole,
    email: resident.email,
    isMedStudent: resident.isMedStudent,
    isServiceResident: true,
    isActive: true,
  };
  if (existing) {
    return prisma.residentProfile.update({ where: { id: existing.id }, data });
  }
  return prisma.residentProfile.create({ data: { programId, name: resident.name, ...data } });
}

async function upsertRoster(programId, attendingName, typicalActivities) {
  const existing = await prisma.attendingRoster.findFirst({ where: { programId, attendingName } });
  if (existing) {
    return prisma.attendingRoster.update({ where: { id: existing.id }, data: { typicalActivities } });
  }
  return prisma.attendingRoster.create({ data: { programId, attendingName, typicalActivities } });
}

async function upsertAttendingEntry(blockId, date, attendingName, activityLabel, isCallDay) {
  const existing = await prisma.attendingEntry.findFirst({
    where: { blockId, date, attendingName, activityLabel },
  });
  const data = { notes: 'QA_ONLY seed data', isCallDay };
  if (existing) {
    return prisma.attendingEntry.update({ where: { id: existing.id }, data });
  }
  return prisma.attendingEntry.create({
    data: { blockId, date, attendingName, activityLabel, ...data },
  });
}

async function upsertCallDay(blockId, date, attendingEntryId) {
  const existing = await prisma.callDay.findFirst({ where: { blockId, date } });
  if (existing) {
    return prisma.callDay.update({ where: { id: existing.id }, data: { attendingEntryId } });
  }
  return prisma.callDay.create({ data: { blockId, date, attendingEntryId } });
}

async function upsertAssignment(callDayId, residentId, roleOnDay) {
  const conflictingQaAssignments = await prisma.callAssignment.findMany({
    where: {
      callDayId,
      roleOnDay,
      residentId: { not: residentId },
      resident: { name: { startsWith: 'QA_ONLY' } },
    },
    select: { id: true },
  });
  if (conflictingQaAssignments.length > 0) {
    await prisma.callAssignment.deleteMany({
      where: { id: { in: conflictingQaAssignments.map(a => a.id) } },
    });
  }

  const existing = await prisma.callAssignment.findFirst({ where: { callDayId, residentId } });
  const data = { roleOnDay, isOverride: true, overrideReason: 'QA_ONLY seed' };
  if (existing) {
    return prisma.callAssignment.update({ where: { id: existing.id }, data });
  }
  return prisma.callAssignment.create({ data: { callDayId, residentId, ...data } });
}

async function upsertFlag(blockId, date) {
  const existing = await prisma.dayFlag.findFirst({ where: { blockId, date, label: 'QA_ONLY Flag' } });
  const data = { color: '#14B8A6' };
  if (existing) {
    return prisma.dayFlag.update({ where: { id: existing.id }, data });
  }
  return prisma.dayFlag.create({ data: { blockId, date, label: 'QA_ONLY Flag', ...data } });
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed QA data when NODE_ENV=production');
  }

  const org = await findOrCreateOrganization();
  const program = await findOrCreateProgram(org.id);
  const academicYear = await findOrCreateAcademicYear(program.id);
  const block = await findOrCreateBlock(academicYear.id);
  await upsertBlockSettings(block.id);

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  for (const user of USERS) {
    const saved = await upsertUser(user, org.id, passwordHash);
    await upsertMembership(program.id, saved.id, user.role);
  }

  const residents = {};
  for (const resident of RESIDENTS) {
    const saved = await upsertResident(program.id, resident);
    residents[resident.name] = saved;
  }

  await upsertRoster(program.id, 'QA_ONLY Dr Avery', ['Clinic', 'OR']);
  await upsertRoster(program.id, 'QA_ONLY Dr Blake', ['Ward']);

  const callAttending = await upsertAttendingEntry(block.id, day(0), 'QA_ONLY Dr Avery', 'Ward', true);
  await upsertAttendingEntry(block.id, day(1), 'QA_ONLY Dr Blake', 'Clinic', false);
  const callDay = await upsertCallDay(block.id, day(0), callAttending.id);
  await upsertAssignment(callDay.id, residents['QA_ONLY Senior Resident'].id, 'senior');
  await upsertAssignment(callDay.id, residents['QA_ONLY Junior Resident'].id, 'junior');
  await upsertFlag(block.id, day(2));

  console.log('[dev:seed-qa] QA data ready');
  console.log(JSON.stringify({
    organization: ORG_NAME,
    program: PROGRAM_NAME,
    block: 'Block 1, 2026-06-15 to 2026-06-28',
    users: USERS.map(u => ({ email: u.email, role: u.role })),
    password: PASSWORD,
  }, null, 2));
  console.log('[dev:seed-qa] Password hashes were not printed. Only QA_ONLY records were created/updated.');
}

main()
  .catch(err => {
    console.error('[dev:seed-qa] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
