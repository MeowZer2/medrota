const express = require('express');
const prisma = require('../lib/prisma');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// ── helpers ────────────────────────────────────────────────────────────────────

function buildBlocks(yearStart, count = 13) {
  const blockDefs = [];
  let cursor = new Date(yearStart);
  for (let i = 1; i <= count; i++) {
    const blockStart = new Date(cursor);
    const blockEnd = new Date(cursor);
    blockEnd.setDate(blockEnd.getDate() + 27); // 28-day inclusive block
    blockDefs.push({ number: i, startDate: new Date(blockStart), endDate: new Date(blockEnd) });
    cursor.setDate(cursor.getDate() + 28);
  }
  const yearEnd = new Date(cursor);
  yearEnd.setDate(yearEnd.getDate() - 1);
  return { blockDefs, yearEnd };
}

// ── GET /api/programs/mine ─────────────────────────────────────────────────────

router.get('/mine', async (req, res) => {
  try {
    const membership = await prisma.programMember.findFirst({
      where: { userId: req.user.userId },
      include: {
        program: {
          include: {
            academicYears: {
              orderBy: { startDate: 'asc' },
              include: {
                blocks: { orderBy: { number: 'asc' } },
              },
            },
          },
        },
      },
    });

    if (!membership) {
      console.log(`[programs/mine] No membership for userId=${req.user.userId}`);
      return res.status(404).json({ error: 'No program membership found' });
    }

    const program = membership.program;
    const allBlocks = program.academicYears.flatMap(ay => ay.blocks);
    const today = new Date();
    const currentBlock =
      allBlocks.find(b => today >= new Date(b.startDate) && today <= new Date(b.endDate))
      ?? allBlocks[0]
      ?? null;

    res.json({
      programId: program.id,
      programName: program.name,
      specialty: program.specialty,
      role: membership.role,
      academicYears: program.academicYears,
      blocks: allBlocks,
      currentBlock,
    });
  } catch (err) {
    console.error('[programs/mine] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/programs/stats?blockId= ──────────────────────────────────────────

router.get('/stats', async (req, res) => {
  const { blockId } = req.query;
  if (!blockId) return res.status(400).json({ error: 'blockId is required' });

  try {
    const block = await prisma.block.findUnique({
      where: { id: blockId },
      include: {
        academicYear: { select: { programId: true } },
        enrollments: {
          include: { resident: { select: { id: true, name: true } } },
        },
        callDays: {
          include: { assignments: { select: { residentId: true, isOverride: true } } },
        },
      },
    });

    if (!block) return res.status(404).json({ error: 'Block not found' });

    const start = new Date(block.startDate);
    const end   = new Date(block.endDate);
    const daysInBlock = Math.round((end - start) / 86400000) + 1;

    const residents = block.enrollments.length;

    const assignedDays = block.callDays.filter(cd => cd.assignments.length > 0).length;
    const unassignedDays = daysInBlock - assignedDays;

    const allAssignments = block.callDays.flatMap(cd => cd.assignments);
    const warnings = allAssignments.filter(a => a.isOverride).length;
    const avgCalls = residents > 0
      ? parseFloat((allAssignments.length / residents).toFixed(1))
      : 0;

    // Per-resident call count
    const countMap = {};
    for (const e of block.enrollments) {
      countMap[e.residentId] = { residentName: e.resident.name, callCount: 0 };
    }
    for (const a of allAssignments) {
      if (countMap[a.residentId]) countMap[a.residentId].callCount++;
    }
    const callDistribution = Object.values(countMap).sort((a, b) => b.callCount - a.callCount);

    // Recent activity — last 5 real events across the program
    const programId = block.academicYear
      ? block.academicYear.programId
      : null;

    // Fetch recent enrollments (new residents added)
    const recentEnrollments = await prisma.blockEnrollment.findMany({
      where: { blockId },
      include: { resident: { select: { name: true } } },
      orderBy: { id: 'desc' },
      take: 5,
    });

    // Fetch recent call assignments
    const recentAssignments = await prisma.callAssignment.findMany({
      where: { callDay: { blockId } },
      include: { resident: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    // Build unified activity list
    const activityEvents = [
      ...recentEnrollments.map(e => ({
        type: 'resident_added',
        description: `${e.resident.name} enrolled in Block ${block.number}`,
        icon: '👤',
        color: '#16A34A',
        timestamp: e.id, // use id as proxy since BlockEnrollment has no createdAt
        _sort: e.id,
      })),
      ...recentAssignments.map(a => ({
        type: 'call_assigned',
        description: `Call assigned to ${a.resident.name}`,
        icon: '📋',
        color: '#2C5F8A',
        timestamp: a.createdAt,
        _sort: a.createdAt,
      })),
    ];

    // Sort by timestamp desc, take top 5
    activityEvents.sort((a, b) => {
      const ta = a.timestamp instanceof Date ? a.timestamp : new Date(0);
      const tb = b.timestamp instanceof Date ? b.timestamp : new Date(0);
      return tb - ta;
    });
    const recentActivity = activityEvents.slice(0, 5).map(({ _sort, ...rest }) => rest);

    res.json({
      block: { number: block.number, startDate: block.startDate, endDate: block.endDate },
      daysInBlock,
      residents,
      assignedDays,
      unassignedDays,
      warnings,
      avgCalls,
      callDistribution,
      recentActivity,
    });
  } catch (err) {
    console.error('[programs/stats] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/programs ─────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { name, specialty, orgId, startDate, createNextYear } = req.body;
  if (!name || !specialty || !orgId) {
    return res.status(400).json({ error: 'name, specialty, and orgId are required' });
  }

  try {
    const yearStart = startDate ? new Date(startDate) : (() => {
      const d = new Date(); d.setMonth(6); d.setDate(1); return d;
    })();

    const { blockDefs, yearEnd } = buildBlocks(yearStart);

    const academicYearsData = [{
      startDate: yearStart,
      endDate: yearEnd,
      blocks: { create: blockDefs },
    }];

    if (createNextYear) {
      const nextStart = new Date(yearStart);
      nextStart.setFullYear(nextStart.getFullYear() + 1);
      const { blockDefs: nextBlockDefs, yearEnd: nextYearEnd } = buildBlocks(nextStart);
      academicYearsData.push({
        startDate: nextStart,
        endDate: nextYearEnd,
        blocks: { create: nextBlockDefs },
      });
    }

    const program = await prisma.program.create({
      data: {
        name,
        specialty,
        orgId,
        academicYears: { create: academicYearsData },
      },
      include: {
        academicYears: {
          orderBy: { startDate: 'asc' },
          include: { blocks: { orderBy: { number: 'asc' } } },
        },
      },
    });

    await prisma.programMember.create({
      data: { programId: program.id, userId: req.user.userId, role: 'admin' },
    });

    const allBlocks = program.academicYears.flatMap(ay => ay.blocks);
    res.status(201).json({
      programId: program.id,
      programName: program.name,
      specialty: program.specialty,
      academicYears: program.academicYears,
      blocks: allBlocks,
    });
  } catch (err) {
    console.error('[programs POST] Error:', err);
    res.status(500).json({ error: 'Failed to create program' });
  }
});

// ── PUT /api/programs/:id — update name/specialty ─────────────────────────────

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, specialty } = req.body;
  try {
    const membership = await prisma.programMember.findFirst({
      where: { programId: id, userId: req.user.userId },
    });
    if (!membership) return res.status(403).json({ error: 'Not a member of this program' });

    const program = await prisma.program.update({
      where: { id },
      data: {
        ...(name      !== undefined && { name }),
        ...(specialty !== undefined && { specialty }),
      },
      select: { id: true, name: true, specialty: true },
    });
    res.json(program);
  } catch (err) {
    console.error('[programs PUT /:id] Error:', err.message);
    res.status(500).json({ error: 'Failed to update program' });
  }
});

// ── GET /api/programs/:id/members ─────────────────────────────────────────────

router.get('/:id/members', async (req, res) => {
  const { id } = req.params;
  try {
    const membership = await prisma.programMember.findFirst({
      where: { programId: id, userId: req.user.userId },
    });
    if (!membership) return res.status(403).json({ error: 'Not a member of this program' });

    const members = await prisma.programMember.findMany({
      where: { programId: id },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json(members);
  } catch (err) {
    console.error('[programs/:id/members GET] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// ── PUT /api/programs/:id/members/:userId — update role ───────────────────────

router.put('/:id/members/:userId', async (req, res) => {
  const { id, userId } = req.params;
  const { role } = req.body;
  try {
    const requester = await prisma.programMember.findFirst({
      where: { programId: id, userId: req.user.userId, role: 'admin' },
    });
    if (!requester) return res.status(403).json({ error: 'Only admins can change roles' });

    const member = await prisma.programMember.findFirst({ where: { programId: id, userId } });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const updated = await prisma.programMember.update({
      where: { id: member.id },
      data:  { role },
    });
    res.json(updated);
  } catch (err) {
    console.error('[programs/:id/members/:userId PUT] Error:', err.message);
    res.status(500).json({ error: 'Failed to update member role' });
  }
});

// ── DELETE /api/programs/:id/members/:userId — remove member (or self-leave) ──

router.delete('/:id/members/:userId', async (req, res) => {
  const { id, userId } = req.params;
  const isSelfLeave = userId === req.user.userId;
  try {
    // Non-self removal requires admin privileges
    if (!isSelfLeave) {
      const requester = await prisma.programMember.findFirst({
        where: { programId: id, userId: req.user.userId, role: 'admin' },
      });
      if (!requester) return res.status(403).json({ error: 'Only admins can remove members' });
    }

    const member = await prisma.programMember.findFirst({ where: { programId: id, userId } });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    // A coordinator (admin) cannot leave if they are the only admin
    if (isSelfLeave && member.role === 'admin') {
      const otherAdmins = await prisma.programMember.count({
        where: { programId: id, role: 'admin', userId: { not: userId } },
      });
      if (otherAdmins === 0) {
        return res.status(400).json({ error: 'You must transfer the Coordinator role before leaving' });
      }
    }

    await prisma.programMember.delete({ where: { id: member.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('[programs/:id/members/:userId DELETE] Error:', err.message);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// ── POST /api/programs/:id/invite — generate invite link ─────────────────────

router.post('/:id/invite', async (req, res) => {
  const { id } = req.params;
  const { role = 'viewer' } = req.body;
  try {
    const membership = await prisma.programMember.findFirst({
      where: { programId: id, userId: req.user.userId },
    });
    if (!membership) return res.status(403).json({ error: 'Not a member of this program' });

    const invite = await prisma.invite.create({
      data: { programId: id, role },
    });
    res.json({ inviteLink: `http://localhost:5173/join/${invite.token}`, token: invite.token });
  } catch (err) {
    console.error('[programs/:id/invite POST] Error:', err.message);
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

// ── GET /api/programs/join/:token — look up invite (public, no auth needed) ───
// NOTE: this must be defined BEFORE the generic /:id routes to avoid conflict.
// It is mounted via the main router which already called router.use(auth), so
// we duplicate the logic inside a non-auth version in index.js via the publicRoutes.
// Here we keep a protected copy for logged-in join flows.

router.get('/join/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const invite = await prisma.invite.findUnique({
      where: { token },
      include: { program: { select: { id: true, name: true, specialty: true } } },
    });
    if (!invite) return res.status(404).json({ error: 'Invite not found' });
    res.json({ programId: invite.programId, role: invite.role, program: invite.program });
  } catch (err) {
    console.error('[programs/join/:token] Error:', err.message);
    res.status(500).json({ error: 'Failed to look up invite' });
  }
});

// ── POST /api/programs/academic-year ──────────────────────────────────────────

router.post('/academic-year', async (req, res) => {
  const { programId, startDate } = req.body;
  if (!programId || !startDate) {
    return res.status(400).json({ error: 'programId and startDate are required' });
  }

  try {
    // Verify the requesting user is a member of this program
    const membership = await prisma.programMember.findFirst({
      where: { programId, userId: req.user.userId },
    });
    if (!membership) return res.status(403).json({ error: 'Not a member of this program' });

    const yearStart = new Date(startDate);
    const { blockDefs, yearEnd } = buildBlocks(yearStart);

    const academicYear = await prisma.academicYear.create({
      data: {
        programId,
        startDate: yearStart,
        endDate: yearEnd,
        blocks: { create: blockDefs },
      },
      include: { blocks: { orderBy: { number: 'asc' } } },
    });

    res.status(201).json({ academicYear });
  } catch (err) {
    console.error('[programs/academic-year POST] Error:', err);
    res.status(500).json({ error: 'Failed to create academic year' });
  }
});

module.exports = router;
