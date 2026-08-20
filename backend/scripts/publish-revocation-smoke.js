require('dotenv').config();

// A published link must be retractable and replaceable, without destroying the
// immutable version history or touching the draft.

const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const app = require('../index');
const { dateFromDateKey } = require('../services/paroRules');

const tag = `REVOKE_ONLY_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

async function cleanup(orgId) {
  if (!orgId) return;
  const programs = await prisma.program.findMany({ where: { orgId }, select: { id: true } });
  const programIds = programs.map(row => row.id);
  const years = await prisma.academicYear.findMany({ where: { programId: { in: programIds } }, select: { id: true } });
  const yearIds = years.map(row => row.id);
  const blocks = await prisma.block.findMany({ where: { academicYearId: { in: yearIds } }, select: { id: true } });
  const blockIds = blocks.map(row => row.id);
  const callDays = await prisma.callDay.findMany({ where: { blockId: { in: blockIds } }, select: { id: true } });

  if (callDays.length) await prisma.callAssignment.deleteMany({ where: { callDayId: { in: callDays.map(d => d.id) } } });
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
    await prisma.residentProfile.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.invite.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.programMember.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.auditEvent.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.program.deleteMany({ where: { id: { in: programIds } } });
  }
  const users = await prisma.user.findMany({ where: { orgId }, select: { id: true } });
  if (users.length) {
    await prisma.programMember.deleteMany({ where: { userId: { in: users.map(u => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } });
  }
  await prisma.organization.deleteMany({ where: { id: orgId } });
}

async function main() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');

  let orgId;
  let server;
  try {
    const org = await prisma.organization.create({ data: { name: tag, country: 'CA', status: 'active' } });
    orgId = org.id;
    const program = await prisma.program.create({ data: { name: `${tag}_PROGRAM`, specialty: 'Surgery', orgId: org.id } });
    const year = await prisma.academicYear.create({
      data: { programId: program.id, startDate: dateFromDateKey('2038-01-01'), endDate: dateFromDateKey('2038-12-31') },
    });
    const block = await prisma.block.create({
      data: { academicYearId: year.id, number: 1, startDate: dateFromDateKey('2038-05-03'), endDate: dateFromDateKey('2038-05-16') },
    });
    await prisma.blockSettings.create({ data: { blockId: block.id, maxCallsPerResident: 9 } });

    const senior = await prisma.residentProfile.create({
      data: { programId: program.id, name: `${tag}_SENIOR`, pgyLevel: '4', residentRole: 'senior', isServiceResident: true },
    });
    const junior = await prisma.residentProfile.create({
      data: { programId: program.id, name: `${tag}_JUNIOR`, pgyLevel: '2', residentRole: 'junior', isServiceResident: true },
    });
    await prisma.blockEnrollment.createMany({
      data: [senior, junior].map(r => ({ blockId: block.id, residentId: r.id, vacationDates: [] })),
    });
    const day = await prisma.callDay.create({ data: { blockId: block.id, date: dateFromDateKey('2038-05-03') } });
    await prisma.callAssignment.create({ data: { callDayId: day.id, residentId: senior.id, roleOnDay: 'senior' } });
    await prisma.callAssignment.create({ data: { callDayId: day.id, residentId: junior.id, roleOnDay: 'junior' } });

    const makeUser = async (name, role) => {
      const user = await prisma.user.create({
        data: {
          name: `${tag}_${name}`,
          email: `${tag.toLowerCase()}-${name.toLowerCase()}@example.invalid`,
          passwordHash: await bcrypt.hash('Revocation_123!', 10),
          orgId: org.id,
        },
      });
      await prisma.programMember.create({ data: { programId: program.id, userId: user.id, role } });
      return jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
    };
    const chiefToken = await makeUser('CHIEF', 'chief_resident');
    const viewerToken = await makeUser('VIEWER', 'viewer');

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    const request = async (path, token, options = {}) => {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers ?? {}) },
      });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      return { status: response.status, body };
    };

    // Nothing to retract or rotate before the first publish.
    assert.equal((await request('/schedule/unpublish', chiefToken, { method: 'POST', body: JSON.stringify({ blockId: block.id }) })).status, 409);
    assert.equal((await request('/schedule/rotate-link', chiefToken, { method: 'POST', body: JSON.stringify({ blockId: block.id }) })).status, 409);

    const published = await request('/schedule/publish', chiefToken, { method: 'POST', body: JSON.stringify({ blockId: block.id }) });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    const firstToken = published.body.publicToken;
    assert.ok(firstToken);

    assert.equal((await request(`/public/${firstToken}`, null)).status, 200, 'the published link must resolve');

    // --- Unpublish -----------------------------------------------------------

    const versionsBefore = await prisma.scheduleVersion.count({ where: { blockId: block.id } });
    const draftBefore = await prisma.callAssignment.count({ where: { callDay: { blockId: block.id } } });

    const unpublished = await request('/schedule/unpublish', chiefToken, { method: 'POST', body: JSON.stringify({ blockId: block.id }) });
    assert.equal(unpublished.status, 200, JSON.stringify(unpublished.body));
    assert.equal(unpublished.body.isPublished, false);

    assert.equal((await request(`/public/${firstToken}`, null)).status, 404, 'the public URL must stop resolving');
    assert.equal((await request(`/public/${firstToken}/export/excel`, null)).status, 404, 'public exports must stop too');
    assert.equal((await request(`/public/${firstToken}/export/pdf`, null)).status, 404);

    assert.equal(
      await prisma.scheduleVersion.count({ where: { blockId: block.id } }), versionsBefore,
      'immutable version history must survive unpublishing',
    );
    assert.equal(
      await prisma.callAssignment.count({ where: { callDay: { blockId: block.id } } }), draftBefore,
      'the draft schedule must be untouched by unpublishing',
    );

    // Unpublishing twice is refused rather than silently repeated.
    assert.equal((await request('/schedule/unpublish', chiefToken, { method: 'POST', body: JSON.stringify({ blockId: block.id }) })).status, 409);

    // --- Rotate --------------------------------------------------------------

    const republished = await request('/schedule/publish', chiefToken, { method: 'POST', body: JSON.stringify({ blockId: block.id }) });
    assert.equal(republished.status, 200);
    assert.equal(republished.body.publicToken, firstToken, 'republishing reuses the existing link');
    assert.equal((await request(`/public/${firstToken}`, null)).status, 200);

    const rotated = await request('/schedule/rotate-link', chiefToken, { method: 'POST', body: JSON.stringify({ blockId: block.id }) });
    assert.equal(rotated.status, 200, JSON.stringify(rotated.body));
    const secondToken = rotated.body.publicToken;
    assert.notEqual(secondToken, firstToken, 'rotation must produce a different token');
    assert.ok(secondToken.length >= 32, 'the new token must be long enough to be unguessable');
    assert.match(secondToken, /^[A-Za-z0-9_-]+$/, 'the new token must be URL-safe');

    assert.equal((await request(`/public/${firstToken}`, null)).status, 404, 'the old link must stop working');
    const newLink = await request(`/public/${secondToken}`, null);
    assert.equal(newLink.status, 200, 'the latest published version must be available under the new link');
    assert.ok(newLink.body.callDays?.length > 0, 'the schedule content must still be there');

    assert.equal(
      await prisma.scheduleVersion.count({ where: { blockId: block.id } }), versionsBefore + 1,
      'rotation must not touch version history',
    );

    // --- Authorization and audit --------------------------------------------

    assert.equal(
      (await request('/schedule/unpublish', viewerToken, { method: 'POST', body: JSON.stringify({ blockId: block.id }) })).status, 403,
      'a viewer must not be able to unpublish',
    );
    assert.equal(
      (await request('/schedule/rotate-link', viewerToken, { method: 'POST', body: JSON.stringify({ blockId: block.id }) })).status, 403,
      'a viewer must not be able to rotate the public link',
    );
    assert.equal((await request('/schedule/unpublish', null, { method: 'POST', body: JSON.stringify({ blockId: block.id }) })).status, 401);

    const events = await prisma.auditEvent.findMany({ where: { programId: program.id } });
    assert.ok(events.some(item => item.action === 'SCHEDULE_UNPUBLISHED'), 'unpublishing must be audited');
    assert.ok(events.some(item => item.action === 'PUBLIC_LINK_ROTATED'), 'link rotation must be audited');

    // Neither token may appear anywhere in the audit trail.
    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes(firstToken), 'the old public token must never be audited');
    assert.ok(!serialized.includes(secondToken), 'the new public token must never be audited');

    console.log('[publish-revocation-smoke] unpublish and public link rotation checks passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await cleanup(orgId);
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('[publish-revocation-smoke] failed:', error.message);
  process.exitCode = 1;
});
