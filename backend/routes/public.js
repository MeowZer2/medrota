const express = require('express');
const prisma  = require('../lib/prisma');
const ExcelJS = require('exceljs');
const { shapePublicSchedule } = require('../services/publicScheduleShape');

const router = express.Router();
// No auth middleware — fully public

// GET /api/public/:token/export/excel — public Excel export (from snapshot)
router.get('/:token/export/excel', async (req, res) => {
  const { token } = req.params;
  try {
    const block = await prisma.block.findUnique({
      where: { publicToken: token },
      select: { id: true, isPublished: true },
    });
    if (!block || !block.isPublished) return res.status(404).json({ error: 'Not found' });

    // Use the latest snapshot
    const latestVersion = await prisma.scheduleVersion.findFirst({
      where: { blockId: block.id },
      orderBy: { publishedAt: 'desc' },
      select: { snapshotJson: true, publishedAt: true },
    });
    if (!latestVersion) return res.status(404).json({ error: 'No published version' });

    const publicSchedule = shapePublicSchedule({
      snapshot: latestVersion.snapshotJson,
      publishedAt: latestVersion.publishedAt,
    });
    const blockData   = publicSchedule.block;
    const programName = blockData.programName ?? 'Program';

    const holidayMap = {};
    for (const h of blockData.holidays ?? []) { holidayMap[new Date(h.date).toISOString().slice(0, 10)] = h.name; }
    const attendingMap = {};
    for (const e of publicSchedule.attendingEntries ?? []) {
      const iso = new Date(e.date).toISOString().slice(0, 10);
      if (!attendingMap[iso]) attendingMap[iso] = [];
      attendingMap[iso].push(e);
    }
    const assignMap = {};
    for (const cd of publicSchedule.callDays ?? []) {
      const iso = new Date(cd.date).toISOString().slice(0, 10);
      assignMap[iso] = cd.assignments ?? [];
    }

    const start   = new Date(blockData.startDate);
    const end     = new Date(blockData.endDate);
    const allDays = [];
    const cursor  = new Date(start);
    while (cursor <= end) { allDays.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 1); }

    // Pad into calendar weeks (Mon-Sun)
    const padBefore = (allDays[0].getDay() + 6) % 7;
    const padded    = [...Array(padBefore).fill(null), ...allDays];
    while (padded.length % 7 !== 0) padded.push(null);
    const weeks = [];
    for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

    const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const fmtDate   = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'MedRota';
    const ws = wb.addWorksheet(`Block ${blockData.number} Schedule`);

    ws.columns = [
      { key: 'week', width: 10 },
      { key: 'sun', width: 18 }, { key: 'mon', width: 18 }, { key: 'tue', width: 18 },
      { key: 'wed', width: 18 }, { key: 'thu', width: 18 }, { key: 'fri', width: 18 },
      { key: 'sat', width: 18 },
    ];

    const NAVY = 'FF1A3A5C', WHITE = 'FFFFFFFF';
    const PURPLE_BG = 'FFF3F0FF', PURPLE_FG = 'FF6D28D9';
    const BLUE_BG = 'FFEFF6FF', BLUE_FG = 'FF1D4ED8';
    const GREEN_BG = 'FFF0FDF4', GREEN_FG = 'FF15803D';
    const AMBER_BG = 'FFFFFBEB', AMBER_FG = 'FFB45309';
    const RED_BG = 'FFFEE2E2', WKEND_BG = 'FFF1F5F9', UNASGN_BG = 'FFFFFBEB';
    const BORDER = { style: 'thin', color: { argb: 'FFD6E4F7' } };
    const allBorders = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
    const SUB_COLORS = [
      { bg: PURPLE_BG, fg: PURPLE_FG }, { bg: BLUE_BG, fg: BLUE_FG },
      { bg: GREEN_BG, fg: GREEN_FG }, { bg: AMBER_BG, fg: AMBER_FG },
    ];

    function applyCell(cell, value, opts = {}) {
      cell.value = value;
      cell.font = { size: opts.size ?? 10, bold: !!opts.bold, color: { argb: opts.fg ?? NAVY } };
      if (opts.bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.bg } };
      cell.alignment = { horizontal: opts.align ?? 'center', vertical: 'middle', wrapText: true };
      cell.border = allBorders;
    }

    // Row 1: title
    ws.mergeCells('A1:H1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `MedRota — ${programName} — Block ${blockData.number} — ${fmtDate(start)} to ${fmtDate(end)}`;
    titleCell.font = { bold: true, size: 14, color: { argb: WHITE } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 30;
    ws.getRow(2).height = 6;

    // Row 3: headers
    ['Week', ...DAY_NAMES].forEach((label, i) => {
      const cell = ws.getRow(3).getCell(i + 1);
      cell.value = label;
      cell.font = { bold: true, size: 11, color: { argb: WHITE } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = allBorders;
    });
    ws.getRow(3).height = 22;

    let currentRow = 4;
    weeks.forEach((week, wi) => {
      const weekStartRow = currentRow;
      for (let si = 0; si < 4; si++) {
        const row = ws.getRow(currentRow);
        row.height = 20;
        if (si === 0) applyCell(row.getCell(1), `Week ${wi + 1}`, { bold: true, size: 11, bg: 'FFF8FAFC' });

        for (let di = 0; di < 7; di++) {
          const day = week[di];
          const cell = row.getCell(di + 2);
          if (!day) { applyCell(cell, '', { bg: 'FFF8FAFC' }); continue; }

          const iso = day.toISOString().slice(0, 10);
          const isHol = !!holidayMap[iso];
          const isWkend = di === 0 || di === 6;
          const atts = attendingMap[iso] ?? [];
          const asgns = assignMap[iso] ?? [];
          const seniors = asgns.filter(a => a.roleOnDay === 'senior').map(a => a.resident?.name ?? a.resident).join(', ');
          const juniors = asgns.filter(a => a.roleOnDay === 'junior').map(a => a.resident?.name ?? a.resident).join(', ');

          let value = '', bg = isHol ? RED_BG : isWkend ? WKEND_BG : SUB_COLORS[si].bg, fg = SUB_COLORS[si].fg;
          if (si === 0) {
            const activities = atts.map(a => a.activityLabel).filter(Boolean).join(', ');
            value = `${day.getDate()} ${DAY_NAMES[di]}` + (activities ? ` · ${activities}` : '');
            if (isHol) { value = `${day.getDate()} ${holidayMap[iso]}`; fg = 'FFDC2626'; }
          } else if (si === 1) { value = atts.map(a => a.attendingName).filter(Boolean).join(', '); }
          else if (si === 2) { value = seniors; }
          else { value = juniors; }
          if (!value && si >= 2) { value = 'Unassigned'; bg = UNASGN_BG; fg = 'FFCBD5E1'; }
          applyCell(cell, value, { bg, fg, size: si === 0 ? 10 : 9, bold: si === 0 });
        }
        currentRow++;
      }
      ws.mergeCells(weekStartRow, 1, weekStartRow + 3, 1);
    });

    ws.views = [{ state: 'frozen', ySplit: 3 }];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="block-schedule.xlsx"');
    await wb.xlsx.write(res);
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
