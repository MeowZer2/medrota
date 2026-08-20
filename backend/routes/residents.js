const express = require('express');
const prisma = require('../lib/prisma');
const auth = require('../middleware/auth');
const {
  assertResidentBelongsToBlockProgram,
  getProgramIdForBlock,
  requireProgramPermission,
  requireBlockPermission,
} = require('../lib/roles');
const { recordAuditEvent } = require('../services/auditLog');

const router = express.Router();
router.use(auth);

// ── helpers ───────────────────────────────────────────────────────────────────

function sanitizeVacationDates(raw = []) {
  const out = [];
  for (const item of raw) {
    if (!item) continue;
    if (typeof item === 'object' && item.startDate && item.endDate) {
      let cur = new Date(item.startDate);
      const end = new Date(item.endDate);
      while (cur <= end) {
        const iso = toValidISO(cur.toISOString().slice(0, 10));
        if (iso) out.push(new Date(iso));
        cur.setDate(cur.getDate() + 1);
      }
      continue;
    }
    const iso = toValidISO(item);
    if (iso) out.push(new Date(iso));
  }
  return out;
}

function toValidISO(val) {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function shapeResident(r, enrollment = null, callCount = 0) {
  return {
    id:                r.id,
    name:              r.name,
    email:             r.email ?? null,
    pgyLevel:          r.pgyLevel,
    residentRole:      r.residentRole,
    isMedStudent:      r.isMedStudent,
    isServiceResident: r.isServiceResident ?? true,
    isActive:          r.isActive ?? true,
    enrollmentId:      enrollment?.id ?? null,
    vacationDates:     enrollment?.vacationDates ?? [],
    academicDayPref:   enrollment?.academicDayPref ?? null,
    callCapOverride:   enrollment?.callCapOverride ?? null,
    callCount,
    isEnrolledThisBlock: enrollment !== null,
  };
}

// ── GET /api/residents?programId=[&blockId=]  ─────────────────────────────────
// Returns all service residents for the program + off-service residents enrolled
// in the given block. Each result includes isEnrolledThisBlock.

// ── GET /api/residents?blockId=  (used by BlockPage)  ────────────────────────
// Returns enrolled residents for the block (service residents auto-included).

router.get('/', async (req, res) => {
  const { blockId, programId } = req.query;

  // ── programId path ─────────────────────────────────────────────────────────
  if (programId) {
    try {
      const membership = await requireProgramPermission(req, res, programId, 'manage_residents');
      if (!membership) return;
      if (blockId) {
        const blockMembership = await requireBlockPermission(req, res, blockId, 'manage_residents');
        if (!blockMembership) return;
        const blockAccess = await getProgramIdForBlock(blockId);
        if (blockAccess?.programId !== programId) {
          return res.status(400).json({ error: 'Block must belong to the requested program' });
        }
      }
      // 1. All service residents for the program
      const serviceResidents = await prisma.residentProfile.findMany({
        where: { programId, isServiceResident: true },
        orderBy: { createdAt: 'asc' },
      });

      // 2. Enrollment map for service residents in this block (if blockId provided)
      let serviceEnrollmentMap = {};
      if (blockId) {
        const ids = serviceResidents.map(r => r.id);
        const enrollments = await prisma.blockEnrollment.findMany({
          where: { blockId, residentId: { in: ids } },
        });
        serviceEnrollmentMap = Object.fromEntries(enrollments.map(e => [e.residentId, e]));
      }

      // 3. Off-service residents enrolled in this block (if blockId)
      let offService = [];
      if (blockId) {
        const offEnrollments = await prisma.blockEnrollment.findMany({
          where: {
            blockId,
            resident: { programId, isServiceResident: false },
          },
          include: { resident: true },
        });
        offService = offEnrollments.map(e => shapeResident(e.resident, e, 0));
      }

      // 4. Call counts (if blockId)
      let callMap = {};
      if (blockId) {
        const allIds = [
          ...serviceResidents.map(r => r.id),
          ...offService.map(r => r.id),
        ];
        const counts = await prisma.callAssignment.groupBy({
          by: ['residentId'],
          where: { callDay: { blockId }, residentId: { in: allIds } },
          _count: { id: true },
        });
        callMap = Object.fromEntries(counts.map(c => [c.residentId, c._count.id]));
      }

      const serviceResult = serviceResidents.map(r =>
        shapeResident(r, serviceEnrollmentMap[r.id] ?? null, callMap[r.id] ?? 0)
      );
      const offServiceResult = offService.map(r => ({ ...r, callCount: callMap[r.id] ?? 0 }));

      return res.json([...serviceResult, ...offServiceResult]);
    } catch (err) {
      console.error('[residents GET programId] error:', err.message);
      return res.status(500).json({ error: 'Failed to fetch residents' });
    }
  }

  // ── blockId path (for BlockPage and scheduler fallback) ───────────────────
  if (blockId) {
    try {
      const membership = await requireBlockPermission(req, res, blockId, 'manage_residents');
      if (!membership) return;
      // Find programId via block
      const block = await prisma.block.findUnique({
        where: { id: blockId },
        select: { academicYear: { select: { programId: true } } },
      });
      const pid = block?.academicYear?.programId;

      // Block enrollments (off-service or service with explicit enrollment)
      const enrollments = await prisma.blockEnrollment.findMany({
        where: { blockId },
        include: { resident: true },
      });
      const enrolledIds = new Set(enrollments.map(e => e.residentId));

      // Service residents not already in enrollments (auto-included)
      let serviceExtra = [];
      if (pid) {
        const svc = await prisma.residentProfile.findMany({
          where: { programId: pid, isServiceResident: true },
          orderBy: { createdAt: 'asc' },
        });
        serviceExtra = svc.filter(r => !enrolledIds.has(r.id));
      }

      const callCounts = await prisma.callAssignment.groupBy({
        by: ['residentId'],
        where: { callDay: { blockId } },
        _count: { id: true },
      });
      const callMap = Object.fromEntries(callCounts.map(c => [c.residentId, c._count.id]));

      const result = [
        ...enrollments.map(e => shapeResident(e.resident, e, callMap[e.resident.id] ?? 0)),
        ...serviceExtra.map(r => shapeResident(r, null, callMap[r.id] ?? 0)),
      ];

      return res.json(result);
    } catch (err) {
      console.error('[residents GET blockId] error:', err.message);
      return res.status(500).json({ error: 'Failed to fetch residents' });
    }
  }

  return res.status(400).json({ error: 'blockId or programId query param required' });
});

// ── POST /api/residents ───────────────────────────────────────────────────────
// isServiceResident=true  → create ResidentProfile only (no BlockEnrollment)
// isServiceResident=false → create ResidentProfile + BlockEnrollment for blockId

router.post('/', async (req, res) => {
  const {
    programId, blockId,
    name, pgyLevel, residentRole, isMedStudent,
    isServiceResident,
    vacationDates, academicDayPref, callCapOverride,
    email,
  } = req.body;

  if (!programId || !name || !pgyLevel || !residentRole) {
    return res.status(400).json({ error: 'programId, name, pgyLevel, residentRole are required' });
  }
  const membership = await requireProgramPermission(req, res, programId, 'manage_residents');
  if (!membership) return;
  if (blockId) {
    const blockMembership = await requireBlockPermission(req, res, blockId, 'manage_residents');
    if (!blockMembership) return;
    const blockAccess = await getProgramIdForBlock(blockId);
    if (blockAccess?.programId !== programId) {
      return res.status(400).json({ error: 'Resident and block must belong to the same program' });
    }
  }

  // Medical students are always off-service and always require a block
  const isMed = isMedStudent ?? false;
  if (isMed && !blockId) {
    return res.status(400).json({ error: 'blockId required for medical students' });
  }
  const isService = isMed ? false : (isServiceResident !== false); // med students always off-service

  try {
    const resident = await prisma.residentProfile.create({
      data: {
        programId,
        name,
        pgyLevel: String(pgyLevel),
        residentRole,
        isMedStudent: isMed,
        isServiceResident: isService,
        isActive: true,
        ...(email ? { email } : {}),
      },
    });

    // Med students and off-service residents always get a BlockEnrollment
    // Service residents only get one if blockId + block-specific prefs are provided
    if (blockId && (isMed || !isService)) {
      const cleanDates = sanitizeVacationDates(vacationDates ?? []);
      await prisma.blockEnrollment.create({
        data: {
          blockId,
          residentId: resident.id,
          vacationDates: cleanDates,
          academicDayPref: academicDayPref ?? null,
          callCapOverride: callCapOverride != null ? parseInt(callCapOverride, 10) : null,
        },
      });
    } else if (blockId && isService && (vacationDates?.length || academicDayPref || callCapOverride)) {
      const cleanDates = sanitizeVacationDates(vacationDates ?? []);
      await prisma.blockEnrollment.create({
        data: {
          blockId,
          residentId: resident.id,
          vacationDates: cleanDates,
          academicDayPref: academicDayPref ?? null,
          callCapOverride: callCapOverride != null ? parseInt(callCapOverride, 10) : null,
        },
      });
    }

    await recordAuditEvent({
      programId,
      blockId: blockId ?? null,
      actorUserId: req.user?.userId,
      action: 'RESIDENT_CREATED',
      entityType: 'ResidentProfile',
      entityId: resident.id,
      summary: `Added ${resident.name} (${isMed ? 'medical student' : resident.residentRole})`,
      metadata: {
        residentId: resident.id,
        residentRole: resident.residentRole,
        pgyLevel: resident.pgyLevel,
        isMedStudent: isMed,
        isServiceResident: isService,
      },
    });

    res.status(201).json(resident);
  } catch (err) {
    console.error('[residents POST] error:', err.message);
    res.status(500).json({ error: 'Failed to create resident' });
  }
});

// ── POST /api/residents/:id/enroll ────────────────────────────────────────────
// Enroll a service resident in a specific block (creates BlockEnrollment if absent)

router.post('/:id/enroll', async (req, res) => {
  const { id } = req.params;
  const { blockId, vacationDates, academicDayPref, callCapOverride } = req.body;

  if (!blockId) return res.status(400).json({ error: 'blockId required' });

  try {
    const membership = await requireBlockPermission(req, res, blockId, 'manage_residents');
    if (!membership) return;
    const ownership = await assertResidentBelongsToBlockProgram(res, id, blockId);
    if (!ownership) return;
    const cleanDates = sanitizeVacationDates(vacationDates ?? []);
    const enrollment = await prisma.blockEnrollment.upsert({
      where: { blockId_residentId: { blockId, residentId: id } },
      update: {},
      create: {
        blockId,
        residentId: id,
        vacationDates: cleanDates,
        academicDayPref: academicDayPref ?? null,
        callCapOverride: callCapOverride != null ? parseInt(callCapOverride, 10) : null,
      },
    });
    await recordAuditEvent({
      programId: ownership.blockAccess.programId,
      blockId,
      actorUserId: req.user?.userId,
      action: 'BLOCK_AVAILABILITY_CHANGED',
      entityType: 'BlockEnrollment',
      entityId: enrollment.id,
      summary: 'Marked a resident active for this block',
      metadata: { residentId: id, vacationDateCount: cleanDates.length, callCapOverride: enrollment.callCapOverride },
    });
    res.status(201).json(enrollment);
  } catch (err) {
    console.error('[residents/:id/enroll POST] error:', err.message);
    res.status(500).json({ error: 'Failed to enroll resident' });
  }
});

// ── DELETE /api/residents/:id/enroll/:blockId ─────────────────────────────────
// Unenroll a service resident from a specific block

router.delete('/:id/enroll/:blockId', async (req, res) => {
  const { id, blockId } = req.params;
  try {
    const membership = await requireBlockPermission(req, res, blockId, 'manage_residents');
    if (!membership) return;
    const ownership = await assertResidentBelongsToBlockProgram(res, id, blockId);
    if (!ownership) return;
    await prisma.blockEnrollment.deleteMany({ where: { residentId: id, blockId } });
    await recordAuditEvent({
      programId: ownership.blockAccess.programId,
      blockId,
      actorUserId: req.user?.userId,
      action: 'BLOCK_AVAILABILITY_CHANGED',
      entityType: 'BlockEnrollment',
      entityId: null,
      summary: 'Removed a resident from this block',
      metadata: { residentId: id, removed: true },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[residents/:id/enroll/:blockId DELETE] error:', err.message);
    res.status(500).json({ error: 'Failed to unenroll resident' });
  }
});

// ── PUT /api/residents/:id ────────────────────────────────────────────────────

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    name, pgyLevel, residentRole, isMedStudent, isServiceResident, isActive,
    vacationDates, academicDayPref, callCapOverride,
    blockId, email,
  } = req.body;

  // Med students are always off-service
  const forcedServiceResident = isMedStudent ? false : isServiceResident;

  try {
    const existingResident = await prisma.residentProfile.findUnique({ where: { id }, select: { programId: true, name: true } });
    if (!existingResident) return res.status(404).json({ error: 'Resident not found' });
    const membership = blockId
      ? await requireBlockPermission(req, res, blockId, 'manage_residents')
      : await requireProgramPermission(req, res, existingResident.programId, 'manage_residents');
    if (!membership) return;
    if (blockId) {
      const ownership = await assertResidentBelongsToBlockProgram(res, id, blockId);
      if (!ownership) return;
    }
    const resident = await prisma.residentProfile.update({
      where: { id },
      data: {
        ...(name                    !== undefined && { name }),
        ...(pgyLevel                !== undefined && { pgyLevel: String(pgyLevel) }),
        ...(residentRole            !== undefined && { residentRole }),
        ...(isMedStudent            !== undefined && { isMedStudent }),
        ...(forcedServiceResident   !== undefined && { isServiceResident: forcedServiceResident }),
        ...(isActive                !== undefined && { isActive }),
        ...(email                   !== undefined && { email: email || null }),
      },
    });

    if (blockId) {
      const cleanDates = sanitizeVacationDates(vacationDates ?? []);
      const enrollment = await prisma.blockEnrollment.findUnique({
        where: { blockId_residentId: { blockId, residentId: id } },
      });
      if (enrollment) {
        await prisma.blockEnrollment.update({
          where: { id: enrollment.id },
          data: {
            vacationDates: cleanDates,
            academicDayPref: academicDayPref ?? null,
            callCapOverride: callCapOverride != null ? parseInt(callCapOverride, 10) : null,
          },
        });
      }
    }

    await recordAuditEvent({
      programId: resident.programId,
      blockId: blockId ?? null,
      actorUserId: req.user?.userId,
      action: 'RESIDENT_UPDATED',
      entityType: 'ResidentProfile',
      entityId: resident.id,
      summary: `Updated ${resident.name}`,
      metadata: {
        residentId: resident.id,
        // Field names only: the audit records what was touched, not a copy of
        // the request body.
        changedFields: Object.keys(req.body ?? {}).filter(key => !['programId', 'blockId'].includes(key)),
      },
    });

    res.json(resident);
  } catch (err) {
    console.error('[residents PUT] error:', err.message);
    res.status(500).json({ error: 'Failed to update resident' });
  }
});

// ── DELETE /api/residents/:id ─────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const existingResident = await prisma.residentProfile.findUnique({ where: { id }, select: { programId: true, name: true } });
  if (!existingResident) return res.status(404).json({ error: 'Resident not found' });
  const membership = await requireProgramPermission(req, res, existingResident.programId, 'manage_residents');
  if (!membership) return;
  await prisma.callAssignment.deleteMany({ where: { residentId: id } });
  await prisma.blockEnrollment.deleteMany({ where: { residentId: id } });
  await prisma.residentProfile.delete({ where: { id } });
  await recordAuditEvent({
    programId: existingResident.programId,
    actorUserId: req.user?.userId,
    action: 'RESIDENT_REMOVED',
    entityType: 'ResidentProfile',
    entityId: id,
    summary: `Removed ${existingResident.name} and all of their call assignments`,
    metadata: { residentId: id, removedAssignments: true },
  });
  res.json({ success: true });
});

module.exports = router;
