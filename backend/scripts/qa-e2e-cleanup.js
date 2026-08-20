// Removes the registry records the browser suite created in the QA program.
//
// Playwright runs this as its global teardown, so a suite leaves the QA program
// exactly as it found it and repeated runs cannot inflate the inactive lists.
// Only `QA_ONLY E2E` records inside the QA program are touched.

const prisma = require('../lib/prisma');
const { E2E_PREFIX, findQaProgram, inactiveRegistryCounts, pruneE2ERegistryRecords } = require('./lib/qaRegistry');

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to clean QA data when NODE_ENV=production');
  }
  const program = await findQaProgram();
  if (!program) {
    console.log('[qa:cleanup-e2e] No QA program found; nothing to clean.');
    return;
  }
  const removed = await pruneE2ERegistryRecords(program.id);
  const remaining = await inactiveRegistryCounts(program.id);
  console.log(`[qa:cleanup-e2e] Removed ${removed.attendings} attendings, ${removed.activities} activities and ${removed.services} services named "${E2E_PREFIX}*".`);
  console.log(`[qa:cleanup-e2e] Inactive records still held by the QA program: ${JSON.stringify(remaining)}`);
}

main()
  .catch(err => {
    console.error('[qa:cleanup-e2e] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
