const express = require('express');
const crypto  = require('crypto');
const auth    = require('../middleware/auth');
const prisma  = require('../lib/prisma');
const { generateSchedule, clearSchedule } = require('../services/scheduler');
const { createScheduleWorkbook, shapeProtectedSchedule } = require('../services/excelExport');
const { createPrintableScheduleHtml, buildPrintableFilename } = require('../services/printableSchedule');
const { requireBlockPermission, requireBlockView } = require('../lib/roles');
const { hasPermission } = require('../lib/roles');
const { validateSchedule } = require('../services/scheduleValidator');
const { recordAuditEvent, recordAuditEventTx } = require('../services/auditLog');

const router = express.Router();
router.use(auth);

// POST /api/schedule/generate â€” clear + regenerate all assignments for a block
router.post('/generate', async (req, res) => {
  const { blockId } = req.body;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });
  try {
    const membership = await requireBlockPermission(req, res, blockId, 'generate_schedule');
    if (!membership) return;
    console.log(`[schedule/generate] blockId=${blockId} â€” pre-clearing existing data`);
    // Step 1: find all CallDay ids for this block
    const callDays = await prisma.callDay.findMany({ where: { blockId }, include: { assignments: true } });
    const callDayIds = callDays.map(d => d.id);
    // Step 2: delete generated assignments only; manual overrides seed the generator.
    if (callDayIds.length > 0) {
      await prisma.callAssignment.deleteMany({ where: { callDayId: { in: callDayIds }, isOverride: false } });
    }
    // Step 3: delete only empty CallDays, preserving days with manual overrides.
    const remainingOverrideDays = await prisma.callDay.findMany({
      where: { blockId, assignments: { some: {} } },
      select: { id: true },
    });
    const keepIds = new Set(remainingOverrideDays.map(d => d.id));
    const emptyCallDayIds = callDayIds.filter(id => !keepIds.has(id));
    if (emptyCallDayIds.length > 0) {
      await prisma.callDay.deleteMany({ where: { id: { in: emptyCallDayIds } } });
    }

    const summary = await generateSchedule(blockId);
    console.log(`[schedule/generate] done: assigned=${summary.assigned}/${summary.workDays} warnings=${summary.warnings.length}`);
    await recordAuditEvent({
      programId: membership.programId,
      blockId,
      actorUserId: req.user?.userId,
      action: 'SCHEDULE_GENERATED',
      entityType: 'Block',
      entityId: blockId,
      summary: `Auto-generated the schedule: ${summary.assigned} of ${summary.workDays} days covered`,
      metadata: {
        assigned: summary.assigned,
        workDays: summary.workDays,
        unassigned: summary.unassigned,
        warningCount: summary.warnings.length,
        availabilityComplete: summary.availabilityComplete,
        excludedResidentCount: summary.excludedResidents.length,
      },
    });
    res.json(summary);
  } catch (err) {
    console.error('[schedule/generate] Error:', err.message);
    res.status(500).json({ error: err.message ?? 'Failed to generate schedule' });
  }
});

// DELETE /api/schedule/clear â€” wipe all assignments + call days for a block
router.delete('/clear', async (req, res) => {
  const blockId = req.body?.blockId ?? req.query?.blockId;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });
  try {
    const membership = await requireBlockPermission(req, res, blockId, 'clear_schedule');
    if (!membership) return;
    // Step 1: find all CallDay ids for this block
    const callDays = await prisma.callDay.findMany({ where: { blockId } });
    const callDayIds = callDays.map(d => d.id);
    // Step 2: delete generated assignments only; preserve manual overrides.
    if (callDayIds.length > 0) {
      await prisma.callAssignment.deleteMany({ where: { callDayId: { in: callDayIds }, isOverride: false } });
    }
    // Step 3: delete only empty CallDays.
    const { count } = await prisma.callDay.deleteMany({
      where: { blockId, assignments: { none: {} } },
    });
    await recordAuditEvent({
      programId: membership.programId,
      blockId,
      actorUserId: req.user?.userId,
      action: 'SCHEDULE_CLEARED',
      entityType: 'Block',
      entityId: blockId,
      summary: `Cleared the generated schedule: ${count} empty call day${count === 1 ? '' : 's'} removed`,
      metadata: { clearedCallDays: count, manualOverridesPreserved: true },
    });
    res.json({ cleared: count });
  } catch (err) {
    console.error('[schedule/clear] Error:', err.message);
    res.status(500).json({ error: 'Failed to clear schedule' });
  }
});

// GET /api/schedule/validate?blockId= - validate the stored draft without mutation.
router.get('/validate', async (req, res) => {
  const { blockId } = req.query;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });
  try {
    const membership = await requireBlockPermission(req, res, blockId, 'view_draft_schedule');
    if (!membership) return;
    const result = await validateSchedule(blockId);
    if (!result) return res.status(404).json({ error: 'Block not found' });
    res.json(result);
  } catch (err) {
    console.error('[schedule/validate] Error:', err.message);
    res.status(500).json({ error: 'Failed to validate schedule' });
  }
});

// POST /api/schedule/publish â€” snapshot current schedule and mark block as published
router.post('/publish', async (req, res) => {
  const { blockId, acknowledgeViolations = false } = req.body;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });
  try {
    const membership = await requireBlockPermission(req, res, blockId, 'publish_schedule');
    if (!membership) return;

    // Never publish a schedule whose compliance nobody has looked at. Violations
    // that are already documented manual overrides are intentional exceptions
    // and do not block; anything else needs an explicit acknowledgement from
    // someone authorised to publish.
    const preflight = await validateSchedule(blockId);
    if (!preflight) return res.status(404).json({ error: 'Block not found' });
    const undocumented = preflight.violations.filter(item => !item.isOverride);
    if (undocumented.length > 0 && !acknowledgeViolations) {
      return res.status(409).json({
        requiresViolationAcknowledgement: true,
        error: 'This schedule breaks scheduling rules that are not documented exceptions.',
        violations: undocumented,
        documentedOverrides: preflight.violations.filter(item => item.isOverride),
      });
    }

    // Fetch all current schedule data for the block
    const block = await prisma.block.findUnique({
      where: { id: blockId },
      include: {
        academicYear: { include: { program: { select: { id: true, name: true, specialty: true } }, holidays: true } },
        attendingEntries: true,
        callDays: {
          orderBy: { date: 'asc' },
          include: {
            assignments: {
              include: { resident: { select: { id: true, name: true, residentRole: true } } },
            },
          },
        },
      },
    });
    if (!block) return res.status(404).json({ error: 'Block not found' });

    // Build the snapshot JSON
    const snapshot = {
      block: {
        id: block.id,
        number: block.number,
        startDate: block.startDate,
        endDate: block.endDate,
        programName: block.academicYear?.program?.name ?? '',
        specialty: block.academicYear?.program?.specialty ?? '',
        holidays: block.academicYear?.holidays ?? [],
      },
      attendingEntries: block.attendingEntries,
      callDays: block.callDays,
    };

    // Ensure publicToken exists, reuse if already set
    const publicToken = block.publicToken || crypto.randomUUID();

    // Update block + create version in a transaction
    const { updatedBlock, version } = await prisma.$transaction(async tx => {
      const block2 = await tx.block.update({
        where: { id: blockId },
        data: { isPublished: true, publicToken },
      });
      const version2 = await tx.scheduleVersion.create({
        data: {
          blockId,
          snapshotJson: snapshot,
          publishedBy: req.user?.userId ?? null,
        },
      });
      await recordAuditEventTx(tx, {
        programId: membership.programId,
        blockId,
        actorUserId: req.user?.userId,
        action: 'SCHEDULE_PUBLISHED',
        entityType: 'ScheduleVersion',
        entityId: version2.id,
        summary: undocumented.length > 0
          ? `Published the schedule with ${undocumented.length} acknowledged rule violation${undocumented.length === 1 ? '' : 's'}`
          : 'Published the schedule',
        metadata: {
          versionId: version2.id,
          acknowledgedViolations: undocumented.map(item => ({ code: item.code, date: item.date })),
          documentedOverrides: preflight.violations.filter(item => item.isOverride).length,
          linkReused: Boolean(block.publicToken),
        },
      });
      return { updatedBlock: block2, version: version2 };
    });

    res.json({
      success: true,
      blockId,
      publishedAt: version.publishedAt.toISOString(),
      publicToken: updatedBlock.publicToken,
      versionId: version.id,
      publishedWithViolations: undocumented.length,
      documentedOverrides: preflight.violations.filter(item => item.isOverride).length,
    });
  } catch (err) {
    console.error('[schedule/publish] Error:', err.message);
    res.status(500).json({ error: 'Failed to publish schedule' });
  }
});

// POST /api/schedule/unpublish - retract a published schedule.
//
// The public URL stops resolving immediately because every public route checks
// isPublished. Immutable ScheduleVersion history is left intact, and the draft
// schedule is not touched at all.
router.post('/unpublish', async (req, res) => {
  const { blockId } = req.body;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });
  try {
    const membership = await requireBlockPermission(req, res, blockId, 'publish_schedule');
    if (!membership) return;

    const block = await prisma.block.findUnique({
      where: { id: blockId },
      select: { id: true, isPublished: true, number: true },
    });
    if (!block) return res.status(404).json({ error: 'Block not found' });
    if (!block.isPublished) return res.status(409).json({ error: 'This schedule is not published' });

    const versionCount = await prisma.scheduleVersion.count({ where: { blockId } });

    await prisma.$transaction(async tx => {
      await tx.block.update({ where: { id: blockId }, data: { isPublished: false } });
      await recordAuditEventTx(tx, {
        programId: membership.programId,
        blockId,
        actorUserId: req.user?.userId,
        action: 'SCHEDULE_UNPUBLISHED',
        entityType: 'Block',
        entityId: blockId,
        summary: 'Unpublished the schedule; the public link no longer resolves',
        metadata: { retainedVersions: versionCount, draftUnchanged: true },
      });
    });

    res.json({ success: true, blockId, isPublished: false, retainedVersions: versionCount });
  } catch (err) {
    console.error('[schedule/unpublish] Error:', err.message);
    res.status(500).json({ error: 'Failed to unpublish schedule' });
  }
});

// POST /api/schedule/rotate-link - mint a new public token.
//
// The old token stops working the moment it is replaced. The latest published
// version remains available under the new link.
router.post('/rotate-link', async (req, res) => {
  const { blockId } = req.body;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });
  try {
    const membership = await requireBlockPermission(req, res, blockId, 'publish_schedule');
    if (!membership) return;

    const block = await prisma.block.findUnique({
      where: { id: blockId },
      select: { id: true, publicToken: true, isPublished: true },
    });
    if (!block) return res.status(404).json({ error: 'Block not found' });
    if (!block.publicToken) return res.status(409).json({ error: 'This schedule has never been published' });

    // 256 bits of randomness, URL-safe. Deliberately not derived from anything
    // guessable about the block.
    const nextToken = crypto.randomBytes(32).toString('base64url');

    const updated = await prisma.$transaction(async tx => {
      const next = await tx.block.update({
        where: { id: blockId },
        data: { publicToken: nextToken },
      });
      await recordAuditEventTx(tx, {
        programId: membership.programId,
        blockId,
        actorUserId: req.user?.userId,
        action: 'PUBLIC_LINK_ROTATED',
        entityType: 'Block',
        entityId: blockId,
        // The tokens themselves are credentials and are never audited.
        summary: 'Generated a new public link; the previous link no longer works',
        metadata: { stillPublished: block.isPublished },
      });
      return next;
    });

    res.json({ success: true, blockId, publicToken: updated.publicToken, isPublished: updated.isPublished });
  } catch (err) {
    console.error('[schedule/rotate-link] Error:', err.message);
    res.status(500).json({ error: 'Failed to rotate the public link' });
  }
});

// GET /api/schedule/diagnostics?blockId= â€” non-destructive duplicate logical-day report
router.get('/diagnostics', async (req, res) => {
  const { blockId } = req.query;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });

  try {
    const membership = await requireBlockPermission(req, res, blockId, 'view_draft_schedule');
    if (!membership) return;
    const [callDays, attendingEntries] = await Promise.all([
      prisma.callDay.findMany({
        where: { blockId },
        select: { id: true, date: true, assignments: { select: { id: true } } },
        orderBy: { date: 'asc' },
      }),
      prisma.attendingEntry.findMany({
        where: { blockId },
        select: { id: true, date: true, attendingName: true, activityLabel: true, isCallDay: true },
        orderBy: { date: 'asc' },
      }),
    ]);

    const dateKey = value => new Date(value).toISOString().slice(0, 10);
    const duplicateGroups = (items, keyFor) => {
      const groups = new Map();
      for (const item of items) {
        const key = keyFor(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      }
      return [...groups.entries()]
        .filter(([, rows]) => rows.length > 1)
        .map(([key, rows]) => ({ key, count: rows.length, rows }));
    };

    const duplicateCallDays = duplicateGroups(callDays, d => dateKey(d.date));
    const duplicateAttendingEntries = duplicateGroups(
      attendingEntries,
      e => `${dateKey(e.date)}|${e.attendingName}|${e.activityLabel}`
    );

    res.json({
      blockId,
      callDayCount: callDays.length,
      attendingEntryCount: attendingEntries.length,
      duplicateCallDays,
      duplicateAttendingEntries,
    });
  } catch (err) {
    console.error('[schedule/diagnostics] Error:', err.message);
    res.status(500).json({ error: 'Failed to build diagnostics' });
  }
});

// GET /api/schedule/export/excel?blockId=
router.get('/export/excel', async (req, res) => {
  const { blockId } = req.query;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });

  try {
    const membership = await requireBlockPermission(req, res, blockId, 'export_draft_schedule');
    if (!membership) return;
    const block = await prisma.block.findUnique({
      where: { id: blockId },
      include: {
        academicYear: { include: { program: true, holidays: true } },
        attendingEntries: true,
        callDays: { include: { assignments: { include: { resident: { select: { name: true } } } } } },
        flags: true,
      },
    });
    if (!block) return res.status(404).json({ error: 'Block not found' });

    const { workbook, filename } = createScheduleWorkbook(shapeProtectedSchedule(block), { includeNotes: true });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[schedule/export/excel] Error:', err.message);
    res.status(500).json({ error: 'Failed to export Excel' });
  }
});

// GET /api/schedule/export/pdf?blockId= - printable HTML (browser saves as PDF)
router.get('/export/pdf', async (req, res) => {
  const { blockId } = req.query;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });

  try {
    const membership = await requireBlockPermission(req, res, blockId, 'export_draft_schedule');
    if (!membership) return;
    const block = await prisma.block.findUnique({
      where: { id: blockId },
      include: {
        academicYear: { include: { program: true, holidays: true } },
        attendingEntries: true,
        callDays: { include: { assignments: { include: { resident: { select: { name: true } } } } } },
        flags: true,
      },
    });
    if (!block) return res.status(404).json({ error: 'Block not found' });

    const schedule = shapeProtectedSchedule(block);
    const html = createPrintableScheduleHtml(schedule, { includeNotes: true });
    const filename = buildPrintableFilename(schedule);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(html);
  } catch (err) {
    console.error('[schedule/export/pdf] Error:', err.message);
    res.status(500).json({ error: 'Failed to generate printable schedule' });
  }
});
// GET /api/schedule/history?blockId= â€” all published versions for a block
router.get('/history', async (req, res) => {
  const { blockId } = req.query;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });
  try {
    const membership = await requireBlockView(req, res, blockId);
    if (!membership) return;
    const canViewDraft = hasPermission(membership.role, 'view_draft_schedule');
    const versions = await prisma.scheduleVersion.findMany({
      where: { blockId },
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true,
        publishedAt: true,
        publishedBy: true,
        snapshotJson: true,
      },
    });

    // Enrich with publishedBy user name and assigned day count
    const enriched = await Promise.all(versions.map(async (v) => {
      let publisherName = null;
      if (v.publishedBy) {
        const user = await prisma.user.findUnique({ where: { id: v.publishedBy }, select: { name: true } });
        publisherName = user?.name ?? null;
      }
      const snapshot = v.snapshotJson;
      const assignedDays = (snapshot?.callDays ?? []).filter(
        cd => cd.assignments && cd.assignments.length > 0
      ).length;
      return {
        id: v.id,
        publishedAt: v.publishedAt,
        publishedBy: canViewDraft ? publisherName : null,
        assignedDays,
        ...(canViewDraft ? { snapshotJson: snapshot } : {}),
      };
    }));

    res.json(enriched);
  } catch (err) {
    console.error('[schedule/history] Error:', err.message);
    res.status(500).json({ error: 'Failed to load schedule history' });
  }
});

module.exports = router;
