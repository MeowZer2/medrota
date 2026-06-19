const express = require('express');
const crypto  = require('crypto');
const auth    = require('../middleware/auth');
const prisma  = require('../lib/prisma');
const ExcelJS = require('exceljs');
const { generateSchedule, clearSchedule } = require('../services/scheduler');

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
        callDays: { include: { assignments: { include: { resident: true } } } },
      },
    });
    if (!block) return res.status(404).json({ error: 'Block not found' });

    const programName = block.academicYear?.program?.name ?? 'Program';
    const holidays    = block.academicYear?.holidays ?? [];

    // Build quick lookup maps
    const holidayMap = {};
    for (const h of holidays) { holidayMap[new Date(h.date).toISOString().slice(0, 10)] = h.name; }
    const attendingMap = {};
    for (const e of block.attendingEntries) {
      const iso = new Date(e.date).toISOString().slice(0, 10);
      if (!attendingMap[iso]) attendingMap[iso] = [];
      attendingMap[iso].push(e);
    }
    const assignMap = {};
    for (const cd of block.callDays) {
      const iso = new Date(cd.date).toISOString().slice(0, 10);
      assignMap[iso] = cd.assignments;
    }

    // Generate all days in block
    const start   = new Date(block.startDate);
    const end     = new Date(block.endDate);
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
    const ws = wb.addWorksheet(`Block ${block.number} Schedule`);

    // Column widths: Week label + 7 days
    ws.columns = [
      { key: 'week', width: 10 },
      { key: 'sun', width: 18 }, { key: 'mon', width: 18 }, { key: 'tue', width: 18 },
      { key: 'wed', width: 18 }, { key: 'thu', width: 18 }, { key: 'fri', width: 18 },
      { key: 'sat', width: 18 },
    ];

    // Colors
    const NAVY      = 'FF1A3A5C';
    const WHITE     = 'FFFFFFFF';
    const PURPLE_BG = 'FFF3F0FF'; const PURPLE_FG = 'FF6D28D9';
    const BLUE_BG   = 'FFEFF6FF'; const BLUE_FG   = 'FF1D4ED8';
    const GREEN_BG  = 'FFF0FDF4'; const GREEN_FG  = 'FF15803D';
    const AMBER_BG  = 'FFFFFBEB'; const AMBER_FG  = 'FFB45309';
    const RED_BG    = 'FFFEE2E2';
    const WKEND_BG  = 'FFF1F5F9';
    const UNASGN_BG = 'FFFFFBEB';
    const BORDER    = { style: 'thin', color: { argb: 'FFD6E4F7' } };
    const allBorders = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

    function applyCell(cell, value, opts = {}) {
      cell.value = value;
      cell.font = { size: opts.size ?? 10, bold: !!opts.bold, color: { argb: opts.fg ?? NAVY } };
      if (opts.bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.bg } };
      cell.alignment = { horizontal: opts.align ?? 'center', vertical: 'middle', wrapText: true };
      cell.border = allBorders;
    }

    // ── Row 1: Merged title header ──
    ws.mergeCells('A1:H1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `MedRota — ${programName} — Block ${block.number} — ${fmtDate(start)} to ${fmtDate(end)}`;
    titleCell.font  = { bold: true, size: 14, color: { argb: WHITE } };
    titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 30;

    // ── Row 2: spacer ──
    ws.getRow(2).height = 6;

    // ── Row 3: Day headers ──
    const headerLabels = ['Week', ...DAY_NAMES];
    const headerRow = ws.getRow(3);
    headerLabels.forEach((label, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = label;
      cell.font  = { bold: true, size: 11, color: { argb: WHITE } };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = allBorders;
    });
    headerRow.height = 22;

    // ── Week rows ──
    const SUB_LABELS = ['Activity', 'Attending', 'Senior', 'Junior'];
    const SUB_COLORS = [
      { bg: PURPLE_BG, fg: PURPLE_FG },
      { bg: BLUE_BG,   fg: BLUE_FG },
      { bg: GREEN_BG,  fg: GREEN_FG },
      { bg: AMBER_BG,  fg: AMBER_FG },
    ];

    let currentRow = 4;

    weeks.forEach((week, wi) => {
      const weekStartRow = currentRow;

      for (let si = 0; si < 4; si++) {
        const row = ws.getRow(currentRow);
        row.height = 20;

        // Week label (merged vertically for 4 sub-rows)
        if (si === 0) {
          applyCell(row.getCell(1), `Week ${wi + 1}`, { bold: true, size: 11, bg: 'FFF8FAFC' });
        }

        // Day columns
        for (let di = 0; di < 7; di++) {
          const day  = week[di];
          const cell = row.getCell(di + 2);
          const dow  = di; // 0=Sun, 6=Sat
          const isWkend = dow === 0 || dow === 6;

          if (!day) {
            applyCell(cell, '', { bg: 'FFF8FAFC' });
            continue;
          }

          const iso   = day.toISOString().slice(0, 10);
          const isHol = !!holidayMap[iso];
          const atts  = attendingMap[iso] ?? [];
          const asgns = assignMap[iso] ?? [];
          const seniors = asgns.filter(a => a.roleOnDay === 'senior').map(a => a.resident.name).join(', ');
          const juniors = asgns.filter(a => a.roleOnDay === 'junior').map(a => a.resident.name).join(', ');

          let value = '';
          let bg = isHol ? RED_BG : isWkend ? WKEND_BG : SUB_COLORS[si].bg;
          let fg = SUB_COLORS[si].fg;

          if (si === 0) {
            // Date + Activity row
            const activities = atts.map(a => a.activityLabel).filter(Boolean).join(', ');
            value = `${day.getDate()} ${DAY_NAMES[dow]}` + (activities ? ` · ${activities}` : '');
            if (isHol) { value = `${day.getDate()} ${holidayMap[iso]}`; fg = 'FFDC2626'; }
          } else if (si === 1) {
            value = atts.map(a => a.attendingName).filter(Boolean).join(', ') || '';
          } else if (si === 2) {
            value = seniors || '';
          } else {
            value = juniors || '';
          }

          if (!value && si >= 2) { value = 'Unassigned'; bg = UNASGN_BG; fg = 'FFCBD5E1'; }

          applyCell(cell, value, { bg, fg, size: si === 0 ? 10 : 9, bold: si === 0 });
        }
        currentRow++;
      }

      // Merge the Week label cells vertically
      ws.mergeCells(weekStartRow, 1, weekStartRow + 3, 1);
    });

    // Freeze header rows
    ws.views = [{ state: 'frozen', ySplit: 3 }];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="block-schedule.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[schedule/export/excel] Error:', err.message);
    res.status(500).json({ error: 'Failed to export Excel' });
  }
});

// GET /api/schedule/export/pdf?blockId= — returns printable HTML (browser prints it)
router.get('/export/pdf', async (req, res) => {
  const { blockId } = req.query;
  if (!blockId) return res.status(400).json({ error: 'blockId required' });

  try {
    const block = await prisma.block.findUnique({
      where: { id: blockId },
      include: {
        academicYear: { include: { program: true, holidays: true } },
        attendingEntries: true,
        callDays: { include: { assignments: { include: { resident: true } } } },
      },
    });
    if (!block) return res.status(404).json({ error: 'Block not found' });

    const programName = block.academicYear?.program?.name ?? 'Program';
    const holidays    = block.academicYear?.holidays ?? [];
    const holidayMap  = {};
    for (const h of holidays) { holidayMap[new Date(h.date).toISOString().slice(0, 10)] = h.name; }

    const attendingMap = {};
    for (const e of block.attendingEntries) {
      const iso = new Date(e.date).toISOString().slice(0, 10);
      if (!attendingMap[iso]) attendingMap[iso] = [];
      attendingMap[iso].push(e);
    }
    const assignMap = {};
    for (const cd of block.callDays) {
      const iso = new Date(cd.date).toISOString().slice(0, 10);
      assignMap[iso] = cd.assignments;
    }

    const start  = new Date(block.startDate);
    const end    = new Date(block.endDate);
    const allDays = [];
    const cursor  = new Date(start);
    while (cursor <= end) { allDays.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 1); }

    const fmtDate = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    // Build grid with padding (Mon-Sun)
    const padBefore = (allDays[0].getDay() + 6) % 7;
    const padded = [...Array(padBefore).fill(null), ...allDays];
    while (padded.length % 7 !== 0) padded.push(null);
    const weeks = [];
    for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

    function chip(text, color, bg) {
      return `<span style="display:inline-block;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:600;background:${bg};color:${color};white-space:nowrap;">${text}</span>`;
    }

    function cellHtml(day) {
      if (!day) return '<td style="background:#F8FAFC;border:1px solid #F1F5F9;"></td>';
      const iso     = day.toISOString().slice(0, 10);
      const dow     = day.getDay();
      const isWkend = dow === 0 || dow === 6;
      const isHol   = !!holidayMap[iso];
      const atts    = attendingMap[iso] ?? [];
      const asgns   = assignMap[iso] ?? [];
      const seniors = asgns.filter(a => a.roleOnDay === 'senior').map(a => a.resident.name);
      const juniors = asgns.filter(a => a.roleOnDay === 'junior').map(a => a.resident.name);
      const bg      = isHol ? '#FFF5F5' : isWkend ? '#F8FAFC' : '#fff';
      const numColor = isHol ? '#DC2626' : isWkend ? '#94A3B8' : '#1A3A5C';
      let chips = '';
      for (const a of atts) {
        if (a.activityLabel) chips += chip(a.activityLabel, '#6D28D9', '#F3F0FF') + ' ';
        if (a.attendingName) chips += chip(a.attendingName, '#1D4ED8', '#EFF6FF') + ' ';
        if (a.isCallDay) chips += chip('Call', '#1A3A5C', '#EEF4FF') + ' ';
      }
      for (const n of seniors) chips += chip(`S: ${n}`, '#15803D', '#F0FDF4') + ' ';
      for (const n of juniors) chips += chip(`J: ${n}`, '#B45309', '#FFFBEB') + ' ';
      return `<td style="border:1px solid #E8EFF6;background:${bg};vertical-align:top;padding:4px;min-width:80px;min-height:70px;">
        <div style="font-size:11px;font-weight:700;color:${numColor};margin-bottom:2px;">${day.getDate()}${isHol ? ' <span style="font-size:8px;color:#DC2626;font-weight:600;">HOL</span>' : ''}</div>
        <div style="display:flex;flex-wrap:wrap;gap:2px;">${chips || '<span style="font-size:8px;color:#CBD5E1;font-style:italic;">Unassigned</span>'}</div>
      </td>`;
    }

    const tableRows = weeks.map(week =>
      `<tr>${week.map(cellHtml).join('')}</tr>`
    ).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Block ${block.number} Schedule</title>
<style>
  @media print { body { margin: 0; } }
  body { font-family: Inter, sans-serif; color: #1A3A5C; padding: 16px; }
  h1 { font-size: 16px; font-weight: 700; margin: 0 0 2px; }
  p { font-size: 11px; color: #94A3B8; margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #EEF4FF; font-size: 10px; font-weight: 600; color: #4A6FA5; padding: 4px; text-align: center; border: 1px solid #D6E4F7; }
  td { padding: 4px; font-size: 10px; }
</style></head><body>
<h1>MedRota — ${programName} — Block ${block.number}</h1>
<p>${fmtDate(start)} to ${fmtDate(end)}</p>
<table>
  <thead><tr>${DAYS.map(d => `<th>${d}</th>`).join('')}</tr></thead>
  <tbody>${tableRows}</tbody>
</table>
<p style="margin-top:12px;text-align:center;color:#CBD5E1;">Generated by MedRota · medrota.app</p>
</body></html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('[schedule/export/pdf] Error:', err.message);
    res.status(500).json({ error: 'Failed to generate PDF view' });
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
