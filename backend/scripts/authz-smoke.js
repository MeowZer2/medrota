require('dotenv').config();

const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const app = require('../index');

const tag = `AUTHZ_ONLY_${Date.now()}_${Math.random().toString(16).slice(2)}`;

async function cleanup(orgIds, userIds) {
  const programs = await prisma.program.findMany({ where: { orgId: { in: orgIds } }, select: { id: true } });
  const programIds = programs.map(row => row.id);
  const years = await prisma.academicYear.findMany({ where: { programId: { in: programIds } }, select: { id: true } });
  const yearIds = years.map(row => row.id);
  const blocks = await prisma.block.findMany({ where: { academicYearId: { in: yearIds } }, select: { id: true } });
  const blockIds = blocks.map(row => row.id);
  const callDays = await prisma.callDay.findMany({ where: { blockId: { in: blockIds } }, select: { id: true } });
  const callDayIds = callDays.map(row => row.id);

  if (callDayIds.length) await prisma.callAssignment.deleteMany({ where: { callDayId: { in: callDayIds } } });
  if (blockIds.length) {
    await prisma.scheduleVersion.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.dayFlag.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.callDay.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.attendingEntry.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.blockEnrollment.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.blockSettings.deleteMany({ where: { blockId: { in: blockIds } } });
    await prisma.block.deleteMany({ where: { id: { in: blockIds } } });
  }
  if (yearIds.length) {
    await prisma.publicHoliday.deleteMany({ where: { academicYearId: { in: yearIds } } });
    await prisma.academicYear.deleteMany({ where: { id: { in: yearIds } } });
  }
  if (programIds.length) {
    await prisma.attendingScheduleTemplate.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.attendingRoster.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.residentProfile.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.invite.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.programMember.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.program.deleteMany({ where: { id: { in: programIds } } });
  }
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (orgIds.length) await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
}

async function main() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');

  const orgIds = [];
  const userIds = [];
  let server;

  try {
    const [orgA, orgB] = await Promise.all([
      prisma.organization.create({ data: { name: `${tag}_A`, country: 'CA', status: 'active' } }),
      prisma.organization.create({ data: { name: `${tag}_B`, country: 'CA', status: 'active' } }),
    ]);
    orgIds.push(orgA.id, orgB.id);

    const [programA, programB] = await Promise.all([
      prisma.program.create({ data: { name: `${tag}_PROGRAM_A`, specialty: 'Internal Medicine', orgId: orgA.id } }),
      prisma.program.create({ data: { name: `${tag}_PROGRAM_B`, specialty: 'Internal Medicine', orgId: orgB.id } }),
    ]);
    const [yearA, yearB] = await Promise.all([
      prisma.academicYear.create({ data: { programId: programA.id, startDate: new Date('2031-01-01T00:00:00Z'), endDate: new Date('2031-12-31T00:00:00Z') } }),
      prisma.academicYear.create({ data: { programId: programB.id, startDate: new Date('2031-01-01T00:00:00Z'), endDate: new Date('2031-12-31T00:00:00Z') } }),
    ]);
    const [blockA1, blockA2, blockB] = await Promise.all([
      prisma.block.create({ data: { academicYearId: yearA.id, number: 1, startDate: new Date('2031-01-01T00:00:00Z'), endDate: new Date('2031-01-28T00:00:00Z'), isPublished: true, publicToken: `${tag}_PUBLIC` } }),
      prisma.block.create({ data: { academicYearId: yearA.id, number: 2, startDate: new Date('2031-01-29T00:00:00Z'), endDate: new Date('2031-02-25T00:00:00Z') } }),
      prisma.block.create({ data: { academicYearId: yearB.id, number: 1, startDate: new Date('2031-01-01T00:00:00Z'), endDate: new Date('2031-01-28T00:00:00Z') } }),
    ]);

    const [chief, viewer] = await Promise.all([
      prisma.user.create({ data: { name: `${tag}_CHIEF`, email: `${tag.toLowerCase()}_chief@example.test`, passwordHash: 'not-used', orgId: orgA.id } }),
      prisma.user.create({ data: { name: `${tag}_VIEWER`, email: `${tag.toLowerCase()}_viewer@example.test`, passwordHash: 'not-used', orgId: orgA.id } }),
    ]);
    userIds.push(chief.id, viewer.id);
    await prisma.programMember.createMany({ data: [
      { programId: programA.id, userId: chief.id, role: 'chief_resident' },
      { programId: programA.id, userId: viewer.id, role: 'viewer' },
    ] });

    const [residentA, residentB] = await Promise.all([
      prisma.residentProfile.create({ data: { programId: programA.id, name: `${tag}_RESIDENT_A`, pgyLevel: '4', residentRole: 'senior' } }),
      prisma.residentProfile.create({ data: { programId: programB.id, name: `${tag}_RESIDENT_B`, pgyLevel: '2', residentRole: 'junior' } }),
    ]);
    await prisma.blockEnrollment.create({ data: { blockId: blockA1.id, residentId: residentA.id, vacationDates: [] } });
    await prisma.attendingEntry.create({ data: { blockId: blockB.id, attendingName: `${tag}_ATTENDING_B`, date: new Date('2031-01-01T00:00:00Z'), activityLabel: 'Call', isCallDay: true } });
    await prisma.attendingScheduleTemplate.create({ data: { programId: programA.id, attendingName: `${tag}_ATTENDING_A`, dayOfWeek: 0, activityLabel: 'Clinic' } });
    await prisma.scheduleVersion.create({
      data: {
        blockId: blockA1.id,
        publishedBy: chief.id,
        snapshotJson: {
          block: { id: blockA1.id, number: 1 },
          callDays: [{ id: `${tag}_INTERNAL_DAY`, assignments: [{ overrideReason: `${tag}_PRIVATE_REASON` }] }],
        },
      },
    });

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}/api`;
    const chiefToken = jwt.sign({ userId: chief.id, email: chief.email }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const viewerToken = jwt.sign({ userId: viewer.id, email: viewer.email }, process.env.JWT_SECRET, { expiresIn: '5m' });

    async function request(path, token, options = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.headers ?? {}),
        },
      });
      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      return { status: response.status, body };
    }

    const foreignStats = await request(`/programs/stats?blockId=${blockB.id}`, viewerToken);
    assert.equal(foreignStats.status, 403, 'viewer must not read another program stats');

    const foreignCopy = await request('/attending/copy', chiefToken, {
      method: 'POST',
      body: JSON.stringify({ sourceBlockId: blockB.id, targetBlockId: blockA2.id }),
    });
    assert.equal(foreignCopy.status, 403, 'chief must not read an unauthorized source block');

    const targetBefore = await prisma.attendingEntry.count({ where: { blockId: blockA2.id } });
    const forbiddenTemplate = await request(`/attending-template/${programA.id}/apply/${blockA2.id}`, chiefToken, {
      method: 'POST',
      body: JSON.stringify({ extraBlockIds: [blockB.id] }),
    });
    assert.equal(forbiddenTemplate.status, 403, 'template must reject an unauthorized extra block');
    const targetAfter = await prisma.attendingEntry.count({ where: { blockId: blockA2.id } });
    assert.equal(targetAfter, targetBefore, 'template prevalidation must prevent partial writes');

    const crossProgramAssignment = await request('/assignments', chiefToken, {
      method: 'POST',
      body: JSON.stringify({ blockId: blockA1.id, date: '2031-01-02', residentId: residentB.id, roleOnDay: 'junior' }),
    });
    assert.equal(crossProgramAssignment.status, 400, 'cross-program resident/block assignment must fail');

    const validAssignment = await request('/assignments', chiefToken, {
      method: 'POST',
      body: JSON.stringify({ blockId: blockA1.id, date: '2031-01-02', residentId: residentA.id, roleOnDay: 'senior' }),
    });
    assert.equal(validAssignment.status, 201, 'same-program assignment must succeed');

    const viewerHistory = await request(`/schedule/history?blockId=${blockA1.id}`, viewerToken);
    assert.equal(viewerHistory.status, 200, 'viewer may read published history metadata');
    assert.equal(Array.isArray(viewerHistory.body), true);
    assert.equal(Object.hasOwn(viewerHistory.body[0], 'snapshotJson'), false, 'viewer history must omit raw snapshots');
    assert.equal(viewerHistory.body[0].publishedBy, null, 'viewer history must omit publisher identity');

    console.log('[authz-smoke] route-level program isolation checks passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await cleanup(orgIds, userIds);
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('[authz-smoke] failed:', error.message);
  process.exitCode = 1;
});
