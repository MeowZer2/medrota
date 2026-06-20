const express = require('express');
const crypto  = require('crypto');
const auth    = require('../middleware/auth');
const prisma  = require('../lib/prisma');
const { generateSchedule, clearSchedule } = require('../services/scheduler');
const { createScheduleWorkbook, shapeProtectedSchedule } = require('../services/excelExport');
const { createPrintableScheduleHtml, buildPrintableFilename } = require('../services/printableSchedule');

const router = express.Router();
router.use(auth);

// POST /api/schedule/generate — clear + regenerate all assignments for a block
router.post('/generate', async (req, res) => {
  const { blockId } = req.body;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });
  try {
    console.log(`[schedule/generate] blockId=${blockId} — pre-clearing existing data`);
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
    res.json(summary);
  } catch (err) {
    console.error('[schedule/generate] Error:', err.message);
    res.status(500).json({ error: err.message ?? 'Failed to generate schedule' });
  }
});

// DELETE /api/schedule/clear — wipe all assignments + call days for a block
router.delete('/clear', async (req, res) => {
  const blockId = req.body?.blockId ?? req.query?.blockId;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });
  try {
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
    res.json({ cleared: count });
  } catch (err) {
    console.error('[schedule/clear] Error:', err.message);
    res.status(500).json({ error: 'Failed to clear schedule' });
  }
});

// POST /api/schedule/publish — snapshot current schedule and mark block as published
router.post('/publish', async (req, res) => {
  const { blockId } = req.body;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });
  try {
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
    const [updatedBlock, version] = await prisma.$transaction([
      prisma.block.update({
        where: { id: blockId },
        data: { isPublished: true, publicToken },
      }),
      prisma.scheduleVersion.create({
        data: {
          blockId,
          snapshotJson: snapshot,
          publishedBy: req.user?.userId ?? null,
        },
      }),
    ]);

    res.json({
      success: true,
      blockId,
      publishedAt: version.publishedAt.toISOString(),
      publicToken: updatedBlock.publicToken,
      versionId: version.id,
    });
  } catch (err) {
    console.error('[schedule/publish] Error:', err.message);
    res.status(500).json({ error: 'Failed to publish schedule' });
  }
});

// GET /api/schedule/diagnostics?blockId= — non-destructive duplicate logical-day report
router.get('/diagnostics', async (req, res) => {
  const { blockId } = req.query;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });

  try {
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
// GET /api/schedule/history?blockId= — all published versions for a block
router.get('/history', async (req, res) => {
  const { blockId } = req.query;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });
  try {
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
        publishedBy: publisherName,
        assignedDays,
        snapshotJson: snapshot,
      };
    }));

    res.json(enriched);
  } catch (err) {
    console.error('[schedule/history] Error:', err.message);
    res.status(500).json({ error: 'Failed to load schedule history' });
  }
});

module.exports = router;
