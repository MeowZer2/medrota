// Read-only scheduling data integrity analysis.
//
// This module never mutates. It classifies legacy inconsistencies that predate
// the current constraints so an operator can decide what to do about them, and
// so the repair script and its tests share one definition of "safe to fix".

const prisma = require('../lib/prisma');

const RESIDENT_ROLES_ON_DAY = ['senior', 'junior'];

function dateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

// Mirrors residentCanFillRole in routes/assignments.js so the audit agrees with
// what the API would accept today.
function residentCanFillRole(resident, roleOnDay) {
  if (!resident || resident.isActive === false) return false;
  if (roleOnDay === 'senior') return !resident.isMedStudent && resident.residentRole === 'senior';
  return resident.isMedStudent || resident.residentRole === 'junior';
}

// A stable, non-identifying handle for logs. Names are only ever included when
// the caller explicitly opts in.
function describeResident(resident, includeNames) {
  return {
    residentId: resident.id,
    ...(includeNames ? { name: resident.name } : {}),
    role: resident.residentRole,
    isMedStudent: resident.isMedStudent,
    isActive: resident.isActive,
  };
}

/**
 * Classify one duplicate (callDayId, roleOnDay) group.
 *
 * Returns a resolution with keepId/removeIds when a deterministic rule applies,
 * or rule 'ambiguous' when none does. Ambiguity is always preferred to a guess.
 */
function classifyDuplicateGroup(rows, roleOnDay, snapshotResidentIds) {
  const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt);

  // Rule 1 - an explicit manual override is an intentional human decision and
  // beats any generated row.
  const overrides = sorted.filter(r => r.isOverride);
  if (overrides.length === 1) {
    const keep = overrides[0];
    return {
      rule: 'override-precedence',
      keepId: keep.id,
      removeIds: sorted.filter(r => r.id !== keep.id).map(r => r.id),
      rationale: 'Exactly one row is a documented manual override; generated rows in the same slot are superseded.',
    };
  }
  if (overrides.length > 1) {
    return {
      rule: 'ambiguous',
      rationale: 'Multiple manual overrides occupy the same slot. Two intentional human decisions conflict; only the owner can choose.',
    };
  }

  // Rule 2 - a resident who cannot legally fill this slot today was written by a
  // scheduler that did not enforce the rule.
  const ineligible = sorted.filter(r => !residentCanFillRole(r.resident, roleOnDay));
  const eligible = sorted.filter(r => residentCanFillRole(r.resident, roleOnDay));
  if (ineligible.length > 0 && eligible.length === 1) {
    return {
      rule: 'ineligible-surplus',
      keepId: eligible[0].id,
      removeIds: ineligible.map(r => r.id),
      rationale: `Only one row holds a resident eligible for the ${roleOnDay} slot under current rules; the others could not be created today.`,
    };
  }

  // Rule 3 - the legacy generator ran a second pass that appended a medical
  // student to days that already had a junior. The current scheduler only places
  // a medical student when junior coverage is empty, so the medical-student row
  // is the surplus one.
  const medStudents = sorted.filter(r => r.resident.isMedStudent);
  const juniorResidents = sorted.filter(r => !r.resident.isMedStudent);
  if (roleOnDay === 'junior'
      && medStudents.length > 0
      && juniorResidents.length === 1
      && residentCanFillRole(juniorResidents[0].resident, roleOnDay)) {
    return {
      rule: 'med-student-surplus',
      keepId: juniorResidents[0].id,
      removeIds: medStudents.map(r => r.id),
      rationale: 'A medical student shares the junior slot with a junior resident. The scheduler only assigns a medical student when junior coverage is empty, so the medical-student row is a legacy second-pass duplicate.',
    };
  }

  // Rule 4 - a published snapshot names exactly one of these residents in this
  // slot, which corroborates which row the program actually used.
  if (snapshotResidentIds && snapshotResidentIds.size > 0) {
    const inSnapshot = sorted.filter(r => snapshotResidentIds.has(r.residentId));
    if (inSnapshot.length === 1) {
      return {
        rule: 'published-snapshot-corroborated',
        keepId: inSnapshot[0].id,
        removeIds: sorted.filter(r => r.id !== inSnapshot[0].id).map(r => r.id),
        rationale: 'The most recent published snapshot records exactly one of these residents in this slot.',
      };
    }
  }

  return {
    rule: 'ambiguous',
    rationale: 'No deterministic rule distinguishes these rows. They are preserved for owner review.',
  };
}

async function analyzeDuplicateRoleSlots(includeNames) {
  const groups = await prisma.$queryRawUnsafe(`
    SELECT "callDayId", "roleOnDay", COUNT(*)::int AS n
    FROM "CallAssignment"
    GROUP BY "callDayId", "roleOnDay"
    HAVING COUNT(*) > 1
  `);

  const findings = [];
  for (const group of groups) {
    const callDay = await prisma.callDay.findUnique({
      where: { id: group.callDayId },
      include: {
        block: {
          include: {
            academicYear: { select: { programId: true } },
            versions: {
              orderBy: { publishedAt: 'desc' },
              take: 1,
              select: { snapshotJson: true, publishedAt: true },
            },
          },
        },
      },
    });
    if (!callDay) continue;

    const rows = await prisma.callAssignment.findMany({
      where: { callDayId: group.callDayId, roleOnDay: group.roleOnDay },
      include: { resident: true },
    });

    // Which residents does the latest published snapshot record in this slot?
    const snapshotResidentIds = new Set();
    const latest = callDay.block.versions[0];
    for (const snapDay of latest?.snapshotJson?.callDays ?? []) {
      if (dateKey(snapDay.date) !== dateKey(callDay.date)) continue;
      for (const snapAssignment of snapDay.assignments ?? []) {
        if (snapAssignment.roleOnDay === group.roleOnDay && snapAssignment.residentId) {
          snapshotResidentIds.add(snapAssignment.residentId);
        }
      }
    }

    findings.push({
      callDayId: callDay.id,
      blockId: callDay.blockId,
      blockNumber: callDay.block.number,
      programId: callDay.block.academicYear.programId,
      date: dateKey(callDay.date),
      roleOnDay: group.roleOnDay,
      rowCount: group.n,
      blockIsPublished: callDay.block.isPublished,
      publishedVersionCount: callDay.block.versions.length,
      rows: rows
        .slice()
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(r => ({
          assignmentId: r.id,
          isOverride: r.isOverride,
          hasOverrideReason: Boolean(r.overrideReason),
          createdAt: r.createdAt.toISOString(),
          ...describeResident(r.resident, includeNames),
        })),
      resolution: classifyDuplicateGroup(rows, group.roleOnDay, snapshotResidentIds),
    });
  }

  findings.sort((a, b) => a.date.localeCompare(b.date) || a.roleOnDay.localeCompare(b.roleOnDay));
  return findings;
}

async function analyzeSameResidentBothSlots(includeNames) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT "callDayId", "residentId", COUNT(*)::int AS n
    FROM "CallAssignment"
    WHERE "roleOnDay" IN ('senior', 'junior')
    GROUP BY "callDayId", "residentId"
    HAVING COUNT(*) > 1
  `);
  const findings = [];
  for (const row of rows) {
    const callDay = await prisma.callDay.findUnique({ where: { id: row.callDayId } });
    const resident = await prisma.residentProfile.findUnique({ where: { id: row.residentId } });
    findings.push({
      callDayId: row.callDayId,
      blockId: callDay?.blockId ?? null,
      date: callDay ? dateKey(callDay.date) : null,
      slotCount: row.n,
      ...(resident ? describeResident(resident, includeNames) : { residentId: row.residentId }),
    });
  }
  return findings;
}

async function analyzeCrossProgramAssignments(includeNames) {
  const assignments = await prisma.callAssignment.findMany({
    include: {
      resident: true,
      callDay: { include: { block: { include: { academicYear: { select: { programId: true } } } } } },
    },
  });
  return assignments
    .filter(a => a.resident.programId !== a.callDay.block.academicYear.programId)
    .map(a => ({
      assignmentId: a.id,
      date: dateKey(a.callDay.date),
      blockId: a.callDay.blockId,
      blockProgramId: a.callDay.block.academicYear.programId,
      residentProgramId: a.resident.programId,
      ...describeResident(a.resident, includeNames),
    }));
}

async function analyzeIneligibleRoleAssignments(includeNames) {
  const assignments = await prisma.callAssignment.findMany({
    include: { resident: true, callDay: true },
  });
  return assignments
    .filter(a => RESIDENT_ROLES_ON_DAY.includes(a.roleOnDay) && !residentCanFillRole(a.resident, a.roleOnDay))
    .map(a => ({
      assignmentId: a.id,
      date: dateKey(a.callDay.date),
      blockId: a.callDay.blockId,
      roleOnDay: a.roleOnDay,
      isOverride: a.isOverride,
      ...describeResident(a.resident, includeNames),
    }));
}

async function analyzeAssignmentsWithoutEnrollment(includeNames) {
  const [assignments, enrollments] = await Promise.all([
    prisma.callAssignment.findMany({ include: { resident: true, callDay: true } }),
    prisma.blockEnrollment.findMany({ select: { blockId: true, residentId: true } }),
  ]);
  const enrolled = new Set(enrollments.map(e => `${e.blockId}:${e.residentId}`));
  return assignments
    .filter(a => !enrolled.has(`${a.callDay.blockId}:${a.residentId}`))
    .map(a => ({
      assignmentId: a.id,
      blockId: a.callDay.blockId,
      date: dateKey(a.callDay.date),
      roleOnDay: a.roleOnDay,
      ...describeResident(a.resident, includeNames),
    }));
}

async function analyzeCallDaysOutsideBlock() {
  const callDays = await prisma.callDay.findMany({ include: { block: true } });
  return callDays
    .filter(cd => dateKey(cd.date) < dateKey(cd.block.startDate) || dateKey(cd.date) > dateKey(cd.block.endDate))
    .map(cd => ({
      callDayId: cd.id,
      blockId: cd.blockId,
      blockNumber: cd.block.number,
      date: dateKey(cd.date),
      blockStart: dateKey(cd.block.startDate),
      blockEnd: dateKey(cd.block.endDate),
    }));
}

async function analyzePublishedWithoutVersion() {
  const blocks = await prisma.block.findMany({
    where: { isPublished: true },
    include: { _count: { select: { versions: true } } },
  });
  return blocks
    .filter(b => b._count.versions === 0)
    .map(b => ({ blockId: b.id, blockNumber: b.number, hasPublicToken: Boolean(b.publicToken) }));
}

async function runIntegrityAudit({ includeNames = false } = {}) {
  const duplicateRoleSlots = await analyzeDuplicateRoleSlots(includeNames);
  const sameResidentBothSlots = await analyzeSameResidentBothSlots(includeNames);
  const crossProgramAssignments = await analyzeCrossProgramAssignments(includeNames);
  const ineligibleRoleAssignments = await analyzeIneligibleRoleAssignments(includeNames);
  const assignmentsWithoutEnrollment = await analyzeAssignmentsWithoutEnrollment(includeNames);
  const callDaysOutsideBlock = await analyzeCallDaysOutsideBlock();
  const publishedWithoutVersion = await analyzePublishedWithoutVersion();

  const resolvable = duplicateRoleSlots.filter(f => f.resolution.rule !== 'ambiguous');
  const ambiguous = duplicateRoleSlots.filter(f => f.resolution.rule === 'ambiguous');

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      callAssignments: await prisma.callAssignment.count(),
      callDays: await prisma.callDay.count(),
      blocks: await prisma.block.count(),
    },
    duplicateRoleSlots,
    duplicateRoleSlotSummary: {
      groups: duplicateRoleSlots.length,
      rows: duplicateRoleSlots.reduce((sum, f) => sum + f.rowCount, 0),
      deterministicallyResolvable: resolvable.length,
      ambiguous: ambiguous.length,
      rowsToRemove: resolvable.reduce((sum, f) => sum + f.resolution.removeIds.length, 0),
    },
    sameResidentBothSlots,
    crossProgramAssignments,
    ineligibleRoleAssignments,
    assignmentsWithoutEnrollment,
    callDaysOutsideBlock,
    publishedWithoutVersion,
  };
}

// True only when every duplicate group can be resolved by a deterministic rule,
// which is the precondition for adding UNIQUE(callDayId, roleOnDay).
function canAddRoleSlotUniqueness(report) {
  return report.duplicateRoleSlotSummary.ambiguous === 0;
}

module.exports = {
  runIntegrityAudit,
  analyzeDuplicateRoleSlots,
  classifyDuplicateGroup,
  residentCanFillRole,
  canAddRoleSlotUniqueness,
  dateKey,
};
