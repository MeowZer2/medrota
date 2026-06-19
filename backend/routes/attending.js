const express = require('express');
const prisma = require('../lib/prisma');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

function startOfLogicalDay(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function nextLogicalDay(value) {
  const next = new Date(value);
  next.setDate(next.getDate() + 1);
  return next;
}

function addDays(date, count) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

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

// POST /api/attending/copy - copy entries from one block to another by relative day index
router.post('/copy', async (req, res) => {
  const { sourceBlockId, targetBlockId } = req.body;
  if (!sourceBlockId || !targetBlockId) {
    return res.status(400).json({ error: 'sourceBlockId and targetBlockId required' });
  }
  if (sourceBlockId === targetBlockId) {
    return res.status(400).json({ error: 'sourceBlockId and targetBlockId must differ' });
  }

  try {
    const [sourceBlock, targetBlock] = await Promise.all([
      prisma.block.findUnique({ where: { id: sourceBlockId } }),
      prisma.block.findUnique({ where: { id: targetBlockId } }),
    ]);
    if (!sourceBlock || !targetBlock) {
      return res.status(404).json({ error: 'Source or target block not found' });
    }

    const sourceStart = startOfLogicalDay(sourceBlock.startDate);
    const targetStart = startOfLogicalDay(targetBlock.startDate);
    const targetEnd = startOfLogicalDay(targetBlock.endDate);

    const sourceEntries = await prisma.attendingEntry.findMany({
      where: { blockId: sourceBlockId },
      orderBy: [{ date: 'asc' }, { attendingName: 'asc' }],
    });

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const entry of sourceEntries) {
      const sourceDay = startOfLogicalDay(entry.date);
      const dayOffset = Math.round((sourceDay - sourceStart) / 86400000);
      const targetDay = addDays(targetStart, dayOffset);
      if (targetDay > targetEnd) {
        skipped++;
        continue;
      }

      const existing = await prisma.attendingEntry.findFirst({
        where: {
          blockId: targetBlockId,
          attendingName: entry.attendingName,
          activityLabel: entry.activityLabel ?? '',
          date: { gte: targetDay, lt: nextLogicalDay(targetDay) },
        },
      });

      const data = {
        activityLabel: entry.activityLabel ?? '',
        notes: entry.notes ?? null,
        isCallDay: entry.isCallDay ?? false,
      };

      if (existing) {
        await prisma.attendingEntry.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.attendingEntry.create({
          data: {
            blockId: targetBlockId,
            attendingName: entry.attendingName,
            date: targetDay,
            ...data,
          },
        });
        created++;
      }
    }

    res.json({ copied: created + updated, created, updated, skipped, sourceCount: sourceEntries.length });
  } catch (err) {
    console.error('[attending copy] error:', err.message);
    res.status(500).json({ error: 'Failed to copy attending entries' });
  }
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
    const day = startOfLogicalDay(date);
    const entryData = {
      activityLabel: activityLabel ?? '',
      notes: notes ?? null,
      isCallDay: isCallDay ?? false,
    };
    const existing = await prisma.attendingEntry.findFirst({
      where: {
        blockId,
        attendingName,
        activityLabel: entryData.activityLabel,
        date: { gte: day, lt: nextLogicalDay(day) },
      },
    });
    const entry = existing
      ? await prisma.attendingEntry.update({ where: { id: existing.id }, data: entryData })
      : await prisma.attendingEntry.create({
          data: {
            blockId,
            attendingName,
            date: day,
            ...entryData,
          },
        });
    console.log(`[attending POST] created entry id=${entry.id} blockId=${blockId} attending=${attendingName} date=${date}`);
    res.status(existing ? 200 : 201).json(entry);
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
