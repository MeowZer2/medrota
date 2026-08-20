// Regression guard for QA test isolation.
//
// Browser tests have to create real registry records, and the product has no
// hard delete, so for a while every Playwright run left another deactivated
// attending, activity and clinical service in the local QA program. After a few
// dozen runs the inactive lists were unusable.
//
// This proves the loop is closed: two consecutive seed/test cycles leave the QA
// program with exactly the inactive counts it started with, and a deactivated
// record a developer created by hand survives both cycles untouched. No
// database reset is involved anywhere.

const assert = require('assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const prisma = require('../lib/prisma');
const { E2E_PREFIX, findQaProgram, inactiveRegistryCounts } = require('./lib/qaRegistry');

const backendRoot = path.join(__dirname, '..');
const DEVELOPER_RECORD = 'QA_ONLY Developer Kept Service';

function run(script) {
  execFileSync(process.execPath, [path.join('scripts', script)], { cwd: backendRoot, stdio: 'pipe' });
}

// What a Playwright run leaves behind: records it created, then deactivated
// rather than deleted, because deactivating is all the product offers.
async function simulateBrowserRun(programId, runLabel) {
  const suffix = `${runLabel} ${Date.now()}`;
  await prisma.attendingRoster.create({
    data: { programId, attendingName: `${E2E_PREFIX} Attending ${suffix}`, typicalActivities: [], isActive: false },
  });
  await prisma.attendingActivityType.create({
    data: { programId, name: `${E2E_PREFIX} Activity ${suffix}`, normalizedName: `${E2E_PREFIX} activity ${suffix}`.toLowerCase(), isActive: false },
  });
  await prisma.programService.create({
    data: { programId, name: `${E2E_PREFIX} Service ${suffix}`, normalizedName: `${E2E_PREFIX} service ${suffix}`.toLowerCase(), isActive: false },
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the QA isolation smoke when NODE_ENV=production');
  }

  run('dev-seed-qa.js');
  const program = await findQaProgram();
  assert.ok(program, 'the QA seed creates the QA program');

  // A record that belongs to whoever is using this database, not to the test
  // suite. Nothing in the QA tooling is allowed to remove it.
  const developerRecord = await prisma.programService.upsert({
    where: { programId_normalizedName: { programId: program.id, normalizedName: DEVELOPER_RECORD.toLowerCase() } },
    update: { isActive: false },
    create: { programId: program.id, name: DEVELOPER_RECORD, normalizedName: DEVELOPER_RECORD.toLowerCase(), isActive: false },
  });

  try {
    const baseline = await inactiveRegistryCounts(program.id);
    console.log(`[qa-isolation-smoke] baseline inactive counts ${JSON.stringify(baseline)}`);

    for (const cycle of [1, 2]) {
      await simulateBrowserRun(program.id, `Cycle ${cycle}`);

      const polluted = await inactiveRegistryCounts(program.id);
      assert.deepEqual(polluted, {
        attendings: baseline.attendings + 1,
        activities: baseline.activities + 1,
        services: baseline.services + 1,
      }, `cycle ${cycle} really did leave deactivated records behind`);

      run('qa-e2e-cleanup.js');
      run('dev-seed-qa.js');

      const settled = await inactiveRegistryCounts(program.id);
      assert.deepEqual(settled, baseline, `cycle ${cycle} leaves the QA program at its baseline inactive counts`);

      const survivor = await prisma.programService.findUnique({ where: { id: developerRecord.id } });
      assert.ok(survivor, `cycle ${cycle} leaves a developer's own QA record in place`);
      assert.equal(survivor.isActive, false, `cycle ${cycle} leaves a developer's own QA record deactivated`);

      const leftovers = await prisma.attendingRoster.count({ where: { programId: program.id, attendingName: { startsWith: E2E_PREFIX } } });
      assert.equal(leftovers, 0, `cycle ${cycle} removes every record the suite owns`);
      console.log(`[qa-isolation-smoke] cycle ${cycle} settled at ${JSON.stringify(settled)}`);
    }

    // The seed's own fixtures are not collateral damage.
    const seededActivities = await prisma.attendingActivityType.count({ where: { programId: program.id, name: { in: ['Clinic', 'OR', 'Ward'] }, isActive: true } });
    assert.equal(seededActivities, 3, 'the seeded activity types survive the cleanup');
    const seededStaff = await prisma.attendingRoster.count({ where: { programId: program.id, attendingName: { startsWith: 'QA_ONLY Dr ' }, isActive: true } });
    assert.ok(seededStaff >= 2, 'the seeded attending roster survives the cleanup');

    console.log('[qa-isolation-smoke] two consecutive QA seed/test cycles kept the inactive counts stable');
  } finally {
    await prisma.programService.deleteMany({ where: { id: developerRecord.id } });
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error('[qa-isolation-smoke] failed:', error.message ?? error);
  process.exitCode = 1;
});
