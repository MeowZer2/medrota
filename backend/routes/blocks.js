const express = require('express');
const prisma  = require('../lib/prisma');
const auth    = require('../middleware/auth');
const { requireBlockPermission } = require('../lib/roles');

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

// GET /api/blocks/:id/settings
router.get('/:id/settings', async (req, res) => {
  const { id } = req.params;
  try {
    const membership = await requireBlockPermission(req, res, id, 'edit_block_settings');
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
    const membership = await requireBlockPermission(req, res, id, 'edit_block_settings');
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
    res.json(shapeSupportedSettings(settings, id));
  } catch (err) {
    console.error('[blocks/settings PUT] Error:', err.message);
    res.status(500).json({ error: 'Failed to save block settings' });
  }
});

module.exports = router;
