// Block availability helpers.
//
// Entering per-block availability for every resident is the largest setup cost
// a Chief Resident carries, so these operations make it fast without weakening
// the rule that availability must be explicit. Nothing here infers availability
// from absence: a resident is only ever enrolled because someone said so.

const prisma = require('../lib/prisma');
const { normalizeDateKey, dateFromDateKey } = require('./paroRules');

function blockDateKeys(block) {
  const keys = [];
  const cursor = dateFromDateKey(normalizeDateKey(block.startDate));
  const end = dateFromDateKey(normalizeDateKey(block.endDate));
  while (cursor <= end) {
    keys.push(normalizeDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

/** Collapse a sorted list of date keys into inclusive ranges for display. */
function toRanges(dateKeys) {
  const sorted = [...new Set(dateKeys.map(normalizeDateKey).filter(Boolean))].sort();
  const ranges = [];
  for (const dateKey of sorted) {
    const last = ranges[ranges.length - 1];
    if (last) {
      const next = dateFromDateKey(last.to);
      next.setUTCDate(next.getUTCDate() + 1);
      if (normalizeDateKey(next) === dateKey) {
        last.to = dateKey;
        continue;
      }
    }
    ranges.push({ from: dateKey, to: dateKey });
  }
  return ranges;
}

/**
 * Enroll several residents in a block in one call.
 *
 * Already-enrolled residents are left exactly as they are: this adds
 * availability, it never silently wipes vacation someone already entered.
 */
async function bulkEnroll(blockId, residentIds) {
  const unique = [...new Set(residentIds)];
  const [block, residents, existing] = await Promise.all([
    prisma.block.findUnique({
      where: { id: blockId },
      select: { id: true, academicYear: { select: { programId: true } } },
    }),
    prisma.residentProfile.findMany({ where: { id: { in: unique } } }),
    prisma.blockEnrollment.findMany({ where: { blockId, residentId: { in: unique } }, select: { residentId: true } }),
  ]);
  if (!block) return { error: 'Block not found', status: 404 };

  const programId = block.academicYear?.programId;
  const foreign = residents.filter(resident => resident.programId !== programId);
  if (foreign.length > 0 || residents.length !== unique.length) {
    return { error: 'Every resident must belong to the same program as the block', status: 400 };
  }

  const alreadyEnrolled = new Set(existing.map(row => row.residentId));
  const toCreate = unique.filter(id => !alreadyEnrolled.has(id));

  if (toCreate.length > 0) {
    await prisma.blockEnrollment.createMany({
      data: toCreate.map(residentId => ({ blockId, residentId, vacationDates: [] })),
      skipDuplicates: true,
    });
  }

  return {
    blockId,
    enrolled: toCreate.length,
    alreadyEnrolled: alreadyEnrolled.size,
    residentIds: unique,
  };
}

/**
 * Copy enrollment configuration from one block to another.
 *
 * Service status, call cap override and academic-day preference carry over.
 * Vacation dates only carry over when they actually fall inside the target
 * block, because a date from last block is meaningless in this one. Residents
 * already enrolled in the target are skipped so existing work is never lost.
 */
async function copyAvailabilityForward(fromBlockId, toBlockId, residentIds = null) {
  if (fromBlockId === toBlockId) {
    return { error: 'Source and target block must be different', status: 400 };
  }
  const [fromBlock, toBlock] = await Promise.all([
    prisma.block.findUnique({ where: { id: fromBlockId }, include: { academicYear: { select: { programId: true } } } }),
    prisma.block.findUnique({ where: { id: toBlockId }, include: { academicYear: { select: { programId: true } } } }),
  ]);
  if (!fromBlock || !toBlock) return { error: 'Block not found', status: 404 };
  if (fromBlock.academicYear?.programId !== toBlock.academicYear?.programId) {
    return { error: 'Both blocks must belong to the same program', status: 400 };
  }

  const targetDateKeys = new Set(blockDateKeys(toBlock));
  const sourceEnrollments = await prisma.blockEnrollment.findMany({
    where: {
      blockId: fromBlockId,
      ...(residentIds ? { residentId: { in: residentIds } } : {}),
    },
    include: { resident: { select: { id: true, name: true, isActive: true } } },
  });
  const existing = await prisma.blockEnrollment.findMany({
    where: { blockId: toBlockId },
    select: { residentId: true },
  });
  const alreadyEnrolled = new Set(existing.map(row => row.residentId));

  const created = [];
  const skipped = [];
  let vacationDatesCopied = 0;
  let vacationDatesDropped = 0;

  for (const enrollment of sourceEnrollments) {
    if (alreadyEnrolled.has(enrollment.residentId)) {
      skipped.push({ residentId: enrollment.residentId, reason: 'already has availability in the target block' });
      continue;
    }
    if (enrollment.resident.isActive === false) {
      skipped.push({ residentId: enrollment.residentId, reason: 'resident is inactive' });
      continue;
    }

    const overlapping = (enrollment.vacationDates ?? [])
      .map(normalizeDateKey)
      .filter(Boolean)
      .filter(dateKey => targetDateKeys.has(dateKey));
    vacationDatesCopied += overlapping.length;
    vacationDatesDropped += (enrollment.vacationDates?.length ?? 0) - overlapping.length;

    created.push({
      blockId: toBlockId,
      residentId: enrollment.residentId,
      vacationDates: overlapping.map(dateFromDateKey),
      academicDayPref: enrollment.academicDayPref,
      callCapOverride: enrollment.callCapOverride,
    });
  }

  if (created.length > 0) {
    await prisma.blockEnrollment.createMany({ data: created, skipDuplicates: true });
  }

  return {
    fromBlockId,
    toBlockId,
    copied: created.length,
    skipped,
    vacationDatesCopied,
    vacationDatesDropped,
  };
}

/**
 * Everything a Chief Resident should know before pressing Generate.
 *
 * Reported before generation rather than only afterwards, so missing
 * availability is a task to finish rather than a surprise in the results.
 */
async function getBlockReadiness(blockId) {
  const block = await prisma.block.findUnique({
    where: { id: blockId },
    include: {
      settings: true,
      academicYear: { select: { programId: true, holidays: true } },
      enrollments: { include: { resident: true } },
      attendingEntries: { select: { date: true, attendingName: true } },
      flags: { select: { date: true, label: true } },
    },
  });
  if (!block) return null;

  const programId = block.academicYear?.programId;
  const activeServiceResidents = await prisma.residentProfile.findMany({
    where: { programId, isActive: true, isServiceResident: true },
    orderBy: { createdAt: 'asc' },
  });

  const enrolledIds = new Set(block.enrollments.map(item => item.residentId));
  const missingAvailability = activeServiceResidents
    .filter(resident => !enrolledIds.has(resident.id))
    .map(resident => ({
      residentId: resident.id,
      residentName: resident.name,
      residentRole: resident.residentRole,
    }));

  const dateKeys = blockDateKeys(block);
  const attendingByDate = new Set(
    block.attendingEntries.map(entry => normalizeDateKey(entry.date)).filter(Boolean),
  );
  const attendingMissingDates = dateKeys.filter(dateKey => !attendingByDate.has(dateKey));

  const vacationPeriods = block.enrollments.flatMap(enrollment =>
    toRanges(enrollment.vacationDates ?? []).map(range => ({
      residentId: enrollment.residentId,
      residentName: enrollment.resident.name,
      from: range.from,
      to: range.to,
    })),
  );

  const enrolledSeniors = block.enrollments.filter(
    item => item.resident.residentRole === 'senior' && !item.resident.isMedStudent && item.resident.isActive,
  ).length;
  const enrolledJuniors = block.enrollments.filter(
    item => item.resident.residentRole === 'junior' && !item.resident.isMedStudent && item.resident.isActive,
  ).length;

  const blockers = [];
  if (missingAvailability.length > 0) {
    blockers.push({
      code: 'MISSING_AVAILABILITY',
      severity: 'error',
      message: `${missingAvailability.length} active service resident${missingAvailability.length === 1 ? '' : 's'} ${missingAvailability.length === 1 ? 'has' : 'have'} no block availability and will be skipped by the generator.`,
      action: 'Set block availability for them, or mark them inactive if they are not on service.',
    });
  }
  if (enrolledSeniors === 0) {
    blockers.push({
      code: 'NO_SENIOR_AVAILABLE',
      severity: 'error',
      message: 'No senior resident has availability in this block.',
      action: 'Add block availability for at least one senior resident.',
    });
  }
  if (enrolledJuniors === 0) {
    blockers.push({
      code: 'NO_JUNIOR_AVAILABLE',
      severity: 'error',
      message: 'No junior resident has availability in this block.',
      action: 'Add block availability for at least one junior resident.',
    });
  }
  if (attendingMissingDates.length > 0) {
    blockers.push({
      code: 'ATTENDING_COVERAGE_INCOMPLETE',
      severity: 'warning',
      message: `Attending coverage is missing on ${attendingMissingDates.length} of ${dateKeys.length} days.`,
      action: 'Complete the attending schedule for this block.',
    });
  }

  return {
    blockId,
    blockNumber: block.number,
    startDate: normalizeDateKey(block.startDate),
    endDate: normalizeDateKey(block.endDate),
    totalDays: dateKeys.length,
    residents: {
      activeServiceTotal: activeServiceResidents.length,
      withAvailability: activeServiceResidents.length - missingAvailability.length,
      enrolledSeniors,
      enrolledJuniors,
      missingAvailability,
    },
    vacation: {
      periods: vacationPeriods.length,
      list: vacationPeriods,
    },
    attending: {
      daysCovered: dateKeys.length - attendingMissingDates.length,
      totalDays: dateKeys.length,
      complete: attendingMissingDates.length === 0,
      missingDates: attendingMissingDates,
    },
    holidays: (block.academicYear?.holidays ?? [])
      .map(item => normalizeDateKey(item.date))
      .filter(dateKey => dateKey >= normalizeDateKey(block.startDate) && dateKey <= normalizeDateKey(block.endDate)),
    academicDays: block.flags
      .filter(flag => /academic/i.test(flag.label))
      .map(flag => normalizeDateKey(flag.date)),
    blockers,
    readyToGenerate: blockers.every(item => item.severity !== 'error'),
  };
}

module.exports = {
  bulkEnroll,
  copyAvailabilityForward,
  getBlockReadiness,
  toRanges,
  blockDateKeys,
};
