require('dotenv').config();

// The audit trail must record real mutations, must never carry credentials,
// and must respect who is allowed to read which history.

const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const app = require('../index');
const { dateFromDateKey } = require('../services/paroRules');
const { sanitizeMetadata, readableCategories } = require('../services/auditLog');

const tag = `AUDIT_ONLY_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

async function cleanup(orgId) {
  if (!orgId) return;
  const programs = await prisma.program.findMany({ where: { orgId }, select: { id: true } });
  const programIds = programs.map(row => row.id);
  const years = await prisma.academicYear.findMany({ where: { programId: { in: programIds } }, select: { id: true } });
  const yearIds = years.map(row => row.id);
  const blocks = await prisma.block.findMany({ where: { academicYearId: { in: yearIds } }, select: { id: true } });
  const blockIds = blocks.map(row => row.id);
  const callDays = await prisma.callDay.findMany({ where: { blockId: { in: blockIds } }, select: { id: true } });

  if (programIds.length) await prisma.auditEvent.deleteMany({ where: { programId: { in: programIds } } });
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
    await prisma.program.deleteMany({ where: { id: { in: programIds } } });
  }
  const users = await prisma.user.findMany({ where: { orgId }, select: { id: true } });
  if (users.length) {
    await prisma.programMember.deleteMany({ where: { userId: { in: users.map(u => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } });
  }
  await prisma.organization.deleteMany({ where: { id: orgId } });
}

function checkMetadataSanitizer() {
  const cleaned = sanitizeMetadata({
    residentId: 'r-1',
    password: 'hunter2',
    passwordHash: '$2a$10$abc',
    token: 'eyJhbGciOi',
    Authorization: 'Bearer abc',
    publicToken: 'uuid-value',
    inviteToken: 'uuid-value',
    nested: { secret: 'x', keep: 'yes' },
  });
  assert.deepEqual(Object.keys(cleaned).sort(), ['nested', 'residentId']);
  assert.deepEqual(cleaned.nested, { keep: 'yes' }, 'secrets must be stripped at every depth');

  const longString = sanitizeMetadata({ note: 'x'.repeat(900) });
  assert.ok(longString.note.length <= 501, 'long strings must be truncated');

  assert.deepEqual(readableCategories('viewer'), [], 'a viewer reads no history');
  assert.deepEqual(readableCategories('chief_resident'), ['scheduling']);
  assert.equal(readableCategories('program_admin').length, 2);
  assert.equal(readableCategories('program_director').length, 2);
}

async function main() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
  checkMetadataSanitizer();

  let orgId;
  let server;
  try {
    const org = await prisma.organization.create({ data: { name: tag, country: 'CA', status: 'active' } });
    orgId = org.id;
    const program = await prisma.program.create({ data: { name: `${tag}_PROGRAM`, specialty: 'Neurology', orgId: org.id } });
    const year = await prisma.academicYear.create({
      data: { programId: program.id, startDate: dateFromDateKey('2037-01-01'), endDate: dateFromDateKey('2037-12-31') },
    });
    const block = await prisma.block.create({
      data: { academicYearId: year.id, number: 1, startDate: dateFromDateKey('2037-04-06'), endDate: dateFromDateKey('2037-04-19') },
    });
    await prisma.blockSettings.create({ data: { blockId: block.id, maxCallsPerResident: 9 } });

    const senior = await prisma.residentProfile.create({
      data: { programId: program.id, name: `${tag}_SENIOR`, pgyLevel: '4', residentRole: 'senior', isServiceResident: true },
    });
    const junior = await prisma.residentProfile.create({
      data: { programId: program.id, name: `${tag}_JUNIOR`, pgyLevel: '2', residentRole: 'junior', isServiceResident: true },
    });

    const makeUser = async (name, role) => {
      const user = await prisma.user.create({
        data: {
          name: `${tag}_${name}`,
          email: `${tag.toLowerCase()}-${name.toLowerCase()}@example.invalid`,
          passwordHash: await bcrypt.hash('AuditSmoke_123!', 10),
          orgId: org.id,
        },
      });
      await prisma.programMember.create({ data: { programId: program.id, userId: user.id, role } });
      return {
        user,
        token: jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' }),
      };
    };
    const admin = await makeUser('ADMIN', 'program_admin');
    const chief = await makeUser('CHIEF', 'chief_resident');
    const viewer = await makeUser('VIEWER', 'viewer');

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

    // --- Produce a mix of scheduling and administrative history -------------

    await request(`/blocks/${block.id}/availability/bulk`, chief.token, {
      method: 'POST',
      body: JSON.stringify({ residentIds: [senior.id, junior.id] }),
    });
    const daySave = await request('/assignments/day', chief.token, {
      method: 'PUT',
      body: JSON.stringify({ blockId: block.id, date: '2037-04-06', seniorId: senior.id, juniorId: junior.id }),
    });
    assert.equal(daySave.status, 200, JSON.stringify(daySave.body));

    await request(`/blocks/${block.id}/settings`, chief.token, {
      method: 'PUT',
      body: JSON.stringify({ maxCallsPerResident: 7 }),
    });
    const generated = await request('/schedule/generate', chief.token, {
      method: 'POST',
      body: JSON.stringify({ blockId: block.id }),
    });
    assert.equal(generated.status, 200, JSON.stringify(generated.body));
    const published = await request('/schedule/publish', chief.token, {
      method: 'POST',
      body: JSON.stringify({ blockId: block.id, acknowledgeViolations: true }),
    });
    assert.equal(published.status, 200, JSON.stringify(published.body));

    // Administrative actions, performed by the admin.
    const invited = await request(`/programs/${program.id}/invite`, admin.token, {
      method: 'POST',
      body: JSON.stringify({ role: 'viewer' }),
    });
    assert.equal(invited.status, 200, JSON.stringify(invited.body));
    const roleChanged = await request(`/programs/${program.id}/members/${viewer.user.id}`, admin.token, {
      method: 'PUT',
      body: JSON.stringify({ role: 'chief_resident' }),
    });
    assert.equal(roleChanged.status, 200, JSON.stringify(roleChanged.body));
    const callTypes = await request(`/programs/${program.id}`, admin.token, {
      method: 'PUT',
      body: JSON.stringify({ juniorInHouseCall: false, seniorInHouseCall: true }),
    });
    assert.equal(callTypes.status, 200, JSON.stringify(callTypes.body));

    // --- What was recorded --------------------------------------------------

    const adminView = await request(`/audit?programId=${program.id}`, admin.token);
    assert.equal(adminView.status, 200);
    const adminActions = adminView.body.events.map(item => item.action);
    for (const expected of [
      'BLOCK_AVAILABILITY_CHANGED', 'ASSIGNMENT_CHANGED', 'BLOCK_SETTINGS_CHANGED',
      'SCHEDULE_GENERATED', 'SCHEDULE_PUBLISHED',
      'MEMBER_INVITED', 'MEMBER_ROLE_CHANGED', 'PROGRAM_CALL_TYPES_CHANGED',
    ]) {
      assert.ok(adminActions.includes(expected), `admin history must contain ${expected}, got ${[...new Set(adminActions)].join(', ')}`);
    }

    // Newest first, and every entry names an actor and reads as a sentence.
    const timestamps = adminView.body.events.map(item => item.createdAt);
    assert.deepEqual(timestamps, [...timestamps].sort().reverse(), 'history must be newest first');
    for (const event of adminView.body.events) {
      assert.ok(event.summary && event.summary.length > 0, `${event.action} must carry a summary`);
      assert.ok(event.actorName, `${event.action} must record who did it`);
    }

    // --- Authorization ------------------------------------------------------

    const chiefView = await request(`/audit?programId=${program.id}`, chief.token);
    assert.equal(chiefView.status, 200);
    assert.deepEqual(chiefView.body.categories, ['scheduling']);
    assert.ok(chiefView.body.events.length > 0, 'a chief resident must see scheduling history');
    assert.ok(
      chiefView.body.events.every(item => item.category === 'scheduling'),
      'a chief resident must never see administrative history',
    );
    for (const administrative of ['MEMBER_INVITED', 'MEMBER_ROLE_CHANGED', 'PROGRAM_CALL_TYPES_CHANGED']) {
      assert.ok(
        !chiefView.body.events.some(item => item.action === administrative),
        `${administrative} must be hidden from a chief resident`,
      );
    }

    // The viewer was promoted to chief above, so make a fresh viewer.
    const plainViewer = await makeUser('VIEWER2', 'viewer');
    const viewerView = await request(`/audit?programId=${program.id}`, plainViewer.token);
    assert.equal(viewerView.status, 403, 'a viewer must not read program history at all');

    const anonymous = await request(`/audit?programId=${program.id}`, null);
    assert.equal(anonymous.status, 401, 'audit history must require authentication');

    // A member of a different program must not read this history.
    const otherOrg = await prisma.organization.create({ data: { name: `${tag}_OTHER`, country: 'CA', status: 'active' } });
    const otherProgram = await prisma.program.create({ data: { name: `${tag}_OTHER_PROGRAM`, specialty: 'Neurology', orgId: otherOrg.id } });
    const outsider = await prisma.user.create({
      data: { name: `${tag}_OUTSIDER`, email: `${tag.toLowerCase()}-outsider@example.invalid`, passwordHash: await bcrypt.hash('AuditSmoke_123!', 10), orgId: otherOrg.id },
    });
    await prisma.programMember.create({ data: { programId: otherProgram.id, userId: outsider.id, role: 'program_admin' } });
    const outsiderToken = jwt.sign({ userId: outsider.id, email: outsider.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const crossProgram = await request(`/audit?programId=${program.id}`, outsiderToken);
    assert.equal(crossProgram.status, 403, 'another program admin must not read this program history');
    const crossBlock = await request(`/audit?blockId=${block.id}`, outsiderToken);
    assert.equal(crossBlock.status, 403, 'a block filter must not leak another program history');

    await prisma.programMember.deleteMany({ where: { programId: otherProgram.id } });
    await prisma.user.deleteMany({ where: { id: outsider.id } });
    await prisma.program.deleteMany({ where: { id: otherProgram.id } });
    await prisma.organization.deleteMany({ where: { id: otherOrg.id } });

    // --- Filtering and content safety ---------------------------------------

    const blockScoped = await request(`/audit?programId=${program.id}&blockId=${block.id}`, admin.token);
    assert.equal(blockScoped.status, 200);
    assert.ok(blockScoped.body.events.length > 0);
    assert.ok(
      blockScoped.body.events.every(item => item.blockId === block.id),
      'a block filter must only return that block history',
    );

    // Nothing sensitive may reach the table, even for the invite that has a token.
    const stored = await prisma.auditEvent.findMany({ where: { programId: program.id } });
    const serialized = JSON.stringify(stored);
    for (const forbidden of ['passwordHash', 'Bearer ', '$2a$', '$2b$']) {
      assert.ok(!serialized.includes(forbidden), `audit rows must not contain ${forbidden}`);
    }
    const inviteEvent = stored.find(item => item.action === 'MEMBER_INVITED');
    const inviteRow = await prisma.invite.findFirst({ where: { programId: program.id } });
    assert.ok(!serialized.includes(inviteRow.token), 'the invite token must never be audited');
    assert.equal(inviteEvent.metadataJson.role, 'viewer', 'the invite role is what matters and is recorded');

    // The publish audit is written inside the publish transaction.
    const publishEvent = stored.find(item => item.action === 'SCHEDULE_PUBLISHED');
    const version = await prisma.scheduleVersion.findFirst({ where: { blockId: block.id } });
    assert.equal(publishEvent.entityId, version.id, 'the publish event must point at the snapshot it published');

    // A rolled-back mutation must leave no audit row claiming it happened.
    const before = await prisma.auditEvent.count({ where: { programId: program.id } });
    const rejected = await request('/assignments/day', chief.token, {
      method: 'PUT',
      body: JSON.stringify({ blockId: block.id, date: '2037-04-08', seniorId: senior.id, juniorId: senior.id }),
    });
    assert.equal(rejected.status, 400, 'the invalid day save must be refused');
    assert.equal(
      await prisma.auditEvent.count({ where: { programId: program.id } }), before,
      'a refused mutation must not be audited',
    );

    console.log('[audit-smoke] audit recording, redaction and role visibility checks passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await cleanup(orgId);
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('[audit-smoke] failed:', error.message);
  process.exitCode = 1;
});
