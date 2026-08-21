const express = require('express');
const prisma = require('../lib/prisma');
const auth = require('../middleware/auth');
const { assertResidentBelongsToBlockProgram, getProgramIdForBlock, requireProgramPermission, requireBlockPermission, requireBlockView } = require('../lib/roles');
const { normalizeOptionalEmail } = require('../lib/email');
const { recordAuditEvent } = require('../services/auditLog');
const { effectivePgy, effectiveResidentRole, isResidentEligibleForBlock, normalizeAcademicTimes, academicTimesValidationError, syncAutomaticEnrollmentsForBlock, syncAutomaticEnrollmentsForResident } = require('../services/residentLifecycle');
const { buildResidentDisplayNames, decorateResidentDisplayNames } = require('../services/residentDisplayName');
const { calculateDaysOnService, getInHouseMax, getHomeCallMax, getAssignmentCallType, normalizeDateKey } = require('../services/paroRules');
const { blockDateKeys } = require('../services/blockAvailability');
const { minimumPositive } = require('../services/scheduleValidator');

const router = express.Router();
router.use(auth);

function validDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function sanitizeDateList(raw = []) {
  const output = new Map();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item) continue;
    if (typeof item === 'object' && item.startDate && item.endDate) {
      const cursor = new Date(item.startDate);
      const end = new Date(item.endDate);
      if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) continue;
      while (cursor <= end) {
        const key = normalizeDateKey(cursor);
        output.set(key, new Date(`${key}T00:00:00.000Z`));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    } else {
      const key = normalizeDateKey(item);
      if (key) output.set(key, new Date(`${key}T00:00:00.000Z`));
    }
  }
  return [...output.values()];
}

const cleanPhone = value => typeof value === 'string' ? value.trim().slice(0, 50) || null : null;
const cleanHomeProgram = value => typeof value === 'string' ? value.trim().slice(0, 120) || null : null;
const DIRECTORY_FIELDS = new Set(['name', 'pgyLevel', 'residentRole', 'residentRoleOverride', 'isMedStudent', 'isServiceResident', 'isActive', 'email', 'phone', 'homeProgram', 'programStartDate', 'expectedCompletionDate']);

function optionalPositiveInteger(value) {
  if (value === undefined || value === null || value === '') return { valid: true, value: null };
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? { valid: true, value: number } : { valid: false, value: null };
}

function shapeResident(resident, { enrollment = null, block = null, program = null, callCount = 0 } = {}) {
  const today = new Date();
  const currentAcademicYear = program?.academicYears?.find(item => today >= new Date(item.startDate) && today <= new Date(item.endDate)) ?? program?.academicYears?.at(-1);
  const referenceDate = block?.academicYear?.startDate ?? block?.startDate ?? currentAcademicYear?.startDate ?? new Date();
  const pgy = effectivePgy(resident, referenceDate);
  const role = effectiveResidentRole(resident, program, referenceDate);
  const dateKeys = block ? blockDateKeys(block) : [];
  const vacationKeys = (enrollment?.vacationDates ?? []).map(normalizeDateKey).filter(Boolean);
  const otherUnavailableKeys = (enrollment?.otherUnavailableDates ?? []).map(normalizeDateKey).filter(Boolean);
  const daysOnService = block ? calculateDaysOnService(dateKeys, [...new Set([...vacationKeys, ...otherUnavailableKeys])]) : null;
  const callType = block ? getAssignmentCallType(role.role, program) : null;
  const paroMaximum = block ? (callType === 'in_house' ? getInHouseMax(daysOnService) : getHomeCallMax(daysOnService)) : null;
  return {
    id: resident.id, name: resident.name, displayName: resident.displayName,
    email: resident.email ?? null, phone: resident.phone ?? null, homeProgram: resident.homeProgram ?? null,
    programStartDate: resident.programStartDate ?? null, expectedCompletionDate: resident.expectedCompletionDate ?? null,
    pgyLevel: pgy.level, pgySource: pgy.source, manualPgyLevel: resident.pgyLevel,
    residentRole: role.role, residentRoleSource: role.source, manualResidentRole: resident.residentRole,
    residentRoleOverride: resident.residentRoleOverride ?? null,
    isMedStudent: resident.isMedStudent, isServiceResident: resident.isServiceResident !== false,
    serviceClassification: resident.isMedStudent ? 'medical_student' : resident.isServiceResident === false ? 'off_service' : 'in_service',
    isActive: resident.isActive !== false,
    enrollmentId: enrollment?.id ?? null, isEnrolledThisBlock: Boolean(enrollment), autoEnrolled: enrollment?.autoEnrolled ?? false,
    availabilityConfirmed: enrollment?.availabilityConfirmed ?? false,
    vacationDates: enrollment?.vacationDates ?? [], otherUnavailableDates: enrollment?.otherUnavailableDates ?? [],
    academicDayPref: enrollment?.academicDayPref ?? null,
    academicTimes: normalizeAcademicTimes(enrollment?.academicTimes, enrollment?.academicDayPref),
    callCapOverride: enrollment?.callCapOverride ?? null, callCount,
    workload: block ? {
      blockDays: dateKeys.length, vacationDays: new Set(vacationKeys).size,
      otherUnavailableDays: new Set(otherUnavailableKeys).size, daysOnService, callType, paroMaximum,
      localMaximum: minimumPositive(block.settings?.maxCallsPerResident, enrollment?.callCapOverride), assigned: callCount,
    } : null,
  };
}

async function loadBlockContext(blockId) {
  return prisma.block.findUnique({ where: { id: blockId }, include: { academicYear: true, settings: true } });
}

async function shapeDirectory(programId, block = null) {
  const [program, residents] = await Promise.all([
    prisma.program.findUnique({ where: { id: programId }, include: { academicYears: { orderBy: { startDate: 'asc' } } } }),
    prisma.residentProfile.findMany({ where: { programId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
  ]);
  let enrollmentMap = new Map();
  let callMap = new Map();
  if (block) {
    const [enrollments, counts] = await Promise.all([
      prisma.blockEnrollment.findMany({ where: { blockId: block.id } }),
      prisma.callAssignment.groupBy({ by: ['residentId'], where: { callDay: { blockId: block.id } }, _count: { id: true } }),
    ]);
    enrollmentMap = new Map(enrollments.map(item => [item.residentId, item]));
    callMap = new Map(counts.map(item => [item.residentId, item._count.id]));
  }
  return decorateResidentDisplayNames(residents).map(resident => shapeResident(resident, {
    enrollment: enrollmentMap.get(resident.id) ?? null, block, program, callCount: callMap.get(resident.id) ?? 0,
  }));
}

router.get('/', async (req, res) => {
  const { programId, blockId } = req.query;
  if (!programId && !blockId) return res.status(400).json({ error: 'programId or blockId is required' });
  try {
    let block = null;
    let resolvedProgramId = programId;
    if (blockId) {
      const membership = await requireBlockView(req, res, blockId);
      if (!membership) return;
      await syncAutomaticEnrollmentsForBlock(blockId);
      block = await loadBlockContext(blockId);
      resolvedProgramId = block?.academicYear?.programId;
      if (programId && resolvedProgramId !== programId) return res.status(400).json({ error: 'Block must belong to the requested program' });
    } else {
      const membership = await requireProgramPermission(req, res, programId, 'manage_residents');
      if (!membership) return;
    }
    return res.json(await shapeDirectory(resolvedProgramId, block));
  } catch (error) {
    console.error('[residents GET] error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch residents' });
  }
});

router.get('/block/:blockId/composition', async (req, res) => {
  const membership = await requireBlockView(req, res, req.params.blockId);
  if (!membership) return;
  try {
    await syncAutomaticEnrollmentsForBlock(req.params.blockId);
    const block = await loadBlockContext(req.params.blockId);
    if (!block) return res.status(404).json({ error: 'Block not found' });
    const residents = await shapeDirectory(block.academicYear.programId, block);
    const inBlock = residents.filter(item => item.isEnrolledThisBlock);
    const activeInBlock = inBlock.filter(item => item.isActive);
    return res.json({
      block: { id: block.id, number: block.number, startDate: block.startDate, endDate: block.endDate },
      counts: {
        total: activeInBlock.length,
        inService: activeInBlock.filter(item => item.serviceClassification === 'in_service').length,
        offService: activeInBlock.filter(item => item.serviceClassification === 'off_service').length,
        medicalStudents: activeInBlock.filter(item => item.serviceClassification === 'medical_student').length,
      },
      inBlock,
      available: residents.filter(item => item.isActive && !item.isEnrolledThisBlock),
    });
  } catch (error) {
    console.error('[resident composition GET] error:', error.message);
    return res.status(500).json({ error: 'Failed to load block residents' });
  }
});

router.post('/', async (req, res) => {
  const { programId, blockId, name, pgyLevel, residentRole = 'junior', residentRoleOverride, isMedStudent = false, isServiceResident = true, email, phone, homeProgram, programStartDate, expectedCompletionDate } = req.body;
  const cleanResidentName = typeof name === 'string' ? name.trim() : '';
  if (!programId || !cleanResidentName) return res.status(400).json({ error: 'programId and name are required' });
  const start = validDate(programStartDate);
  const completion = validDate(expectedCompletionDate);
  if (start === undefined || completion === undefined) return res.status(400).json({ error: 'Enter valid training dates' });
  if (start && completion && completion < start) return res.status(400).json({ error: 'Expected completion must be after program start' });
  if (!pgyLevel && !start && !isMedStudent) return res.status(400).json({ error: 'A program start date or manual PGY is required' });
  const normalizedEmail = normalizeOptionalEmail(email ?? '');
  if (!normalizedEmail.valid) return res.status(400).json({ error: 'Enter a valid email address.' });
  const membership = await requireProgramPermission(req, res, programId, 'manage_residents');
  if (!membership) return;
  if (blockId) {
    const blockMembership = await requireBlockPermission(req, res, blockId, 'manage_block_availability');
    if (!blockMembership) return;
    const access = await getProgramIdForBlock(blockId);
    if (access?.programId !== programId) return res.status(400).json({ error: 'Resident and block must belong to the same program' });
  }
  const medicalStudent = Boolean(isMedStudent);
  const inService = medicalStudent ? false : isServiceResident !== false;
  try {
    const resident = await prisma.residentProfile.create({ data: {
      programId, name: cleanResidentName, pgyLevel: String(pgyLevel || '1'), residentRole: residentRole === 'senior' ? 'senior' : 'junior',
      residentRoleOverride: ['junior', 'senior'].includes(residentRoleOverride) ? residentRoleOverride : null,
      isMedStudent: medicalStudent, isServiceResident: inService, isActive: true,
      email: normalizedEmail.value, phone: cleanPhone(phone), homeProgram: inService ? null : cleanHomeProgram(homeProgram),
      programStartDate: inService ? start : null, expectedCompletionDate: inService ? completion : null,
    } });
    const syncResult = inService ? await syncAutomaticEnrollmentsForResident(resident.id) : { created: 0 };
    if (blockId && !inService) {
      await prisma.blockEnrollment.upsert({
        where: { blockId_residentId: { blockId, residentId: resident.id } }, update: {},
        create: { blockId, residentId: resident.id, vacationDates: [], otherUnavailableDates: [], academicTimes: [], availabilityConfirmed: false },
      });
    }
    await recordAuditEvent({ programId, blockId: blockId ?? null, actorUserId: req.user?.userId, action: 'resident.created', category: 'scheduling', entityType: 'ResidentProfile', entityId: resident.id, summary: `Created resident directory record for ${resident.name}`, metadata: { residentId: resident.id, classification: medicalStudent ? 'medical_student' : inService ? 'in_service' : 'off_service', automaticBlockEnrollments: syncResult.created } });
    if (start || completion) await recordAuditEvent({ programId, actorUserId: req.user?.userId, action: 'resident_training_dates.updated', category: 'scheduling', entityType: 'ResidentProfile', entityId: resident.id, summary: `Set training dates for ${resident.name}`, metadata: { residentId: resident.id, hasProgramStart: Boolean(start), hasExpectedCompletion: Boolean(completion) } });
    return res.status(201).json(resident);
  } catch (error) {
    console.error('[residents POST] error:', error.message);
    return res.status(500).json({ error: 'Failed to create resident' });
  }
});

router.post('/:id/enroll', async (req, res) => {
  const { blockId } = req.body;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });
  const academicError = academicTimesValidationError(req.body.academicTimes);
  if (academicError) return res.status(400).json({ error: academicError });
  const callCap = optionalPositiveInteger(req.body.callCapOverride);
  if (!callCap.valid) return res.status(400).json({ error: 'callCapOverride must be a positive integer or blank' });
  try {
    const membership = await requireBlockPermission(req, res, blockId, 'manage_block_availability');
    if (!membership) return;
    const ownership = await assertResidentBelongsToBlockProgram(res, req.params.id, blockId);
    if (!ownership) return;
    if (ownership.resident.isActive === false) return res.status(409).json({ error: 'Inactive residents cannot be added to a block', code: 'RESIDENT_INACTIVE' });
    const existing = await prisma.blockEnrollment.findUnique({ where: { blockId_residentId: { blockId, residentId: req.params.id } } });
    const enrollment = await prisma.blockEnrollment.upsert({
      where: { blockId_residentId: { blockId, residentId: req.params.id } }, update: {},
      create: { blockId, residentId: req.params.id, vacationDates: sanitizeDateList(req.body.vacationDates), otherUnavailableDates: sanitizeDateList(req.body.otherUnavailableDates), academicTimes: normalizeAcademicTimes(req.body.academicTimes, req.body.academicDayPref), academicDayPref: req.body.academicDayPref ?? null, callCapOverride: callCap.value, availabilityConfirmed: Boolean(req.body.availabilityConfirmed), autoEnrolled: false },
    });
    if (!existing) await recordAuditEvent({ programId: ownership.blockAccess.programId, blockId, actorUserId: req.user?.userId, action: 'block_resident.added', category: 'scheduling', entityType: 'BlockEnrollment', entityId: enrollment.id, summary: 'Added a resident to this block', metadata: { residentId: req.params.id } });
    return res.status(existing ? 200 : 201).json(enrollment);
  } catch (error) {
    console.error('[resident enroll POST] error:', error.message);
    return res.status(500).json({ error: 'Failed to enroll resident' });
  }
});

router.delete('/:id/enroll/:blockId', async (req, res) => {
  const { id, blockId } = req.params;
  try {
    const membership = await requireBlockPermission(req, res, blockId, 'manage_block_availability');
    if (!membership) return;
    const ownership = await assertResidentBelongsToBlockProgram(res, id, blockId);
    if (!ownership) return;
    const [resident, block, assignmentCount, programResidents] = await Promise.all([
      prisma.residentProfile.findUnique({ where: { id } }), loadBlockContext(blockId),
      prisma.callAssignment.count({ where: { residentId: id, callDay: { blockId } } }),
      prisma.residentProfile.findMany({ where: { programId: ownership.blockAccess.programId } }),
    ]);
    const displayName = buildResidentDisplayNames(programResidents).get(id) ?? resident.name;
    if (assignmentCount > 0) return res.status(409).json({ error: `${displayName} has ${assignmentCount} call assignment${assignmentCount === 1 ? '' : 's'} in this block. Resolve the assignments before removing them.`, code: 'RESIDENT_HAS_ASSIGNMENTS', assignmentCount });
    if (isResidentEligibleForBlock(resident, block)) return res.status(409).json({ error: 'Eligible in-service residents participate automatically. Update their active or training dates in the Resident Directory instead.', code: 'AUTOMATIC_IN_SERVICE' });
    const enrollment = await prisma.blockEnrollment.findUnique({ where: { blockId_residentId: { blockId, residentId: id } } });
    if (!enrollment) return res.json({ ok: true, removed: false });
    await prisma.blockEnrollment.delete({ where: { id: enrollment.id } });
    await recordAuditEvent({ programId: ownership.blockAccess.programId, blockId, actorUserId: req.user?.userId, action: 'block_resident.removed', category: 'scheduling', entityType: 'BlockEnrollment', entityId: enrollment.id, summary: 'Removed a resident from this block', metadata: { residentId: id, assignmentCount: 0 } });
    return res.json({ ok: true, removed: true });
  } catch (error) {
    console.error('[resident enroll DELETE] error:', error.message);
    return res.status(500).json({ error: 'Failed to remove resident from block' });
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const existing = await prisma.residentProfile.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Resident not found' });
  const changedDirectoryFields = Object.keys(req.body).filter(key => DIRECTORY_FIELDS.has(key));
  const hasDirectoryChanges = changedDirectoryFields.length > 0;
  const membership = req.body.blockId ? await requireBlockPermission(req, res, req.body.blockId, 'manage_block_availability') : await requireProgramPermission(req, res, existing.programId, 'manage_residents');
  if (!membership) return;
  if (req.body.blockId && !await assertResidentBelongsToBlockProgram(res, id, req.body.blockId)) return;
  if (req.body.blockId && hasDirectoryChanges && !await requireProgramPermission(req, res, existing.programId, 'manage_residents')) return;
  const academicError = academicTimesValidationError(req.body.academicTimes);
  if (academicError) return res.status(400).json({ error: academicError });
  const callCap = optionalPositiveInteger(req.body.callCapOverride);
  if (!callCap.valid) return res.status(400).json({ error: 'callCapOverride must be a positive integer or blank' });
  const normalizedEmail = req.body.email === undefined ? null : normalizeOptionalEmail(req.body.email);
  if (normalizedEmail && !normalizedEmail.valid) return res.status(400).json({ error: 'Enter a valid email address.' });
  const start = req.body.programStartDate === undefined ? existing.programStartDate : validDate(req.body.programStartDate);
  const completion = req.body.expectedCompletionDate === undefined ? existing.expectedCompletionDate : validDate(req.body.expectedCompletionDate);
  if (start === undefined || completion === undefined) return res.status(400).json({ error: 'Enter valid training dates' });
  if (start && completion && completion < start) return res.status(400).json({ error: 'Expected completion must be after program start' });
  try {
    const medicalStudent = req.body.isMedStudent ?? existing.isMedStudent;
    const inService = medicalStudent ? false : (req.body.isServiceResident ?? existing.isServiceResident);
    const residentData = {
      ...(req.body.name !== undefined && { name: String(req.body.name).trim() }),
      ...(req.body.pgyLevel !== undefined && { pgyLevel: String(req.body.pgyLevel) }),
      ...(req.body.residentRole !== undefined && { residentRole: req.body.residentRole === 'senior' ? 'senior' : 'junior' }),
      ...(req.body.residentRoleOverride !== undefined && { residentRoleOverride: ['junior', 'senior'].includes(req.body.residentRoleOverride) ? req.body.residentRoleOverride : null }),
      ...(req.body.isMedStudent !== undefined && { isMedStudent: medicalStudent }),
      ...(req.body.isServiceResident !== undefined && { isServiceResident: inService }),
      ...(req.body.isActive !== undefined && { isActive: Boolean(req.body.isActive) }),
      ...(req.body.email !== undefined && { email: normalizedEmail.value }),
      ...(req.body.phone !== undefined && { phone: cleanPhone(req.body.phone) }),
      ...(req.body.homeProgram !== undefined && { homeProgram: inService ? null : cleanHomeProgram(req.body.homeProgram) }),
      ...(req.body.programStartDate !== undefined && { programStartDate: inService ? start : null }),
      ...(req.body.expectedCompletionDate !== undefined && { expectedCompletionDate: inService ? completion : null }),
    };
    const resident = hasDirectoryChanges ? await prisma.residentProfile.update({ where: { id }, data: residentData }) : existing;
    const syncResult = hasDirectoryChanges ? await syncAutomaticEnrollmentsForResident(id) : { created: 0, removed: 0 };
    if (req.body.blockId) {
      const enrollment = await prisma.blockEnrollment.findUnique({ where: { blockId_residentId: { blockId: req.body.blockId, residentId: id } } });
      if (!enrollment) return res.status(404).json({ error: 'Resident is not in this block' });
      await prisma.blockEnrollment.update({ where: { id: enrollment.id }, data: {
        ...(req.body.vacationDates !== undefined && { vacationDates: sanitizeDateList(req.body.vacationDates) }),
        ...(req.body.otherUnavailableDates !== undefined && { otherUnavailableDates: sanitizeDateList(req.body.otherUnavailableDates) }),
        ...(req.body.academicTimes !== undefined && { academicTimes: normalizeAcademicTimes(req.body.academicTimes) }),
        ...(req.body.academicDayPref !== undefined && { academicDayPref: req.body.academicDayPref || null }),
        ...(req.body.callCapOverride !== undefined && { callCapOverride: callCap.value }),
        ...(req.body.availabilityConfirmed !== undefined && { availabilityConfirmed: Boolean(req.body.availabilityConfirmed) }),
      } });
      await recordAuditEvent({ programId: resident.programId, blockId: req.body.blockId, actorUserId: req.user?.userId, action: 'block_availability.updated', category: 'scheduling', entityType: 'BlockEnrollment', entityId: enrollment.id, summary: `Updated block availability for ${resident.name}`, metadata: { residentId: id, changedFields: Object.keys(req.body).filter(key => !['email', 'phone'].includes(key)) } });
    }
    if (hasDirectoryChanges) await recordAuditEvent({ programId: resident.programId, blockId: req.body.blockId ?? null, actorUserId: req.user?.userId, action: req.body.isActive === false ? 'resident.deactivated' : 'resident.updated', category: 'scheduling', entityType: 'ResidentProfile', entityId: resident.id, summary: `Updated ${resident.name}`, metadata: { residentId: resident.id, changedFields: changedDirectoryFields.filter(key => !['email', 'phone'].includes(key)), automaticEnrollmentsAdded: syncResult.created, automaticEnrollmentsRemoved: syncResult.removed } });
    if (req.body.programStartDate !== undefined || req.body.expectedCompletionDate !== undefined) await recordAuditEvent({ programId: resident.programId, actorUserId: req.user?.userId, action: 'resident_training_dates.updated', category: 'scheduling', entityType: 'ResidentProfile', entityId: resident.id, summary: `Updated training dates for ${resident.name}`, metadata: { residentId: resident.id, hasProgramStart: Boolean(start), hasExpectedCompletion: Boolean(completion) } });
    return res.json(resident);
  } catch (error) {
    console.error('[residents PUT] error:', error.message);
    return res.status(500).json({ error: 'Failed to update resident' });
  }
});

router.delete('/:id', async (req, res) => {
  const resident = await prisma.residentProfile.findUnique({ where: { id: req.params.id } });
  if (!resident) return res.status(404).json({ error: 'Resident not found' });
  const membership = await requireProgramPermission(req, res, resident.programId, 'manage_residents');
  if (!membership) return;
  const updated = await prisma.residentProfile.update({ where: { id: resident.id }, data: { isActive: false } });
  await recordAuditEvent({ programId: resident.programId, actorUserId: req.user?.userId, action: 'resident.deactivated', category: 'scheduling', entityType: 'ResidentProfile', entityId: resident.id, summary: `Deactivated ${resident.name}`, metadata: { residentId: resident.id } });
  return res.json(updated);
});

module.exports = router;
