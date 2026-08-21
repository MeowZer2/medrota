require('dotenv').config();

// Publishing must never silently distribute a schedule whose compliance nobody
// has looked at, and validation output must answer a Chief Resident's questions:
// who, what date, what rule, why it matters, what to do, and whether it was
// intentional.

const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const app = require('../index');
const { validateSchedule } = require('../services/scheduleValidator');
const { dateFromDateKey } = require('../services/paroRules');

const tag = `PUBSAFE_ONLY_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

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
    // The test's own audit rows must go before the program they reference.
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
      data: { programId: program.id, startDate: dateFromDateKey('2036-01-01'), endDate: dateFromDateKey('2036-12-31') },
    });
    const block = await prisma.block.create({
      data: { academicYearId: year.id, number: 1, startDate: dateFromDateKey('2036-03-02'), endDate: dateFromDateKey('2036-03-15') },
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

    const chief = await prisma.user.create({
      data: { name: `${tag}_CHIEF`, email: `${tag.toLowerCase()}-chief@example.invalid`, passwordHash: await bcrypt.hash('PublishSafety_123!', 10), orgId: org.id },
    });
    await prisma.programMember.create({ data: { programId: program.id, userId: chief.id, role: 'chief_resident' } });
    const chiefToken = jwt.sign({ userId: chief.id, email: chief.email }, process.env.JWT_SECRET, { expiresIn: '1h' });

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    const request = async (path, options = {}) => {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chiefToken}`, ...(options.headers ?? {}) },
      });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      return { status: response.status, body };
    };

    // 1. A compliant schedule publishes without ceremony.
    const dayOne = await prisma.callDay.create({ data: { blockId: block.id, date: dateFromDateKey('2036-03-02') } });
    await prisma.callAssignment.create({ data: { callDayId: dayOne.id, residentId: senior.id, roleOnDay: 'senior' } });
    await prisma.callAssignment.create({ data: { callDayId: dayOne.id, residentId: junior.id, roleOnDay: 'junior' } });

    const cleanPublish = await request('/schedule/publish', { method: 'POST', body: JSON.stringify({ blockId: block.id }) });
    assert.equal(cleanPublish.status, 200, `a compliant schedule must publish: ${JSON.stringify(cleanPublish.body)}`);
    assert.equal(cleanPublish.body.publishedWithViolations, 0);

    // 2. Introduce an undocumented violation: consecutive call written directly,
    //    the way a stale or imported row would look.
    const dayTwo = await prisma.callDay.create({ data: { blockId: block.id, date: dateFromDateKey('2036-03-03') } });
    await prisma.callAssignment.create({ data: { callDayId: dayTwo.id, residentId: senior.id, roleOnDay: 'senior' } });

    const validation = await validateSchedule(block.id);
    const consecutive = validation.violations.find(item => item.code === 'CONSECUTIVE_CALL');
    assert.ok(consecutive, 'the deliberate consecutive call must be detected');

    // Validation must answer all six questions.
    assert.equal(consecutive.residentName, `Dr. ${tag}_SENIOR`, 'who');
    assert.equal(consecutive.date, '2036-03-03', 'what date');
    assert.equal(consecutive.rule, 'Consecutive call', 'what rule');
    assert.match(consecutive.why, /two days in a row/i, 'why it is a problem');
    assert.match(consecutive.remedy, /Move one of the two calls/i, 'what can be done');
    assert.equal(consecutive.isOverride, false, 'whether it is intentional');
    assert.equal(consecutive.details.previousDate, '2036-03-02', 'the related date must be given');
    assert.equal(consecutive.code, 'CONSECUTIVE_CALL', 'the machine-readable code must be preserved');

    // 3. Publishing must now stop and explain.
    const blocked = await request('/schedule/publish', { method: 'POST', body: JSON.stringify({ blockId: block.id }) });
    assert.equal(blocked.status, 409, 'an undocumented violation must block publishing');
    assert.equal(blocked.body.requiresViolationAcknowledgement, true);
    assert.ok(blocked.body.violations.some(item => item.code === 'CONSECUTIVE_CALL'));
    assert.ok(blocked.body.violations[0].remedy, 'the blocking response must carry the remedy text');

    const versionsBefore = await prisma.scheduleVersion.count({ where: { blockId: block.id } });
    assert.equal(versionsBefore, 1, 'the blocked publish must not have created a snapshot');

    // 4. An explicit acknowledgement lets an authorised user publish anyway.
    const acknowledged = await request('/schedule/publish', {
      method: 'POST',
      body: JSON.stringify({ blockId: block.id, acknowledgeViolations: true }),
    });
    assert.equal(acknowledged.status, 200, `an acknowledged publish must succeed: ${JSON.stringify(acknowledged.body)}`);
    assert.equal(acknowledged.body.publishedWithViolations, 1);
    assert.equal(await prisma.scheduleVersion.count({ where: { blockId: block.id } }), 2);

    // 5. A documented manual override is an intentional exception and must not
    //    block publishing at all.
    await prisma.callAssignment.deleteMany({ where: { callDayId: dayTwo.id } });
    await prisma.callAssignment.create({
      data: {
        callDayId: dayTwo.id, residentId: senior.id, roleOnDay: 'senior',
        isOverride: true, overrideReason: 'Coverage exception agreed with the program.',
      },
    });
    const documented = await validateSchedule(block.id);
    const documentedViolation = documented.violations.find(item => item.code === 'CONSECUTIVE_CALL');
    assert.equal(documentedViolation.isOverride, true);
    assert.ok(documentedViolation.overrideReasons.includes('Coverage exception agreed with the program.'));

    const overridePublish = await request('/schedule/publish', { method: 'POST', body: JSON.stringify({ blockId: block.id }) });
    assert.equal(overridePublish.status, 200, 'a documented override must not block publishing');
    assert.equal(overridePublish.body.publishedWithViolations, 0);
    assert.equal(overridePublish.body.documentedOverrides, 1);

    // 6. Unfilled slots must explain which candidates were rejected and why.
    const withGaps = await validateSchedule(block.id);
    assert.ok(Array.isArray(withGaps.unfilledSlots), 'validation must report unfilled slots');
    const juniorGap = withGaps.unfilledSlots.find(slot => slot.date === '2036-03-03' && slot.roleOnDay === 'junior');
    assert.ok(juniorGap, 'the uncovered junior slot on 2036-03-03 must be reported');
    const rejected = juniorGap.candidates.find(item => item.residentId === junior.id);
    assert.ok(rejected, 'the junior who could not take it must be listed');
    assert.equal(rejected.code, 'CONSECUTIVE_CALL');
    assert.equal(rejected.reason, 'Already on call the day before or after');
    assert.equal(rejected.residentName, `Dr. ${tag}_JUNIOR`);

    // Days that are not meant to be covered are not reported as gaps.
    await prisma.publicHoliday.create({ data: { academicYearId: year.id, date: dateFromDateKey('2036-03-05'), name: 'Holiday' } });
    const withHoliday = await validateSchedule(block.id);
    assert.ok(
      !withHoliday.unfilledSlots.some(slot => slot.date === '2036-03-05'),
      'a holiday must not be reported as an unfilled slot',
    );

    console.log('[publish-safety-smoke] actionable validation and safe publish checks passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await cleanup(orgId);
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('[publish-safety-smoke] failed:', error.message);
  process.exitCode = 1;
});
