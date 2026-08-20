require('dotenv').config();

const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const app = require('../index');
const { classifyDuplicateGroup, residentCanFillRole } = require('../services/dataIntegrity');

const tag = `INTEGRITY_ONLY_${Date.now()}_${Math.random().toString(16).slice(2)}`;

async function cleanup(orgId, userIds) {
  if (!orgId) return;
  const programs = await prisma.program.findMany({ where: { orgId }, select: { id: true } });
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
    await prisma.residentProfile.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.invite.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.programMember.deleteMany({ where: { programId: { in: programIds } } });
    // The test's own audit rows must go before the program they reference.
    await prisma.auditEvent.deleteMany({ where: { programId: { in: programIds } } });
    await prisma.program.deleteMany({ where: { id: { in: programIds } } });
  }
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
}

// Classification unit checks run without touching the database so the repair
// rules stay pinned even when the local data is already clean.
function checkClassificationRules() {
  const junior = { id: 'r-junior', residentRole: 'junior', isMedStudent: false, isActive: true };
  const otherJunior = { id: 'r-junior-2', residentRole: 'junior', isMedStudent: false, isActive: true };
  const medStudent = { id: 'r-med', residentRole: 'junior', isMedStudent: true, isActive: true };
  const row = (id, resident, overrides = {}) => ({
    id, residentId: resident.id, resident, isOverride: false, createdAt: new Date(`2026-01-0${id.length}T00:00:00Z`), ...overrides,
  });

  const medSurplus = classifyDuplicateGroup(
    [row('a', junior), row('bb', medStudent)], 'junior', new Set(),
  );
  assert.equal(medSurplus.rule, 'med-student-surplus');
  assert.equal(medSurplus.keepId, 'a', 'the junior resident row is authoritative');
  assert.deepEqual(medSurplus.removeIds, ['bb']);

  const overrideWins = classifyDuplicateGroup(
    [row('a', junior), row('bb', otherJunior, { isOverride: true, overrideReason: 'coverage' })], 'junior', new Set(),
  );
  assert.equal(overrideWins.rule, 'override-precedence');
  assert.equal(overrideWins.keepId, 'bb', 'a documented manual override beats a generated row');

  const twoOverrides = classifyDuplicateGroup(
    [row('a', junior, { isOverride: true }), row('bb', otherJunior, { isOverride: true })], 'junior', new Set(),
  );
  assert.equal(twoOverrides.rule, 'ambiguous', 'conflicting human decisions must never be auto-resolved');
  assert.equal(twoOverrides.keepId, undefined);

  const twoGeneratedJuniors = classifyDuplicateGroup(
    [row('a', junior), row('bb', otherJunior)], 'junior', new Set(),
  );
  assert.equal(twoGeneratedJuniors.rule, 'ambiguous', 'two equally plausible juniors must be preserved');

  const snapshotCorroborated = classifyDuplicateGroup(
    [row('a', junior), row('bb', otherJunior)], 'junior', new Set([otherJunior.id]),
  );
  assert.equal(snapshotCorroborated.rule, 'published-snapshot-corroborated');
  assert.equal(snapshotCorroborated.keepId, 'bb');

  assert.equal(residentCanFillRole(medStudent, 'senior'), false, 'a medical student can never hold the senior slot');
  assert.equal(residentCanFillRole(junior, 'senior'), false);
  assert.equal(residentCanFillRole({ ...junior, isActive: false }, 'junior'), false);
}

async function main() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
  checkClassificationRules();

  let orgId;
  const userIds = [];
  let server;

  try {
    const org = await prisma.organization.create({ data: { name: tag, country: 'CA', status: 'active' } });
    orgId = org.id;
    const program = await prisma.program.create({
      data: { name: `${tag}_PROGRAM`, specialty: 'Internal Medicine', orgId: org.id },
    });
    const year = await prisma.academicYear.create({
      data: { programId: program.id, startDate: new Date('2033-01-01T00:00:00Z'), endDate: new Date('2033-12-31T00:00:00Z') },
    });
    const block = await prisma.block.create({
      data: { academicYearId: year.id, number: 1, startDate: new Date('2033-01-01T00:00:00Z'), endDate: new Date('2033-01-28T00:00:00Z') },
    });
    await prisma.blockSettings.create({ data: { blockId: block.id, maxCallsPerResident: 9 } });

    const chief = await prisma.user.create({
      data: { name: `${tag}_CHIEF`, email: `${tag.toLowerCase()}-chief@example.invalid`, passwordHash: await bcrypt.hash('IntegritySmoke_123!', 10), orgId: org.id },
    });
    userIds.push(chief.id);
    await prisma.programMember.create({ data: { programId: program.id, userId: chief.id, role: 'chief_resident' } });
    const chiefToken = jwt.sign({ userId: chief.id, email: chief.email }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const [seniorA, seniorB, juniorA, juniorB] = await Promise.all([
      prisma.residentProfile.create({ data: { programId: program.id, name: `${tag}_SENIOR_A`, pgyLevel: '4', residentRole: 'senior' } }),
      prisma.residentProfile.create({ data: { programId: program.id, name: `${tag}_SENIOR_B`, pgyLevel: '5', residentRole: 'senior' } }),
      prisma.residentProfile.create({ data: { programId: program.id, name: `${tag}_JUNIOR_A`, pgyLevel: '2', residentRole: 'junior' } }),
      prisma.residentProfile.create({ data: { programId: program.id, name: `${tag}_JUNIOR_B`, pgyLevel: '1', residentRole: 'junior' } }),
    ]);
    await prisma.blockEnrollment.createMany({
      data: [seniorA, seniorB, juniorA, juniorB].map(resident => ({ blockId: block.id, residentId: resident.id, vacationDates: [] })),
    });

    const callDay = await prisma.callDay.create({ data: { blockId: block.id, date: new Date('2033-01-05T00:00:00Z') } });

    // 1. The database itself must reject a second senior in the same slot.
    await prisma.callAssignment.create({ data: { callDayId: callDay.id, residentId: seniorA.id, roleOnDay: 'senior' } });
    await assert.rejects(
      prisma.callAssignment.create({ data: { callDayId: callDay.id, residentId: seniorB.id, roleOnDay: 'senior' } }),
      err => /Unique constraint|unique/i.test(err.message),
      'a duplicate senior slot must be rejected by the unique constraint',
    );

    // 2. The same must hold for the junior slot.
    await prisma.callAssignment.create({ data: { callDayId: callDay.id, residentId: juniorA.id, roleOnDay: 'junior' } });
    await assert.rejects(
      prisma.callAssignment.create({ data: { callDayId: callDay.id, residentId: juniorB.id, roleOnDay: 'junior' } }),
      err => /Unique constraint|unique/i.test(err.message),
      'a duplicate junior slot must be rejected by the unique constraint',
    );

    // 3. UNIQUE(callDayId, residentId) must still stop one resident holding both
    //    slots, so the two constraints remain compatible.
    const seniorAlsoJunior = await prisma.callAssignment.findFirst({ where: { callDayId: callDay.id, roleOnDay: 'junior' } });
    await prisma.callAssignment.delete({ where: { id: seniorAlsoJunior.id } });
    await assert.rejects(
      prisma.callAssignment.create({ data: { callDayId: callDay.id, residentId: seniorA.id, roleOnDay: 'junior' } }),
      err => /Unique constraint|unique/i.test(err.message),
      'one resident must not occupy both slots on the same day',
    );

    // 4. Old legitimate assignments survive: the row written before the new
    //    constraint existed is still present and untouched.
    const survivors = await prisma.callAssignment.findMany({ where: { callDayId: callDay.id } });
    assert.equal(survivors.length, 1, 'the pre-existing senior assignment must survive');
    assert.equal(survivors[0].residentId, seniorA.id);

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    const request = async (path, token, options = {}) => {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers ?? {}),
        },
      });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      return { status: response.status, body };
    };

    // 5. The transactional day-save still works end to end and replaces both
    //    slots without tripping the new constraint.
    const firstSave = await request('/assignments/day', chiefToken, {
      method: 'PUT',
      body: JSON.stringify({ blockId: block.id, date: '2033-01-05', seniorId: seniorA.id, juniorId: juniorA.id }),
    });
    assert.equal(firstSave.status, 200, `day save must succeed: ${JSON.stringify(firstSave.body)}`);
    assert.equal(firstSave.body.assignments.length, 2);

    // Replacing both residents on the same day deletes and recreates rows inside
    // one transaction; the unique index must not block the rewrite.
    const replaceSave = await request('/assignments/day', chiefToken, {
      method: 'PUT',
      body: JSON.stringify({ blockId: block.id, date: '2033-01-05', seniorId: seniorB.id, juniorId: juniorB.id }),
    });
    assert.equal(replaceSave.status, 200, `slot replacement must succeed: ${JSON.stringify(replaceSave.body)}`);
    const replaced = replaceSave.body.assignments.reduce((acc, item) => ({ ...acc, [item.roleOnDay]: item.residentId }), {});
    assert.equal(replaced.senior, seniorB.id);
    assert.equal(replaced.junior, juniorB.id);

    // Swapping the two residents between slots exercises the worst case for a
    // per-slot unique index.
    const swapSave = await request('/assignments/day', chiefToken, {
      method: 'PUT',
      body: JSON.stringify({ blockId: block.id, date: '2033-01-05', seniorId: seniorA.id, juniorId: juniorA.id }),
    });
    assert.equal(swapSave.status, 200, `swapping residents back must succeed: ${JSON.stringify(swapSave.body)}`);

    // 6. The API still refuses the same resident in both slots with a readable
    //    message rather than a database error.
    const sameResident = await request('/assignments/day', chiefToken, {
      method: 'PUT',
      body: JSON.stringify({ blockId: block.id, date: '2033-01-05', seniorId: seniorA.id, juniorId: seniorA.id }),
    });
    assert.equal(sameResident.status, 400);
    assert.match(sameResident.body.error, /same resident/i);

    // 7. POST /assignments must report the occupied slot as a conflict.
    const occupiedSlot = await request('/assignments', chiefToken, {
      method: 'POST',
      body: JSON.stringify({ blockId: block.id, date: '2033-01-05', residentId: seniorB.id, roleOnDay: 'senior' }),
    });
    assert.equal(occupiedSlot.status, 409, `an occupied slot must be a conflict: ${JSON.stringify(occupiedSlot.body)}`);

    const finalRows = await prisma.callAssignment.findMany({ where: { callDayId: callDay.id } });
    assert.equal(finalRows.length, 2, 'the day must end with exactly one senior and one junior');
    assert.equal(new Set(finalRows.map(r => r.roleOnDay)).size, 2);

    console.log('[data-integrity-smoke] role-slot uniqueness and repair classification checks passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await cleanup(orgId, userIds);
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('[data-integrity-smoke] failed:', error.message);
  process.exitCode = 1;
});
