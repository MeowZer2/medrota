const express = require('express');
const prisma = require('../lib/prisma');
const auth = require('../middleware/auth');
const { requireBlockPermission, requireBlockView } = require('../lib/roles');

const router = express.Router();
router.use(auth);

// GET /api/flags?blockId=
router.get('/', async (req, res) => {
  const { blockId } = req.query;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });
  const membership = await requireBlockView(req, res, blockId);
  if (!membership) return;
  const flags = await prisma.dayFlag.findMany({
    where: { blockId },
    orderBy: { date: 'asc' },
  });
  res.json(flags);
});

// POST /api/flags
router.post('/', async (req, res) => {
  const { blockId, date, label, color } = req.body;
  if (!blockId || !date || !label) {
    return res.status(400).json({ error: 'blockId, date, and label are required' });
  }
  try {
    const membership = await requireBlockPermission(req, res, blockId, 'manual_assign_calls');
    if (!membership) return;
    const flag = await prisma.dayFlag.create({
      data: {
        blockId,
        date: new Date(date),
        label,
        color: color ?? '#F59E0B',
      },
    });
    res.status(201).json(flag);
  } catch (err) {
    console.error('[flags POST] error:', err.message);
    res.status(500).json({ error: 'Failed to create flag' });
  }
});

// PUT /api/flags/:id
router.put('/:id', async (req, res) => {
  const { label, color } = req.body;
  try {
    const existing = await prisma.dayFlag.findUnique({ where: { id: req.params.id }, select: { blockId: true } });
    if (!existing) return res.status(404).json({ error: 'Flag not found' });
    const membership = await requireBlockPermission(req, res, existing.blockId, 'manual_assign_calls');
    if (!membership) return;
    const flag = await prisma.dayFlag.update({
      where: { id: req.params.id },
      data: {
        ...(label !== undefined && { label }),
        ...(color !== undefined && { color }),
      },
    });
    res.json(flag);
  } catch (err) {
    console.error('[flags PUT] error:', err.message);
    res.status(500).json({ error: 'Failed to update flag' });
  }
});

// DELETE /api/flags/:id
router.delete('/:id', async (req, res) => {
  try {
    const existing = await prisma.dayFlag.findUnique({ where: { id: req.params.id }, select: { blockId: true } });
    if (!existing) return res.status(404).json({ error: 'Flag not found' });
    const membership = await requireBlockPermission(req, res, existing.blockId, 'manual_assign_calls');
    if (!membership) return;
    await prisma.dayFlag.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('[flags DELETE] error:', err.message);
    res.status(500).json({ error: 'Failed to delete flag' });
  }
});

module.exports = router;
