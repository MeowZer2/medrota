require('dotenv').config();

// Behavioral coverage for the block availability workflow: bulk enrollment,
// copy-forward, and the pre-generation readiness check.

const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const app = require('../index');
const { dateFromDateKey } = require('../services/paroRules');
const { toRanges } = require('../services/blockAvailability');

const tag = `AVAIL_ONLY_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

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
    await prisma.program.deleteMany({ where: { id: { in: programIds } } });
  }
  const users = await prisma.user.findMany({ where: { orgId }, select: { id: true } });
  if (users.length) {
    await prisma.programMember.deleteMany({ where: { userId: { in: users.map(u => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } });
  }
  await prisma.organization.deleteMany({ where: { id: orgId } });
}

function checkRangeCollapsing() {
  assert.deepEqual(
    toRanges(['2035-01-02', '2035-01-03', '2035-01-04', '2035-01-08']),
    [{ from: '2035-01-02', to: '2035-01-04' }, { from: '2035-01-08', to: '2035-01-08' }],
    'contiguous dates must collapse into one range and gaps must split',
  );
  assert.deepEqual(toRanges([]), [], 'no vacation means no ranges');
  assert.deepEqual(
    toRanges(['2035-01-05', '2035-01-04', '2035-01-04']),
    [{ from: '2035-01-04', to: '2035-01-05' }],
    'unsorted and duplicated dates must still collapse cleanly',
  );
}

async function main() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
  checkRangeCollapsing();

  let orgId;
  let server;
  try {
    const org = await prisma.organization.create({ data: { name: tag, country: 'CA', status: 'active' } });
    orgId = org.id;
    const program = await prisma.program.create({
      data: { name: `${tag}_PROGRAM`, specialty: 'Neurology', orgId: org.id },
    });
    const year = await prisma.academicYear.create({
      data: { programId: program.id, startDate: dateFromDateKey('2035-01-01'), endDate: dateFromDateKey('2035-12-31') },
    });
    const blockOne = await prisma.block.create({
      data: { academicYearId: year.id, number: 1, startDate: dateFromDateKey('2035-01-01'), endDate: dateFromDateKey('2035-01-28') },
    });
    const blockTwo = await prisma.block.create({
      data: { academicYearId: year.id, number: 2, startDate: dateFromDateKey('2035-01-29'), endDate: dateFromDateKey('2035-02-25') },
    });

    const residents = [];
    for (const [name, role] of [['Senior A', 'senior'], ['Senior B', 'senior'], ['Junior A', 'junior'], ['Junior B', 'junior']]) {
      residents.push(await prisma.residentProfile.create({
        data: { programId: program.id, name: `${tag}_${name}`, pgyLevel: role === 'senior' ? '4' : '2', residentRole: role, isServiceResident: true },
      }));
    }
    const [seniorA, seniorB, juniorA, juniorB] = residents;

    const chief = await prisma.user.create({
      data: { name: `${tag}_CHIEF`, email: `${tag.toLowerCase()}-chief@example.invalid`, passwordHash: await bcrypt.hash('Availability_123!', 10), orgId: org.id },
    });
    await prisma.programMember.create({ data: { programId: program.id, userId: chief.id, role: 'chief_resident' } });
    const chiefToken = jwt.sign({ userId: chief.id, email: chief.email }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const viewer = await prisma.user.create({
      data: { name: `${tag}_VIEWER`, email: `${tag.toLowerCase()}-viewer@example.invalid`, passwordHash: await bcrypt.hash('Availability_123!', 10), orgId: org.id },
    });
    await prisma.programMember.create({ data: { programId: program.id, userId: viewer.id, role: 'viewer' } });
    const viewerToken = jwt.sign({ userId: viewer.id, email: viewer.email }, process.env.JWT_SECRET, { expiresIn: '1h' });

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

    // 1. Readiness before any availability exists must be actionable, not silent.
    const emptyReadiness = await request(`/blocks/${blockOne.id}/readiness`, chiefToken);
    assert.equal(emptyReadiness.status, 200);
    assert.equal(emptyReadiness.body.readyToGenerate, false, 'a block with no availability must not read as ready');
    assert.equal(emptyReadiness.body.residents.withAvailability, 0);
    assert.equal(emptyReadiness.body.residents.activeServiceTotal, 4);
    assert.equal(emptyReadiness.body.residents.missingAvailability.length, 4);
    const codes = emptyReadiness.body.blockers.map(item => item.code);
    assert.ok(codes.includes('MISSING_AVAILABILITY'), `expected MISSING_AVAILABILITY, got ${codes.join(', ')}`);
    assert.ok(codes.includes('NO_SENIOR_AVAILABLE'));
    assert.ok(codes.includes('NO_JUNIOR_AVAILABLE'));
    assert.ok(codes.includes('ATTENDING_COVERAGE_INCOMPLETE'));
    for (const blocker of emptyReadiness.body.blockers) {
      assert.ok(blocker.action && blocker.action.length > 0, `blocker ${blocker.code} must say what to do`);
    }

    // 2. Bulk enrollment enrolls everyone in one call.
    const bulk = await request(`/blocks/${blockOne.id}/availability/bulk`, chiefToken, {
      method: 'POST',
      body: JSON.stringify({ residentIds: residents.map(r => r.id) }),
    });
    assert.equal(bulk.status, 200, JSON.stringify(bulk.body));
    assert.equal(bulk.body.enrolled, 4);
    assert.equal(bulk.body.alreadyEnrolled, 0);

    // 3. Bulk enrollment is idempotent and must not wipe existing vacation.
    await prisma.blockEnrollment.update({
      where: { blockId_residentId: { blockId: blockOne.id, residentId: seniorA.id } },
      data: {
        vacationDates: ['2035-01-10', '2035-01-11', '2035-01-12'].map(dateFromDateKey),
        callCapOverride: 4,
      },
    });
    const bulkAgain = await request(`/blocks/${blockOne.id}/availability/bulk`, chiefToken, {
      method: 'POST',
      body: JSON.stringify({ residentIds: residents.map(r => r.id) }),
    });
    assert.equal(bulkAgain.status, 200);
    assert.equal(bulkAgain.body.enrolled, 0, 're-running bulk enrollment must create nothing new');
    assert.equal(bulkAgain.body.alreadyEnrolled, 4);
    const preserved = await prisma.blockEnrollment.findUnique({
      where: { blockId_residentId: { blockId: blockOne.id, residentId: seniorA.id } },
    });
    assert.equal(preserved.vacationDates.length, 3, 'existing vacation must survive a repeated bulk enroll');
    assert.equal(preserved.callCapOverride, 4);

    // 4. Readiness now reports availability and collapsed vacation periods.
    const readyish = await request(`/blocks/${blockOne.id}/readiness`, chiefToken);
    assert.equal(readyish.body.residents.withAvailability, 4);
    assert.equal(readyish.body.residents.missingAvailability.length, 0);
    assert.equal(readyish.body.vacation.periods, 1, 'three contiguous vacation days are one period');
    assert.deepEqual(
      { from: readyish.body.vacation.list[0].from, to: readyish.body.vacation.list[0].to },
      { from: '2035-01-10', to: '2035-01-12' },
    );
    assert.ok(
      !readyish.body.blockers.some(item => item.severity === 'error'),
      'no error-level blockers should remain once everyone has availability',
    );
    assert.equal(readyish.body.readyToGenerate, true);
    // Attending coverage is still incomplete, but only as a warning.
    assert.ok(readyish.body.blockers.some(item => item.code === 'ATTENDING_COVERAGE_INCOMPLETE' && item.severity === 'warning'));
    assert.equal(readyish.body.attending.complete, false);

    // 5. Copy forward carries configuration but only in-range vacation.
    await prisma.blockEnrollment.update({
      where: { blockId_residentId: { blockId: blockOne.id, residentId: juniorA.id } },
      data: {
        // One date inside block two, two dates that only exist in block one.
        vacationDates: ['2035-01-20', '2035-01-21', '2035-02-03'].map(dateFromDateKey),
        academicDayPref: 'Wednesday',
      },
    });
    const copy = await request(`/blocks/${blockTwo.id}/availability/copy`, chiefToken, {
      method: 'POST',
      body: JSON.stringify({ fromBlockId: blockOne.id }),
    });
    assert.equal(copy.status, 200, JSON.stringify(copy.body));
    assert.equal(copy.body.copied, 4, 'every source enrollment should copy forward');
    assert.equal(copy.body.vacationDatesCopied, 1, 'only the date inside block two may be copied');
    assert.equal(copy.body.vacationDatesDropped, 5, 'out-of-range vacation dates must be dropped, not carried over');

    const copiedJuniorA = await prisma.blockEnrollment.findUnique({
      where: { blockId_residentId: { blockId: blockTwo.id, residentId: juniorA.id } },
    });
    assert.equal(copiedJuniorA.vacationDates.length, 1);
    assert.equal(copiedJuniorA.vacationDates[0].toISOString().slice(0, 10), '2035-02-03');
    assert.equal(copiedJuniorA.academicDayPref, 'Wednesday', 'academic-day preference must carry forward');

    const copiedSeniorA = await prisma.blockEnrollment.findUnique({
      where: { blockId_residentId: { blockId: blockTwo.id, residentId: seniorA.id } },
    });
    assert.equal(copiedSeniorA.callCapOverride, 4, 'call cap override must carry forward');
    assert.equal(copiedSeniorA.vacationDates.length, 0, 'block-one-only vacation must not appear in block two');

    // 6. Copying again must not overwrite work already done in the target.
    await prisma.blockEnrollment.update({
      where: { blockId_residentId: { blockId: blockTwo.id, residentId: seniorB.id } },
      data: { vacationDates: [dateFromDateKey('2035-02-10')] },
    });
    const copyTwice = await request(`/blocks/${blockTwo.id}/availability/copy`, chiefToken, {
      method: 'POST',
      body: JSON.stringify({ fromBlockId: blockOne.id }),
    });
    assert.equal(copyTwice.body.copied, 0, 'nothing should copy when the target is already populated');
    assert.equal(copyTwice.body.skipped.length, 4);
    const untouched = await prisma.blockEnrollment.findUnique({
      where: { blockId_residentId: { blockId: blockTwo.id, residentId: seniorB.id } },
    });
    assert.equal(untouched.vacationDates.length, 1, 'existing target availability must be left alone');

    // 7. Copying to the same block is refused.
    const selfCopy = await request(`/blocks/${blockTwo.id}/availability/copy`, chiefToken, {
      method: 'POST',
      body: JSON.stringify({ fromBlockId: blockTwo.id }),
    });
    assert.equal(selfCopy.status, 400);

    // 8. A viewer may not change availability.
    const viewerBulk = await request(`/blocks/${blockOne.id}/availability/bulk`, viewerToken, {
      method: 'POST',
      body: JSON.stringify({ residentIds: [juniorB.id] }),
    });
    assert.equal(viewerBulk.status, 403, 'a viewer must not be able to set block availability');
    const viewerCopy = await request(`/blocks/${blockTwo.id}/availability/copy`, viewerToken, {
      method: 'POST',
      body: JSON.stringify({ fromBlockId: blockOne.id }),
    });
    assert.equal(viewerCopy.status, 403);
    const viewerReadiness = await request(`/blocks/${blockOne.id}/readiness`, viewerToken);
    assert.equal(viewerReadiness.status, 403, 'a viewer must not read draft readiness');

    // 9. A resident from another program cannot be smuggled in.
    const otherOrg = await prisma.organization.create({ data: { name: `${tag}_OTHER`, country: 'CA', status: 'active' } });
    const otherProgram = await prisma.program.create({ data: { name: `${tag}_OTHER_PROGRAM`, specialty: 'Neurology', orgId: otherOrg.id } });
    const foreignResident = await prisma.residentProfile.create({
      data: { programId: otherProgram.id, name: `${tag}_FOREIGN`, pgyLevel: '3', residentRole: 'senior' },
    });
    const foreign = await request(`/blocks/${blockOne.id}/availability/bulk`, chiefToken, {
      method: 'POST',
      body: JSON.stringify({ residentIds: [foreignResident.id] }),
    });
    assert.equal(foreign.status, 400, 'a resident from another program must be rejected');
    await prisma.residentProfile.deleteMany({ where: { programId: otherProgram.id } });
    await prisma.program.deleteMany({ where: { id: otherProgram.id } });
    await prisma.organization.deleteMany({ where: { id: otherOrg.id } });

    // 10. Bad input is rejected before anything is written.
    const emptyList = await request(`/blocks/${blockOne.id}/availability/bulk`, chiefToken, {
      method: 'POST',
      body: JSON.stringify({ residentIds: [] }),
    });
    assert.equal(emptyList.status, 400);

    console.log('[block-availability-smoke] bulk enrollment, copy-forward and readiness checks passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await cleanup(orgId);
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('[block-availability-smoke] failed:', error.message);
  process.exitCode = 1;
});
