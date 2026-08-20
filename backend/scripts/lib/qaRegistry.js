// Ownership rules for the records browser tests create in the QA program.
//
// The browser suite has to add real registry records to exercise adding,
// renaming, deactivating and restoring. Left behind, those records piled up:
// every run added another deactivated attending, activity and service, until a
// local QA database held dozens of them. Nothing deleted them, because the
// product deliberately has no hard delete.
//
// So the tests name everything they create with one owned prefix, and only
// records carrying that prefix, inside the QA program, are ever removed. A
// developer's own QA records - and every record in every other program - are
// untouched by anything in this file. No database reset is involved.

const prisma = require('../../lib/prisma');

const QA_ORG_NAME = 'MedRota QA';
const QA_PROGRAM_NAME = 'QA Vascular Surgery';

// Every record a spec creates must start with this. `QA_ONLY` alone is not
// enough: the seed's own fixtures use that prefix and must survive.
const E2E_PREFIX = 'QA_ONLY E2E';

// Residue from before the convention existed. These names were only ever
// produced by the browser suite, each with a millisecond timestamp appended, so
// they are safe to sweep out of an existing developer database. They can be
// dropped from this list once no such database is left.
const LEGACY_E2E_PREFIXES = Object.freeze([
  'QA_ONLY Lifecycle ',
  'QA_ONLY Reachability ',
  'QA_ONLY Trauma ',
  'QA_ONLY Angio ',
  'QA_ONLY Viewer ',
]);

function ownedNameFilter(field) {
  return { OR: [E2E_PREFIX, ...LEGACY_E2E_PREFIXES].map(prefix => ({ [field]: { startsWith: prefix } })) };
}

async function findQaProgram() {
  const org = await prisma.organization.findFirst({ where: { name: QA_ORG_NAME }, select: { id: true } });
  if (!org) return null;
  return prisma.program.findFirst({ where: { name: QA_PROGRAM_NAME, orgId: org.id }, select: { id: true, name: true } });
}

/**
 * Delete the registry records the browser suite owns in one program.
 *
 * Activity types and services are referenced from schedule history by nullable
 * foreign keys declared `onDelete: SetNull`, so removing them cannot damage a
 * schedule; the stored activity text on those historical rows stays readable.
 */
async function pruneE2ERegistryRecords(programId) {
  if (!programId) return { attendings: 0, activities: 0, services: 0 };
  const ownedByName = { programId, ...ownedNameFilter('name') };
  const [activities, services, attendings] = await prisma.$transaction([
    prisma.attendingActivityType.deleteMany({ where: ownedByName }),
    prisma.programService.deleteMany({ where: ownedByName }),
    prisma.attendingRoster.deleteMany({ where: { programId, ...ownedNameFilter('attendingName') } }),
  ]);
  return { attendings: attendings.count, activities: activities.count, services: services.count };
}

/** Inactive counts per registry, used to prove a QA cycle leaves no residue. */
async function inactiveRegistryCounts(programId) {
  const [attendings, activities, services] = await Promise.all([
    prisma.attendingRoster.count({ where: { programId, isActive: false } }),
    prisma.attendingActivityType.count({ where: { programId, isActive: false } }),
    prisma.programService.count({ where: { programId, isActive: false } }),
  ]);
  return { attendings, activities, services };
}

module.exports = {
  E2E_PREFIX,
  LEGACY_E2E_PREFIXES,
  QA_ORG_NAME,
  QA_PROGRAM_NAME,
  findQaProgram,
  inactiveRegistryCounts,
  pruneE2ERegistryRecords,
};
