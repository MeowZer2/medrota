const express = require('express');
const prisma  = require('../lib/prisma');
const auth    = require('../middleware/auth');
const { requireBlockPermission } = require('../lib/roles');

const router = express.Router();
router.use(auth);

// GET /api/blocks/:id/settings
router.get('/:id/settings', async (req, res) => {
  const { id } = req.params;
  try {
    const membership = await requireBlockPermission(req, res, id, 'edit_block_settings');
    if (!membership) return;
    const settings = await prisma.blockSettings.findUnique({ where: { blockId: id } });
    // Return defaults if no settings record yet
    res.json(settings ?? {
      blockId:                id,
      maxCallsPerResident:    9,
      maxCallsMedStudent:     5,
      allowWeekendConsecutive: false,
      allowAttendingOnlyDays:  false,
      avoidAcademicDays:       true,
      limitWeekendCalls:       true,
    });
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
    allowWeekendConsecutive,
    allowAttendingOnlyDays,
    avoidAcademicDays,
    limitWeekendCalls,
  } = req.body;

  try {
    const membership = await requireBlockPermission(req, res, id, 'edit_block_settings');
    if (!membership) return;
    const settings = await prisma.blockSettings.upsert({
      where:  { blockId: id },
      update: {
        ...(maxCallsPerResident    !== undefined && { maxCallsPerResident:    Number(maxCallsPerResident) }),
        ...(maxCallsMedStudent     !== undefined && { maxCallsMedStudent:     Number(maxCallsMedStudent) }),
        ...(allowWeekendConsecutive !== undefined && { allowWeekendConsecutive: Boolean(allowWeekendConsecutive) }),
        ...(allowAttendingOnlyDays  !== undefined && { allowAttendingOnlyDays:  Boolean(allowAttendingOnlyDays) }),
        ...(avoidAcademicDays       !== undefined && { avoidAcademicDays:       Boolean(avoidAcademicDays) }),
        ...(limitWeekendCalls       !== undefined && { limitWeekendCalls:       Boolean(limitWeekendCalls) }),
      },
      create: {
        blockId: id,
        maxCallsPerResident:    maxCallsPerResident    !== undefined ? Number(maxCallsPerResident)    : 9,
        maxCallsMedStudent:     maxCallsMedStudent     !== undefined ? Number(maxCallsMedStudent)     : 5,
        allowWeekendConsecutive: allowWeekendConsecutive !== undefined ? Boolean(allowWeekendConsecutive) : false,
        allowAttendingOnlyDays:  allowAttendingOnlyDays  !== undefined ? Boolean(allowAttendingOnlyDays)  : false,
        avoidAcademicDays:       avoidAcademicDays       !== undefined ? Boolean(avoidAcademicDays)       : true,
        limitWeekendCalls:       limitWeekendCalls       !== undefined ? Boolean(limitWeekendCalls)       : true,
      },
    });
    res.json(settings);
  } catch (err) {
    console.error('[blocks/settings PUT] Error:', err.message);
    res.status(500).json({ error: 'Failed to save block settings' });
  }
});

module.exports = router;
