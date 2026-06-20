const express = require('express');
const prisma  = require('../lib/prisma');
const { shapePublicSchedule } = require('../services/publicScheduleShape');
const { createScheduleWorkbook } = require('../services/excelExport');

const router = express.Router();
// No auth middleware — fully public

// GET /api/public/:token/export/excel - public Excel export (from safe snapshot shape)
router.get('/:token/export/excel', async (req, res) => {
  const { token } = req.params;
  try {
    const block = await prisma.block.findUnique({
      where: { publicToken: token },
      select: { id: true, isPublished: true },
    });
    if (!block || !block.isPublished) return res.status(404).json({ error: 'Not found' });

    const latestVersion = await prisma.scheduleVersion.findFirst({
      where: { blockId: block.id },
      orderBy: { publishedAt: 'desc' },
      select: { snapshotJson: true, publishedAt: true },
    });
    if (!latestVersion) return res.status(404).json({ error: 'No published version' });

    const flags = await prisma.dayFlag.findMany({
      where: { blockId: block.id },
      select: { date: true, label: true, color: true },
      orderBy: { date: 'asc' },
    });
    const publicSchedule = shapePublicSchedule({
      snapshot: latestVersion.snapshotJson,
      publishedAt: latestVersion.publishedAt,
      flags,
    });
    const { workbook, filename } = createScheduleWorkbook(publicSchedule, { includeNotes: false });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[public/export/excel] Error:', err.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

// GET /api/public/:token — return the LATEST published snapshot (frozen data)
router.get('/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const block = await prisma.block.findUnique({
      where: { publicToken: token },
      select: { id: true, isPublished: true },
    });

    if (!block || !block.isPublished) {
      return res.status(404).json({ error: 'Schedule not found or not published' });
    }

    // Find the LATEST ScheduleVersion for this block
    const latestVersion = await prisma.scheduleVersion.findFirst({
      where: { blockId: block.id },
      orderBy: { publishedAt: 'desc' },
      select: { snapshotJson: true, publishedAt: true },
    });

    if (!latestVersion) {
      return res.status(404).json({ error: 'No published version found' });
    }

    // Return the frozen snapshot — NOT live data
    // Flags are fetched live (they're editorial annotations, not part of the snapshot)
    const flags = await prisma.dayFlag.findMany({
      where: { blockId: block.id },
      select: { date: true, label: true, color: true },
      orderBy: { date: 'asc' },
    });
    res.json(shapePublicSchedule({
      snapshot: latestVersion.snapshotJson,
      publishedAt: latestVersion.publishedAt,
      flags,
    }));
  } catch (err) {
    console.error('[public/:token] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
