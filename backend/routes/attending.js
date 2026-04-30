const express = require('express');
const prisma = require('../lib/prisma');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// ── Roster routes (must be before /:id to avoid conflicts) ───────────────────

// GET /api/attending/roster?programId=
router.get('/roster', async (req, res) => {
  const { programId } = req.query;
  if (!programId) return res.status(400).json({ error: 'programId required' });
  const roster = await prisma.attendingRoster.findMany({
    where: { programId },
    orderBy: { createdAt: 'asc' },
  });
  res.json(roster);
});

// POST /api/attending/roster
router.post('/roster', async (req, res) => {
  console.log('[attending/roster POST] body:', JSON.stringify(req.body));
  const { programId, attendingName, typicalActivities } = req.body;
  if (!programId || !attendingName) {
    console.warn('[attending/roster POST] missing fields', { programId, attendingName });
    return res.status(400).json({ error: 'programId and attendingName required' });
  }
  try {
    const entry = await prisma.attendingRoster.create({
      data: { programId, attendingName, typicalActivities: typicalActivities ?? [] },
    });
    console.log(`[attending/roster POST] created id=${entry.id} programId=${programId} name=${attendingName}`);
    res.status(201).json(entry);
  } catch (err) {
    console.error('[attending/roster POST] error:', err.message);
    res.status(500).json({ error: 'Failed to create roster entry' });
  }
});

// PUT /api/attending/roster/:id — update name and/or activities
router.put('/roster/:id', async (req, res) => {
  const { attendingName, typicalActivities } = req.body;
  try {
    const entry = await prisma.attendingRoster.update({
      where: { id: req.params.id },
      data: {
        ...(attendingName     !== undefined && { attendingName }),
        ...(typicalActivities !== undefined && { typicalActivities }),
      },
    });
    res.json(entry);
  } catch (err) {
    console.error('[attending/roster PUT] error:', err.message);
    res.status(500).json({ error: 'Failed to update roster entry' });
  }
});

// DELETE /api/attending/roster/:id
router.delete('/roster/:id', async (req, res) => {
  await prisma.attendingRoster.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ── Per-day attending entry routes ────────────────────────────────────────────

// GET /api/attending?blockId=
router.get('/', async (req, res) => {
  const { blockId } = req.query;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });

  console.log(`[attending GET] blockId=${blockId}`);

  const entries = await prisma.attendingEntry.findMany({
    where: { blockId },
    orderBy: [{ date: 'asc' }, { attendingName: 'asc' }],
  });

  console.log(`[attending GET] found ${entries.length} entries for blockId=${blockId}`);
  res.json(entries);
});

// POST /api/attending
router.post('/', async (req, res) => {
  console.log('[attending POST] body:', JSON.stringify(req.body));
  const { blockId, attendingName, date, activityLabel, notes, isCallDay } = req.body;
  if (!blockId || !attendingName || !date) {
    console.warn('[attending POST] missing required fields', { blockId, attendingName, date });
    return res.status(400).json({ error: 'blockId, attendingName, and date are required' });
  }

  // Verify the block exists before writing
  const block = await prisma.block.findUnique({ where: { id: blockId }, select: { id: true } });
  if (!block) {
    console.error(`[attending POST] Block not found: blockId=${blockId}`);
    return res.status(404).json({ error: 'Block not found' });
  }

  try {
    const entry = await prisma.attendingEntry.create({
      data: {
        blockId,
        attendingName,
        date: new Date(date),
        activityLabel: activityLabel ?? '',
        notes: notes ?? null,
        isCallDay: isCallDay ?? false,
      },
    });
    console.log(`[attending POST] created entry id=${entry.id} blockId=${blockId} attending=${attendingName} date=${date}`);
    res.status(201).json(entry);
  } catch (err) {
    console.error('[attending POST] Prisma error:', err.message, err);
    res.status(500).json({ error: 'Failed to create attending entry' });
  }
});

// PUT /api/attending/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { attendingName, date, activityLabel, notes, isCallDay } = req.body;
  const entry = await prisma.attendingEntry.update({
    where: { id },
    data: {
      ...(attendingName  !== undefined && { attendingName }),
      ...(date           !== undefined && { date: new Date(date) }),
      ...(activityLabel  !== undefined && { activityLabel }),
      ...(notes          !== undefined && { notes }),
      ...(isCallDay      !== undefined && { isCallDay }),
    },
  });
  res.json(entry);
});

// DELETE /api/attending?blockId= — delete ALL entries for a block
router.delete('/', async (req, res) => {
  const { blockId } = req.query;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });
  try {
    const deleted = await prisma.attendingEntry.deleteMany({ where: { blockId } });
    res.json({ success: true, deletedCount: deleted.count });
  } catch (err) {
    console.error('[attending DELETE all] error:', err.message);
    res.status(500).json({ error: 'Failed to clear block schedule' });
  }
});

// DELETE /api/attending/:id
router.delete('/:id', async (req, res) => {
  await prisma.attendingEntry.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// DELETE /api/attending/block/:blockId
router.delete('/block/:blockId', async (req, res) => {
  const { blockId } = req.params;
  try {
    const deleted = await prisma.attendingEntry.deleteMany({ where: { blockId } });
    res.json({ success: true, deletedCount: deleted.count });
  } catch (err) {
    console.error('[attending/block DELETE] error:', err.message);
    res.status(500).json({ error: 'Failed to reset block schedule' });
  }
});

module.exports = router;
