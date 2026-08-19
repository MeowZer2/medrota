const express = require('express');
const prisma  = require('../lib/prisma');
const auth    = require('../middleware/auth');
const { getProgramIdForBlock, requireProgramPermission, requireBlockPermission } = require('../lib/roles');

const router = express.Router();
router.use(auth);

function startOfLogicalDay(value) {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date, count) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + count);
  return next;
}

function nextLogicalDay(value) {
  return addDays(value, 1);
}

// GET /api/attending-template?programId=
// Returns template entries grouped by attendingName:
// [{ attendingName, days: [{ id, dayOfWeek, activityLabel }] }]
router.get('/', async (req, res) => {
  const { programId } = req.query;
  if (!programId) return res.status(400).json({ error: 'programId required' });
  try {
    const membership = await requireProgramPermission(req, res, programId, 'edit_attendings');
    if (!membership) return;
    const entries = await prisma.attendingScheduleTemplate.findMany({
      where: { programId },
      orderBy: [{ attendingName: 'asc' }, { dayOfWeek: 'asc' }],
    });
    // Group by attendingName
    const map = {};
    for (const e of entries) {
      if (!map[e.attendingName]) map[e.attendingName] = [];
      map[e.attendingName].push({ id: e.id, dayOfWeek: e.dayOfWeek, activityLabel: e.activityLabel });
    }
    const grouped = Object.entries(map).map(([attendingName, days]) => ({ attendingName, days }));
    res.json(grouped);
  } catch (err) {
    console.error('[attending-template GET /] error:', err.message);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

// GET /api/attending-template/:programId  (legacy — flat list, ordered by dayOfWeek)
router.get('/:programId', async (req, res) => {
  try {
    const membership = await requireProgramPermission(req, res, req.params.programId, 'edit_attendings');
    if (!membership) return;
    const entries = await prisma.attendingScheduleTemplate.findMany({
      where: { programId: req.params.programId },
      orderBy: [{ dayOfWeek: 'asc' }, { attendingName: 'asc' }],
    });
    res.json(entries);
  } catch (err) {
    console.error('[attending-template GET /:programId]', err.message);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

// POST /api/attending-template/:programId
router.post('/:programId', async (req, res) => {
  const { attendingName, dayOfWeek, activityLabel } = req.body;
  try {
    const membership = await requireProgramPermission(req, res, req.params.programId, 'edit_attendings');
    if (!membership) return;
    const entry = await prisma.attendingScheduleTemplate.create({
      data: {
        programId: req.params.programId,
        attendingName,
        dayOfWeek: Number(dayOfWeek),
        activityLabel,
      },
    });
    res.json(entry);
  } catch (err) {
    console.error('[attending-template POST]', err.message);
    res.status(500).json({ error: 'Failed to create template entry' });
  }
});

// PUT /api/attending-template/entry/:id
router.put('/entry/:id', async (req, res) => {
  const { activityLabel } = req.body;
  try {
    const existing = await prisma.attendingScheduleTemplate.findUnique({ where: { id: req.params.id }, select: { programId: true } });
    if (!existing) return res.status(404).json({ error: 'Template entry not found' });
    const membership = await requireProgramPermission(req, res, existing.programId, 'edit_attendings');
    if (!membership) return;
    const entry = await prisma.attendingScheduleTemplate.update({
      where: { id: req.params.id },
      data: { activityLabel },
    });
    res.json(entry);
  } catch (err) {
    console.error('[attending-template PUT /entry/:id]', err.message);
    res.status(500).json({ error: 'Failed to update template entry' });
  }
});

// DELETE /api/attending-template/entry/:id
router.delete('/entry/:id', async (req, res) => {
  try {
    const existing = await prisma.attendingScheduleTemplate.findUnique({ where: { id: req.params.id }, select: { programId: true } });
    if (!existing) return res.status(404).json({ error: 'Template entry not found' });
    const membership = await requireProgramPermission(req, res, existing.programId, 'edit_attendings');
    if (!membership) return;
    await prisma.attendingScheduleTemplate.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[attending-template DELETE /entry/:id]', err.message);
    res.status(500).json({ error: 'Failed to delete template entry' });
  }
});

// POST /api/attending-template/:programId/apply/:blockId
// Applies the weekly template to all days in the block (and optionally extra blocks).
// Body: { extraBlockIds?: string[] }  — additional block IDs to apply to as well.
// Creates a new entry where none exists; updates activityLabel where one already exists.
router.post('/:programId/apply/:blockId', async (req, res) => {
  const { programId, blockId } = req.params;
  const { extraBlockIds = [] } = req.body;
  if (!Array.isArray(extraBlockIds) || extraBlockIds.some(id => typeof id !== 'string' || !id)) {
    return res.status(400).json({ error: 'extraBlockIds must be an array of block IDs' });
  }
  const programMembership = await requireProgramPermission(req, res, programId, 'edit_attendings');
  if (!programMembership) return;

  const requestedBlockIds = [...new Set([blockId, ...extraBlockIds])];
  for (const requestedBlockId of requestedBlockIds) {
    const blockMembership = await requireBlockPermission(req, res, requestedBlockId, 'edit_attendings');
    if (!blockMembership) return;
    const blockAccess = await getProgramIdForBlock(requestedBlockId);
    if (blockAccess?.programId !== programId) {
      return res.status(400).json({ error: 'Every target block must belong to the template program' });
    }
  }

  async function applyToBlock(tx, bId, template) {
    const block = await tx.block.findUnique({ where: { id: bId } });
    if (!block) return { created: 0, updated: 0 };

    const cur   = startOfLogicalDay(block.startDate);
    const endL  = startOfLogicalDay(block.endDate);
    const days  = [];
    while (cur <= endL) {
      days.push(new Date(cur));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    let created = 0, updated = 0;
    for (const day of days) {
      const monBasedDow = (day.getUTCDay() + 6) % 7;
      const entries = template.filter(t => t.dayOfWeek === monBasedDow);
      const startOfDay = startOfLogicalDay(day);
      const nextDay = nextLogicalDay(startOfDay);
      for (const t of entries) {
        const existing = await tx.attendingEntry.findFirst({
          where: {
            blockId: bId,
            attendingName: t.attendingName,
            date: {
              gte: startOfDay,
              lt: nextDay,
            },
          },
        });
        if (existing) {
          await tx.attendingEntry.update({
            where: { id: existing.id },
            data: { activityLabel: t.activityLabel },
          });
          updated++;
        } else {
          await tx.attendingEntry.create({
            data: {
              blockId: bId,
              date: startOfDay,
              attendingName: t.attendingName,
              activityLabel: t.activityLabel,
              isCallDay: false,
            },
          });
          created++;
        }
      }
    }
    return { created, updated };
  }

  try {
    const template = await prisma.attendingScheduleTemplate.findMany({
      where: { programId },
    });

    const result = await prisma.$transaction(async tx => {
      let totalCreated = 0;
      let totalUpdated = 0;
      for (const requestedBlockId of requestedBlockIds) {
        const applied = await applyToBlock(tx, requestedBlockId, template);
        totalCreated += applied.created;
        totalUpdated += applied.updated;
      }
      return { totalCreated, totalUpdated };
    });

    res.json({
      applied: result.totalCreated + result.totalUpdated,
      created: result.totalCreated,
      updated: result.totalUpdated,
      blocks: requestedBlockIds.length,
    });
  } catch (err) {
    console.error('[attending-template apply]', err.message);
    res.status(500).json({ error: 'Failed to apply template' });
  }
});

module.exports = router;
