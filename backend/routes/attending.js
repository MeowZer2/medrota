const express = require('express');
const prisma = require('../lib/prisma');
const auth = require('../middleware/auth');
const { getMembership, resolvePermissions, getProgramIdForBlock, requireProgramPermission, requireBlockPermission, requireBlockView } = require('../lib/roles');
const { resolveActivityType } = require('../lib/activityRegistry');

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

function nextLogicalDay(value) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function addDays(date, count) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + count);
  return next;
}

// ── Roster routes (must be before /:id to avoid conflicts) ───────────────────

// GET /api/attending/roster?programId=
router.get('/roster', async (req, res) => {
  const { programId } = req.query;
  if (!programId) return res.status(400).json({ error: 'programId required' });
  const membership = await getMembership(req.user?.userId, programId);
  if (!membership) return res.status(403).json({ error: 'Not a member of this program' });
  const permissions = await resolvePermissions(programId, membership.role);
  if (!permissions.includes('manage_attending_roster') && !permissions.includes('manage_attending_schedule')) {
    return res.status(403).json({ error: 'Insufficient program permissions' });
  }
  const roster = await prisma.attendingRoster.findMany({
    where: { programId, ...(req.query.includeInactive === 'true' ? {} : { isActive: true }) },
    orderBy: { createdAt: 'asc' },
  });
  res.json(roster);
});

// POST /api/attending/roster
router.post('/roster', async (req, res) => {
  const { programId, attendingName, typicalActivities, email, phone, officeLocation } = req.body;
  if (!programId || !attendingName) {
    console.warn('[attending/roster POST] missing fields', { programId, attendingName });
    return res.status(400).json({ error: 'programId and attendingName required' });
  }
  const membership = await requireProgramPermission(req, res, programId, 'manage_attending_roster');
  if (!membership) return;
  try {
    const entry = await prisma.attendingRoster.create({
      data: { programId, attendingName: attendingName.trim(), typicalActivities: typicalActivities ?? [], email: email || null, phone: phone || null, officeLocation: officeLocation || null },
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
  const { attendingName, typicalActivities, email, phone, officeLocation, isActive } = req.body;
  try {
    const existing = await prisma.attendingRoster.findUnique({ where: { id: req.params.id }, select: { programId: true } });
    if (!existing) return res.status(404).json({ error: 'Roster entry not found' });
    const membership = await requireProgramPermission(req, res, existing.programId, 'manage_attending_roster');
    if (!membership) return;
    const entry = await prisma.attendingRoster.update({
      where: { id: req.params.id },
      data: {
        ...(attendingName     !== undefined && { attendingName }),
        ...(typicalActivities !== undefined && { typicalActivities }),
        ...(email !== undefined && { email: email || null }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(officeLocation !== undefined && { officeLocation: officeLocation || null }),
        ...(typeof isActive === 'boolean' && { isActive }),
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
  const existing = await prisma.attendingRoster.findUnique({ where: { id: req.params.id }, select: { programId: true } });
  if (!existing) return res.status(404).json({ error: 'Roster entry not found' });
  const membership = await requireProgramPermission(req, res, existing.programId, 'manage_attending_roster');
  if (!membership) return;
  const entry = await prisma.attendingRoster.update({ where: { id: req.params.id }, data: { isActive: false } });
  res.json({ success: true, entry });
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
    const targetMembership = await requireBlockPermission(req, res, targetBlockId, 'manage_attending_schedule');
    if (!targetMembership) return;
    const sourceMembership = await requireBlockView(req, res, sourceBlockId);
    if (!sourceMembership) return;
    const [sourceAccess, targetAccess] = await Promise.all([
      getProgramIdForBlock(sourceBlockId),
      getProgramIdForBlock(targetBlockId),
    ]);
    if (sourceAccess?.programId !== targetAccess?.programId) {
      return res.status(400).json({ error: 'Source and target blocks must belong to the same program' });
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
        activityTypeId: entry.activityTypeId ?? null,
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
  const membership = await requireBlockView(req, res, blockId);
  if (!membership) return;

  const entries = await prisma.attendingEntry.findMany({
    where: { blockId },
    orderBy: [{ date: 'asc' }, { attendingName: 'asc' }],
  });

  console.log(`[attending GET] found ${entries.length} entries for blockId=${blockId}`);
  res.json(entries);
});

// POST /api/attending
router.post('/', async (req, res) => {
  const { blockId, attendingName, date, activityLabel, notes, isCallDay } = req.body;
  if (!blockId || !attendingName || !date) {
    console.warn('[attending POST] missing required fields', { blockId, attendingName, date });
    return res.status(400).json({ error: 'blockId, attendingName, and date are required' });
  }
  const membership = await requireBlockPermission(req, res, blockId, 'manage_attending_schedule');
  if (!membership) return;

  // Verify the block exists before writing
  const block = await prisma.block.findUnique({ where: { id: blockId }, select: { id: true, academicYear: { select: { programId: true } } } });
  if (!block) {
    console.error(`[attending POST] Block not found: blockId=${blockId}`);
    return res.status(404).json({ error: 'Block not found' });
  }

  try {
    const day = startOfLogicalDay(date);
    const resolvedActivity = await resolveActivityType(block.academicYear.programId, activityLabel ?? '');
    const entryData = {
      ...resolvedActivity,
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
    console.error('[attending POST] Prisma error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Failed to create attending entry' });
  }
});

// PUT /api/attending/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { attendingName, date, activityLabel, notes, isCallDay } = req.body;
  const existing = await prisma.attendingEntry.findUnique({
    where: { id },
    select: { blockId: true, activityTypeId: true },
  });
  if (!existing) return res.status(404).json({ error: 'Attending entry not found' });
  const membership = await requireBlockPermission(req, res, existing.blockId, 'manage_attending_schedule');
  if (!membership) return;
  try {
    const blockAccess = await getProgramIdForBlock(existing.blockId);
    const resolvedActivity = activityLabel === undefined
      ? null
      : await resolveActivityType(blockAccess.programId, activityLabel, { allowInactiveId: existing.activityTypeId });
    const entry = await prisma.attendingEntry.update({
      where: { id },
      data: {
        ...(attendingName  !== undefined && { attendingName }),
        ...(date           !== undefined && { date: startOfLogicalDay(date) }),
        ...(resolvedActivity && resolvedActivity),
        ...(notes          !== undefined && { notes }),
        ...(isCallDay      !== undefined && { isCallDay }),
      },
    });
    res.json(entry);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Failed to update attending entry' });
  }
});

// DELETE /api/attending?blockId= — delete ALL entries for a block
router.delete('/', async (req, res) => {
  const { blockId } = req.query;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });
  const membership = await requireBlockPermission(req, res, blockId, 'manage_attending_schedule');
  if (!membership) return;
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
  const existing = await prisma.attendingEntry.findUnique({ where: { id: req.params.id }, select: { blockId: true } });
  if (!existing) return res.status(404).json({ error: 'Attending entry not found' });
  const membership = await requireBlockPermission(req, res, existing.blockId, 'manage_attending_schedule');
  if (!membership) return;
  await prisma.attendingEntry.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// DELETE /api/attending/block/:blockId
router.delete('/block/:blockId', async (req, res) => {
  const { blockId } = req.params;
  const membership = await requireBlockPermission(req, res, blockId, 'manage_attending_schedule');
  if (!membership) return;
  try {
    const deleted = await prisma.attendingEntry.deleteMany({ where: { blockId } });
    res.json({ success: true, deletedCount: deleted.count });
  } catch (err) {
    console.error('[attending/block DELETE] error:', err.message);
    res.status(500).json({ error: 'Failed to reset block schedule' });
  }
});

module.exports = router;
