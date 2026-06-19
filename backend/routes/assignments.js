const express = require('express');
const prisma = require('../lib/prisma');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// GET /api/assignments?blockId= — all assignments for a block (joined with date + resident)
// GET /api/assignments?callDayId= — assignments for one call day
router.get('/', async (req, res) => {
  const { blockId, callDayId } = req.query;

  if (blockId) {
    const assignments = await prisma.callAssignment.findMany({
      where: { callDay: { blockId } },
      include: {
        resident: { select: { id: true, name: true, residentRole: true } },
        callDay:  { select: { id: true, date: true } },
      },
      orderBy: { callDay: { date: 'asc' } },
    });
    return res.json(assignments);
  }

  if (!callDayId) return res.status(400).json({ error: 'blockId or callDayId required' });

  const assignments = await prisma.callAssignment.findMany({
    where: { callDayId },
    include: { resident: true },
  });
  res.json(assignments);
});

// POST /api/assignments — upsert CallDay + assignment for (blockId, date, residentId, roleOnDay)
router.post('/', async (req, res) => {
  const { blockId, date, residentId, roleOnDay, attendingEntryId } = req.body;
  if (!blockId || !date || !residentId || !roleOnDay) {
    return res.status(400).json({ error: 'blockId, date, residentId, roleOnDay required' });
  }

  const requestedDate = new Date(date);
  const startOfDay = new Date(
    requestedDate.getFullYear(),
    requestedDate.getMonth(),
    requestedDate.getDate()
  );
  const nextDay = new Date(startOfDay);
  nextDay.setDate(nextDay.getDate() + 1);

  let callDay = await prisma.callDay.findFirst({
    where: {
      blockId,
      date: {
        gte: startOfDay,
        lt: nextDay,
      },
    },
  });

  if (!callDay) {
    callDay = await prisma.callDay.create({
      data: { blockId, date: startOfDay, attendingEntryId: attendingEntryId ?? null },
    });
  } else if (attendingEntryId !== undefined) {
    callDay = await prisma.callDay.update({
      where: { id: callDay.id },
      data: { attendingEntryId },
    });
  }

  const existing = await prisma.callAssignment.findFirst({
    where: { callDayId: callDay.id, residentId },
  });

  const assignment = existing
    ? await prisma.callAssignment.update({ where: { id: existing.id }, data: { roleOnDay } })
    : await prisma.callAssignment.create({ data: { callDayId: callDay.id, residentId, roleOnDay } });

  res.status(201).json({ callDay, assignment });
});

// DELETE /api/assignments/:id
router.delete('/:id', async (req, res) => {
  await prisma.callAssignment.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
