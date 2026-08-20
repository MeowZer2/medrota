const express = require('express');
const prisma  = require('../lib/prisma');
const auth    = require('../middleware/auth');
const { requireBlockPermission, requireBlockView } = require('../lib/roles');
const { bulkEnroll, copyAvailabilityForward, getBlockReadiness } = require('../services/blockAvailability');
const { recordAuditEvent } = require('../services/auditLog');

const router = express.Router();
router.use(auth);

function shapeSupportedSettings(settings, blockId) {
  return {
    blockId,
    maxCallsPerResident: settings?.maxCallsPerResident ?? 9,
    maxCallsMedStudent: settings?.maxCallsMedStudent ?? 5,
    allowAttendingOnlyDays: settings?.allowAttendingOnlyDays ?? false,
    avoidAcademicDays: settings?.avoidAcademicDays ?? true,
  };
}

// GET /api/blocks/:id/holidays - holidays inherited from the academic year.
router.get('/:id/holidays', async (req, res) => {
  const { id } = req.params;
  const membership = await requireBlockView(req, res, id);
  if (!membership) return;
  try {
    const block = await prisma.block.findUnique({
      where: { id },
      select: {
        startDate: true,
        endDate: true,
        academicYear: {
          select: {
            holidays: {
              select: { id: true, date: true, name: true },
              orderBy: { date: 'asc' },
            },
          },
        },
      },
    });
    if (!block) return res.status(404).json({ error: 'Block not found' });
    const holidays = block.academicYear.holidays.filter(item =>
      item.date >= block.startDate && item.date <= block.endDate
    );
    res.json(holidays);
  } catch (err) {
    console.error('[blocks/holidays GET] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch holidays' });
  }
});

// GET /api/blocks/:id/settings
router.get('/:id/settings', async (req, res) => {
  const { id } = req.params;
  try {
    const membership = await requireBlockPermission(req, res, id, 'manage_block_settings');
    if (!membership) return;
    const settings = await prisma.blockSettings.findUnique({ where: { blockId: id } });
    // Return defaults if no settings record yet
    res.json(shapeSupportedSettings(settings, id));
  } catch (err) {
    console.error('[blocks/settings GET] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch block settings' });
  }
});

// PUT /api/blocks/:id/settings
router.put('/:id/settings', async (req, res) => {
  const { id } = req.params;
  const {
    maxCallsPerResident,
    maxCallsMedStudent,
    allowAttendingOnlyDays,
    avoidAcademicDays,
  } = req.body;

  const parsedResidentCap = maxCallsPerResident === undefined ? undefined : Number(maxCallsPerResident);
  const parsedMedStudentCap = maxCallsMedStudent === undefined ? undefined : Number(maxCallsMedStudent);
  if (parsedResidentCap !== undefined && (!Number.isInteger(parsedResidentCap) || parsedResidentCap < 0 || parsedResidentCap > 30)) {
    return res.status(400).json({ error: 'maxCallsPerResident must be an integer from 0 to 30' });
  }
  if (parsedMedStudentCap !== undefined && (!Number.isInteger(parsedMedStudentCap) || parsedMedStudentCap < 0 || parsedMedStudentCap > 30)) {
    return res.status(400).json({ error: 'maxCallsMedStudent must be an integer from 0 to 30' });
  }

  try {
    const membership = await requireBlockPermission(req, res, id, 'manage_block_settings');
    if (!membership) return;
    const settings = await prisma.blockSettings.upsert({
      where:  { blockId: id },
      update: {
        ...(parsedResidentCap      !== undefined && { maxCallsPerResident: parsedResidentCap }),
        ...(parsedMedStudentCap    !== undefined && { maxCallsMedStudent: parsedMedStudentCap }),
        ...(allowAttendingOnlyDays  !== undefined && { allowAttendingOnlyDays:  Boolean(allowAttendingOnlyDays) }),
        ...(avoidAcademicDays       !== undefined && { avoidAcademicDays:       Boolean(avoidAcademicDays) }),
      },
      create: {
        blockId: id,
        maxCallsPerResident:    parsedResidentCap !== undefined ? parsedResidentCap : 9,
        maxCallsMedStudent:     parsedMedStudentCap !== undefined ? parsedMedStudentCap : 5,
        allowAttendingOnlyDays:  allowAttendingOnlyDays  !== undefined ? Boolean(allowAttendingOnlyDays)  : false,
        avoidAcademicDays:       avoidAcademicDays       !== undefined ? Boolean(avoidAcademicDays)       : true,
      },
    });
    await recordAuditEvent({
      programId: membership.programId,
      blockId: id,
      actorUserId: req.user?.userId,
      action: 'BLOCK_SETTINGS_CHANGED',
      entityType: 'BlockSettings',
      entityId: settings.id,
      summary: 'Changed the block scheduling rules',
      metadata: shapeSupportedSettings(settings, id),
    });
    res.json(shapeSupportedSettings(settings, id));
  } catch (err) {
    console.error('[blocks/settings PUT] Error:', err.message);
    res.status(500).json({ error: 'Failed to save block settings' });
  }
});

// GET /api/blocks/:id/readiness - what still needs doing before Generate.
router.get('/:id/readiness', async (req, res) => {
  const { id } = req.params;
  try {
    const membership = await requireBlockPermission(req, res, id, 'view_draft_schedule');
    if (!membership) return;
    const readiness = await getBlockReadiness(id);
    if (!readiness) return res.status(404).json({ error: 'Block not found' });
    res.json(readiness);
  } catch (err) {
    console.error('[blocks/readiness GET] Error:', err.message);
    res.status(500).json({ error: 'Failed to check block readiness' });
  }
});

// POST /api/blocks/:id/availability/bulk - enroll several residents at once.
router.post('/:id/availability/bulk', async (req, res) => {
  const { id } = req.params;
  const { residentIds } = req.body;
  if (!Array.isArray(residentIds) || residentIds.length === 0) {
    return res.status(400).json({ error: 'residentIds must be a non-empty array' });
  }
  if (residentIds.some(value => typeof value !== 'string' || !value)) {
    return res.status(400).json({ error: 'residentIds must contain resident ids' });
  }
  try {
    const membership = await requireBlockPermission(req, res, id, 'manage_block_availability');
    if (!membership) return;
    const result = await bulkEnroll(id, residentIds);
    if (result.error) return res.status(result.status).json({ error: result.error });
    if (result.enrolled > 0) {
      await recordAuditEvent({
        programId: membership.programId,
        blockId: id,
        actorUserId: req.user?.userId,
        action: 'BLOCK_AVAILABILITY_CHANGED',
        entityType: 'Block',
        entityId: id,
        summary: `Set block availability for ${result.enrolled} resident${result.enrolled === 1 ? '' : 's'}`,
        metadata: { enrolled: result.enrolled, alreadyEnrolled: result.alreadyEnrolled, residentIds: result.residentIds },
      });
    }
    res.json(result);
  } catch (err) {
    console.error('[blocks/availability/bulk POST] Error:', err.message);
    res.status(500).json({ error: 'Failed to set block availability' });
  }
});

// POST /api/blocks/:id/availability/copy - copy availability from another block.
router.post('/:id/availability/copy', async (req, res) => {
  const { id } = req.params;
  const { fromBlockId, residentIds } = req.body;
  if (!fromBlockId) return res.status(400).json({ error: 'fromBlockId required' });
  if (residentIds !== undefined && !Array.isArray(residentIds)) {
    return res.status(400).json({ error: 'residentIds must be an array when provided' });
  }
  try {
    // Both blocks are checked: copying reads the source and writes the target.
    const target = await requireBlockPermission(req, res, id, 'manage_block_availability');
    if (!target) return;
    const source = await requireBlockPermission(req, res, fromBlockId, 'view_draft_schedule');
    if (!source) return;
    const result = await copyAvailabilityForward(fromBlockId, id, residentIds ?? null);
    if (result.error) return res.status(result.status).json({ error: result.error });
    if (result.copied > 0) {
      await recordAuditEvent({
        programId: target.programId,
        blockId: id,
        actorUserId: req.user?.userId,
        action: 'BLOCK_AVAILABILITY_CHANGED',
        entityType: 'Block',
        entityId: id,
        summary: `Copied availability forward for ${result.copied} resident${result.copied === 1 ? '' : 's'}`,
        metadata: {
          fromBlockId,
          copied: result.copied,
          skipped: result.skipped.length,
          vacationDatesCopied: result.vacationDatesCopied,
          vacationDatesDropped: result.vacationDatesDropped,
        },
      });
    }
    res.json(result);
  } catch (err) {
    console.error('[blocks/availability/copy POST] Error:', err.message);
    res.status(500).json({ error: 'Failed to copy block availability' });
  }
});

module.exports = router;
