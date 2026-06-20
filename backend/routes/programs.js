const express = require('express');
const prisma = require('../lib/prisma');
const auth = require('../middleware/auth');
const { ROLES, normalizeRole, isValidRole, requireProgramPermission } = require('../lib/roles');
const { isAllowedSpecialty } = require('../lib/medicalSpecialties');

const router = express.Router();
router.use(auth);

// â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ GET /api/programs/mine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    const role = normalizeRole(membership.role);
    if (role !== membership.role) {
      await prisma.programMember.update({ where: { id: membership.id }, data: { role } });
    }
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
      juniorInHouseCall: program.juniorInHouseCall,
      seniorInHouseCall: program.seniorInHouseCall,
      role,
      academicYears: program.academicYears,
      blocks: allBlocks,
      currentBlock,
    });
  } catch (err) {
    console.error('[programs/mine] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// â”€â”€ GET /api/programs/stats?blockId= â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // Recent activity â€” last 5 real events across the program
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
        icon: 'ðŸ‘¤',
        color: '#16A34A',
        timestamp: e.id, // use id as proxy since BlockEnrollment has no createdAt
        _sort: e.id,
      })),
      ...recentAssignments.map(a => ({
        type: 'call_assigned',
        description: `Call assigned to ${a.resident.name}`,
        icon: 'ðŸ“‹',
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

// â”€â”€ POST /api/programs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.post('/', async (req, res) => {
  const { name, specialty, orgId, startDate, createNextYear } = req.body;
  if (!name || !specialty || !orgId) {
    return res.status(400).json({ error: 'name, specialty, and orgId are required' });
  }
  if (!isAllowedSpecialty(specialty)) {
    return res.status(400).json({ error: 'Invalid specialty' });
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
      data: { programId: program.id, userId: req.user.userId, role: ROLES.PROGRAM_ADMIN },
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

// â”€â”€ PUT /api/programs/:id â€” update name/specialty â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, specialty, juniorInHouseCall, seniorInHouseCall } = req.body;
  if (specialty !== undefined && !isAllowedSpecialty(specialty)) {
    return res.status(400).json({ error: 'Invalid specialty' });
  }
  if (juniorInHouseCall !== undefined && typeof juniorInHouseCall !== 'boolean') {
    return res.status(400).json({ error: 'juniorInHouseCall must be a boolean' });
  }
  if (seniorInHouseCall !== undefined && typeof seniorInHouseCall !== 'boolean') {
    return res.status(400).json({ error: 'seniorInHouseCall must be a boolean' });
  }
  try {
    const membership = await requireProgramPermission(req, res, id, 'edit_program_settings');
    if (!membership) return;

    const program = await prisma.program.update({
      where: { id },
      data: {
        ...(name      !== undefined && { name }),
        ...(specialty !== undefined && { specialty }),
        ...(juniorInHouseCall !== undefined && { juniorInHouseCall }),
        ...(seniorInHouseCall !== undefined && { seniorInHouseCall }),
      },
      select: {
        id: true,
        name: true,
        specialty: true,
        juniorInHouseCall: true,
        seniorInHouseCall: true,
      },
    });
    res.json(program);
  } catch (err) {
    console.error('[programs PUT /:id] Error:', err.message);
    res.status(500).json({ error: 'Failed to update program' });
  }
});

// â”€â”€ GET /api/programs/:id/members â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:id/members', async (req, res) => {
  const { id } = req.params;
  try {
    const membership = await requireProgramPermission(req, res, id, 'edit_program_settings');
    if (!membership) return;

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

// â”€â”€ PUT /api/programs/:id/members/:userId â€” update role â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.put('/:id/members/:userId', async (req, res) => {
  const { id, userId } = req.params;
  const { role } = req.body;
  const nextRole = normalizeRole(role);
  if (!isValidRole(nextRole)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  try {
    const requester = await requireProgramPermission(req, res, id, 'manage_users');
    if (!requester) return;

    const member = await prisma.programMember.findFirst({ where: { programId: id, userId } });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const updated = await prisma.programMember.update({
      where: { id: member.id },
      data:  { role: nextRole },
    });
    res.json(updated);
  } catch (err) {
    console.error('[programs/:id/members/:userId PUT] Error:', err.message);
    res.status(500).json({ error: 'Failed to update member role' });
  }
});

// â”€â”€ DELETE /api/programs/:id/members/:userId â€” remove member (or self-leave) â”€â”€

router.delete('/:id/members/:userId', async (req, res) => {
  const { id, userId } = req.params;
  const isSelfLeave = userId === req.user.userId;
  try {
    // Non-self removal requires admin privileges
    if (!isSelfLeave) {
      const requester = await requireProgramPermission(req, res, id, 'manage_users');
      if (!requester) return;
    }

    const member = await prisma.programMember.findFirst({ where: { programId: id, userId } });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    // A program admin cannot leave if they are the only admin.
    if (isSelfLeave && normalizeRole(member.role) === ROLES.PROGRAM_ADMIN) {
      const otherAdmins = await prisma.programMember.count({
        where: { programId: id, role: ROLES.PROGRAM_ADMIN, userId: { not: userId } },
      });
      if (otherAdmins === 0) {
        return res.status(400).json({ error: 'You must transfer the Program Admin role before leaving' });
      }
    }

    await prisma.programMember.delete({ where: { id: member.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('[programs/:id/members/:userId DELETE] Error:', err.message);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// â”€â”€ POST /api/programs/:id/invite â€” generate invite link â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.post('/:id/invite', async (req, res) => {
  const { id } = req.params;
  const { role = 'viewer' } = req.body;
  const inviteRole = normalizeRole(role);
  if (!isValidRole(inviteRole)) return res.status(400).json({ error: 'Invalid role' });
  try {
    const membership = await requireProgramPermission(req, res, id, 'manage_users');
    if (!membership) return;

    const invite = await prisma.invite.create({
      data: { programId: id, role: inviteRole },
    });
    res.json({ inviteLink: `http://localhost:5173/join/${invite.token}`, token: invite.token });
  } catch (err) {
    console.error('[programs/:id/invite POST] Error:', err.message);
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

// â”€â”€ GET /api/programs/join/:token â€” look up invite (public, no auth needed) â”€â”€â”€
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
    res.json({ programId: invite.programId, role: normalizeRole(invite.role), program: invite.program });
  } catch (err) {
    console.error('[programs/join/:token] Error:', err.message);
    res.status(500).json({ error: 'Failed to look up invite' });
  }
});

router.post('/:id/join-with-token', async (req, res) => {
  const { id } = req.params;
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  try {
    const invite = await prisma.invite.findUnique({ where: { token } });
    if (!invite || invite.usedAt || invite.programId !== id) {
      return res.status(404).json({ error: 'Invalid or expired invite link' });
    }

    const existing = await prisma.programMember.findFirst({
      where: { programId: id, userId: req.user.userId },
    });
    if (existing) {
      await prisma.invite.update({ where: { token }, data: { usedAt: new Date() } });
      return res.json({ membership: { ...existing, role: normalizeRole(existing.role) } });
    }

    const membership = await prisma.programMember.create({
      data: { programId: id, userId: req.user.userId, role: normalizeRole(invite.role) },
    });
    await prisma.invite.update({ where: { token }, data: { usedAt: new Date() } });
    res.status(201).json({ membership });
  } catch (err) {
    console.error('[programs/:id/join-with-token POST] Error:', err.message);
    res.status(500).json({ error: 'Failed to join program' });
  }
});

// â”€â”€ POST /api/programs/academic-year â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.post('/academic-year', async (req, res) => {
  const { programId, startDate } = req.body;
  if (!programId || !startDate) {
    return res.status(400).json({ error: 'programId and startDate are required' });
  }

  try {
    const membership = await requireProgramPermission(req, res, programId, 'create_academic_year');
    if (!membership) return;

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
