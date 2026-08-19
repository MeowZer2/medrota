const express = require('express');
const prisma = require('../lib/prisma');
const auth = require('../middleware/auth');
const { assertResidentBelongsToBlockProgram, requireBlockPermission, requireBlockView } = require('../lib/roles');
const { validateProposedDayAssignments } = require('../services/scheduleValidator');

const router = express.Router();
router.use(auth);

const RESIDENT_ROLES_ON_DAY = new Set(['senior', 'junior']);

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

function validateRoleOnDay(roleOnDay) {
  return typeof roleOnDay === 'string' && RESIDENT_ROLES_ON_DAY.has(roleOnDay);
}

function residentCanFillRole(resident, roleOnDay) {
  if (!resident?.isActive) return false;
  if (roleOnDay === 'senior') return !resident.isMedStudent && resident.residentRole === 'senior';
  return resident.isMedStudent || resident.residentRole === 'junior';
}

async function validateAttendingEntryForBlock(res, attendingEntryId, blockId) {
  if (attendingEntryId === undefined || attendingEntryId === null || attendingEntryId === '') return true;
  const attendingEntry = await prisma.attendingEntry.findUnique({
    where: { id: attendingEntryId },
    select: { blockId: true },
  });
  if (!attendingEntry) {
    res.status(404).json({ error: 'Attending entry not found' });
    return false;
  }
  if (attendingEntry.blockId !== blockId) {
    res.status(400).json({ error: 'Attending entry must belong to the same block' });
    return false;
  }
  return true;
}

// GET /api/assignments?blockId= — all assignments for a block (joined with date + resident)
// GET /api/assignments?callDayId= — assignments for one call day
router.get('/', async (req, res) => {
  const { blockId, callDayId } = req.query;

  if (blockId) {
    const membership = await requireBlockView(req, res, blockId);
    if (!membership) return;
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
  const callDay = await prisma.callDay.findUnique({ where: { id: callDayId }, select: { blockId: true } });
  if (!callDay) return res.status(404).json({ error: 'Call day not found' });
  const membership = await requireBlockView(req, res, callDay.blockId);
  if (!membership) return;

  const assignments = await prisma.callAssignment.findMany({
    where: { callDayId },
    include: { resident: true },
  });
  res.json(assignments);
});

// POST /api/assignments — upsert CallDay + assignment for (blockId, date, residentId, roleOnDay)
router.post('/', async (req, res) => {
  const { blockId, date, residentId, roleOnDay, attendingEntryId, isOverride, overrideReason } = req.body;
  if (!blockId || !date || !residentId || !roleOnDay) {
    return res.status(400).json({ error: 'blockId, date, residentId, roleOnDay required' });
  }
  if (!validateRoleOnDay(roleOnDay)) {
    return res.status(400).json({ error: 'roleOnDay must be senior or junior' });
  }
  const membership = await requireBlockPermission(req, res, blockId, 'manual_assign_calls');
  if (!membership) return;
  const ownership = await assertResidentBelongsToBlockProgram(res, residentId, blockId);
  if (!ownership) return;
  if (!residentCanFillRole(ownership.resident, roleOnDay)) {
    return res.status(400).json({ error: `Resident is not eligible for the ${roleOnDay} slot` });
  }
  if (!await validateAttendingEntryForBlock(res, attendingEntryId, blockId)) return;

  const startOfDay = startOfLogicalDay(date);
  const nextDay = nextLogicalDay(startOfDay);

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

  if (existing && existing.roleOnDay !== roleOnDay) {
    return res.status(409).json({ error: 'Resident is already assigned to another role on this call day' });
  }
  const existingRoleAssignment = await prisma.callAssignment.findFirst({
    where: { callDayId: callDay.id, roleOnDay },
  });
  if (existingRoleAssignment && existingRoleAssignment.residentId !== residentId) {
    return res.status(409).json({ error: `${roleOnDay} slot is already assigned` });
  }

  const assignment = existing
    ? await prisma.callAssignment.update({
        where: { id: existing.id },
        data: {
          roleOnDay,
          ...(isOverride !== undefined && { isOverride }),
          ...(overrideReason !== undefined && { overrideReason }),
        },
      })
    : await prisma.callAssignment.create({
        data: {
          callDayId: callDay.id,
          residentId,
          roleOnDay,
          isOverride: isOverride ?? false,
          overrideReason: overrideReason ?? null,
        },
      });

  res.status(201).json({ callDay, assignment });
});

// PUT /api/assignments/day - atomically replace the senior/junior slots for one day.
router.put('/day', async (req, res) => {
  const {
    blockId, date, seniorId, juniorId, attendingEntryId,
    confirmOverride = false, overrideReason,
  } = req.body;
  if (!blockId || !date) {
    return res.status(400).json({ error: 'blockId and date are required' });
  }
  if (seniorId && juniorId && seniorId === juniorId) {
    return res.status(400).json({
      error: 'The same resident cannot be assigned as both senior and junior on the same call day.',
    });
  }

  const membership = await requireBlockPermission(req, res, blockId, 'manual_assign_calls');
  if (!membership) return;
  if (!await validateAttendingEntryForBlock(res, attendingEntryId, blockId)) return;

  const requested = [
    ...(seniorId ? [{ residentId: seniorId, roleOnDay: 'senior' }] : []),
    ...(juniorId ? [{ residentId: juniorId, roleOnDay: 'junior' }] : []),
  ];
  for (const item of requested) {
    const ownership = await assertResidentBelongsToBlockProgram(res, item.residentId, blockId);
    if (!ownership) return;
    if (!residentCanFillRole(ownership.resident, item.roleOnDay)) {
      return res.status(400).json({ error: `Resident is not eligible for the ${item.roleOnDay} slot` });
    }
  }

  const startOfDay = startOfLogicalDay(date);
  const nextDay = nextLogicalDay(startOfDay);
  const block = await prisma.block.findUnique({
    where: { id: blockId },
    select: { startDate: true, endDate: true },
  });
  if (!block) return res.status(404).json({ error: 'Block not found' });
  if (startOfDay < startOfLogicalDay(block.startDate) || startOfDay > startOfLogicalDay(block.endDate)) {
    return res.status(400).json({ error: 'Assignment date must fall within the block' });
  }

  const validation = await validateProposedDayAssignments(blockId, {
    date,
    seniorId: seniorId || null,
    juniorId: juniorId || null,
    overrideReason: overrideReason?.trim() || null,
  });
  if (!validation) return res.status(404).json({ error: 'Block not found' });
  if (validation.violations.length > 0 && !confirmOverride) {
    return res.status(409).json({
      requiresOverrideConfirmation: true,
      violations: validation.violations,
    });
  }
  if (validation.violations.length > 0 && (!overrideReason || !overrideReason.trim())) {
    return res.status(400).json({
      error: 'An override reason is required when confirming a rule violation.',
      violations: validation.violations,
    });
  }

  try {
    const result = await prisma.$transaction(async tx => {
      let callDay = await tx.callDay.findFirst({
        where: { blockId, date: { gte: startOfDay, lt: nextDay } },
      });
      if (!callDay) {
        callDay = await tx.callDay.create({
          data: { blockId, date: startOfDay, attendingEntryId: attendingEntryId || null },
        });
      } else if (attendingEntryId !== undefined) {
        callDay = await tx.callDay.update({
          where: { id: callDay.id },
          data: { attendingEntryId: attendingEntryId || null },
        });
      }

      const previousAssignments = await tx.callAssignment.findMany({
        where: { callDayId: callDay.id, roleOnDay: { in: ['senior', 'junior'] } },
      });
      await tx.callAssignment.deleteMany({
        where: { callDayId: callDay.id, roleOnDay: { in: ['senior', 'junior'] } },
      });
      if (requested.length) {
        await tx.callAssignment.createMany({
          data: requested.map(item => {
            const prior = previousAssignments.find(previous =>
              previous.residentId === item.residentId && previous.roleOnDay === item.roleOnDay
            );
            const confirmedViolation = validation.violations.some(violation =>
              !violation.residentId || violation.residentId === item.residentId
            );
            return {
              callDayId: callDay.id,
              residentId: item.residentId,
              roleOnDay: item.roleOnDay,
              isOverride: true,
              overrideReason: confirmedViolation
                ? overrideReason.trim()
                : (prior?.overrideReason ?? null),
            };
          }),
        });
      }
      const assignments = await tx.callAssignment.findMany({
        where: { callDayId: callDay.id },
        include: { resident: { select: { id: true, name: true, residentRole: true } } },
        orderBy: { roleOnDay: 'desc' },
      });
      return { callDay, assignments, validation: validation.proposed };
    });

    res.json(result);
  } catch (err) {
    console.error('[assignments/day PUT] error:', err.message);
    res.status(500).json({ error: 'Failed to save call-day assignments' });
  }
});

// DELETE /api/assignments/:id
router.delete('/:id', async (req, res) => {
  const assignment = await prisma.callAssignment.findUnique({
    where: { id: req.params.id },
    select: { callDay: { select: { blockId: true } } },
  });
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  const membership = await requireBlockPermission(req, res, assignment.callDay.blockId, 'manual_assign_calls');
  if (!membership) return;
  await prisma.callAssignment.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

module.exports = router;
