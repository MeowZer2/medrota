const prisma = require('../lib/prisma');

const DAYS = Object.freeze(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
const PERIODS = Object.freeze(['AM', 'PM', 'Full day']);

function validDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function calculatePgyLevel(programStartDate, referenceDate) {
  const start = validDate(programStartDate);
  const reference = validDate(referenceDate);
  if (!start || !reference || reference < start) return null;
  let years = reference.getUTCFullYear() - start.getUTCFullYear();
  const anniversary = new Date(Date.UTC(
    reference.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(),
  ));
  if (reference < anniversary) years -= 1;
  return Math.max(1, years + 1);
}

function isResidentEligibleForBlock(resident, block) {
  if (!resident || !block || resident.isActive === false || resident.isServiceResident === false || resident.isMedStudent) return false;
  const start = validDate(resident.programStartDate);
  const completion = validDate(resident.expectedCompletionDate);
  const blockStart = validDate(block.startDate);
  const blockEnd = validDate(block.endDate);
  if (!blockStart || !blockEnd) return false;
  if (start && blockEnd < start) return false;
  if (completion && blockStart > completion) return false;
  return true;
}

function effectivePgy(resident, referenceDate) {
  const calculated = calculatePgyLevel(resident.programStartDate, referenceDate);
  if (calculated !== null) return { level: String(calculated), source: 'calculated' };
  return { level: String(resident.pgyLevel ?? '').replace(/^PGY-?/i, ''), source: 'manual' };
}

function effectiveResidentRole(resident, program, referenceDate) {
  if (resident.residentRoleOverride === 'junior' || resident.residentRoleOverride === 'senior') {
    return { role: resident.residentRoleOverride, source: 'override' };
  }
  const pgy = effectivePgy(resident, referenceDate);
  const numeric = Number.parseInt(pgy.level, 10);
  if (pgy.source === 'calculated' && Number.isInteger(numeric)) {
    const juniorLevels = Array.isArray(program?.juniorPgyLevels) ? program.juniorPgyLevels : [1, 2];
    return { role: juniorLevels.includes(numeric) ? 'junior' : 'senior', source: 'calculated' };
  }
  return { role: resident.residentRole || 'junior', source: 'manual' };
}

function normalizeAcademicTimes(raw, legacyValue = null) {
  const entries = Array.isArray(raw) ? raw : [];
  if (entries.length === 0 && legacyValue && legacyValue !== 'None') {
    const match = String(legacyValue).trim().match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s+(AM|PM|Full day))?$/i);
    if (match) entries.push({ day: DAYS.find(day => day.toLowerCase() === match[1].toLowerCase()), period: match[2] || 'Full day' });
  }
  const seen = new Set();
  const normalized = [];
  for (const entry of entries) {
    const day = DAYS.find(item => item.toLowerCase() === String(entry?.day ?? '').toLowerCase());
    const period = PERIODS.find(item => item.toLowerCase() === String(entry?.period ?? '').toLowerCase());
    if (!day || !period) continue;
    const key = `${day}|${period}`;
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push({ day, period });
    }
  }
  return normalized;
}

function academicTimesValidationError(raw) {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) return 'academicTimes must be an array';
  if (normalizeAcademicTimes(raw).length !== raw.length) {
    return 'Academic time entries require a unique Monday-Sunday day and AM, PM, or Full day period';
  }
  return null;
}

async function syncAutomaticEnrollmentsForBlock(blockId) {
  // Pure scheduler unit fixtures may provide only the models they exercise.
  if (!prisma.blockEnrollment?.findMany || !prisma.blockEnrollment?.createMany) return { created: 0, residentIds: [] };
  const block = await prisma.block.findUnique({
    where: { id: blockId },
    include: { academicYear: { select: { programId: true } } },
  });
  if (!block) return { created: 0, residentIds: [] };
  const programId = block.academicYear?.programId ?? block.academicYear?.program?.id;
  const residents = await prisma.residentProfile.findMany({
    where: { programId, isActive: true, isServiceResident: true, isMedStudent: false },
  });
  const eligible = residents.filter(resident => isResidentEligibleForBlock(resident, block));
  if (eligible.length === 0) return { created: 0, residentIds: [] };
  const existing = await prisma.blockEnrollment.findMany({
    where: { blockId, residentId: { in: eligible.map(item => item.id) } },
    select: { residentId: true },
  });
  const existingIds = new Set(existing.map(item => item.residentId));
  const missing = eligible.filter(item => !existingIds.has(item.id));
  if (missing.length) {
    await prisma.blockEnrollment.createMany({
      data: missing.map(resident => ({
        blockId,
        residentId: resident.id,
        vacationDates: [],
        otherUnavailableDates: [],
        academicTimes: [],
        autoEnrolled: true,
        availabilityConfirmed: false,
      })),
      skipDuplicates: true,
    });
  }
  return { created: missing.length, residentIds: missing.map(item => item.id) };
}

async function syncAutomaticEnrollmentsForResident(residentId) {
  const resident = await prisma.residentProfile.findUnique({ where: { id: residentId } });
  if (!resident) return { created: 0, removed: 0 };
  const blocks = await prisma.block.findMany({
    where: { academicYear: { programId: resident.programId } },
    include: { academicYear: { select: { startDate: true } } },
  });
  const eligibleBlocks = blocks.filter(block => isResidentEligibleForBlock(resident, block));
  const eligibleIds = new Set(eligibleBlocks.map(block => block.id));
  const enrollments = await prisma.blockEnrollment.findMany({ where: { residentId }, select: { id: true, blockId: true, autoEnrolled: true } });
  const existingIds = new Set(enrollments.map(item => item.blockId));
  const missing = eligibleBlocks.filter(block => !existingIds.has(block.id));
  if (missing.length) {
    await prisma.blockEnrollment.createMany({
      data: missing.map(block => ({ blockId: block.id, residentId, vacationDates: [], otherUnavailableDates: [], academicTimes: [], autoEnrolled: true, availabilityConfirmed: false })),
      skipDuplicates: true,
    });
  }

  let removed = 0;
  const today = new Date();
  for (const enrollment of enrollments.filter(item => item.autoEnrolled && !eligibleIds.has(item.blockId))) {
    const block = blocks.find(item => item.id === enrollment.blockId);
    if (!block || validDate(block.startDate) < today) continue;
    const assignmentCount = await prisma.callAssignment.count({ where: { residentId, callDay: { blockId: block.id } } });
    if (assignmentCount === 0) {
      await prisma.blockEnrollment.delete({ where: { id: enrollment.id } });
      removed += 1;
    }
  }
  return { created: missing.length, removed };
}

module.exports = {
  DAYS,
  PERIODS,
  calculatePgyLevel,
  isResidentEligibleForBlock,
  effectivePgy,
  effectiveResidentRole,
  normalizeAcademicTimes,
  academicTimesValidationError,
  syncAutomaticEnrollmentsForBlock,
  syncAutomaticEnrollmentsForResident,
};
