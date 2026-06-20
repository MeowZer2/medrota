const { HEADERS, buildScheduleRows } = require('./excelExport');
const { toDateKey } = require('./publicScheduleShape');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateKey(key) {
  if (!key) return '';
  const date = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatPublishedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function safeFilenamePart(value) {
  return String(value ?? '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'Schedule';
}

function buildPrintableFilename(schedule) {
  const block = schedule.block ?? {};
  const startKey = block.startDateKey ?? toDateKey(block.startDate);
  const endKey = block.endDateKey ?? toDateKey(block.endDate);
  return safeFilenamePart(`MedRota_Block_${block.number ?? 'Schedule'}_${startKey || 'start'}_to_${endKey || 'end'}`) + '.html';
}

function createPrintableScheduleHtml(schedule, options = {}) {
  const block = schedule.block ?? {};
  const rows = buildScheduleRows(schedule, options);
  const startKey = block.startDateKey ?? toDateKey(block.startDate);
  const endKey = block.endDateKey ?? toDateKey(block.endDate);
  const publishedLabel = formatPublishedAt(schedule.publishedAt);
  const title = `MedRota - ${block.programName ?? 'Program'} - Block ${block.number ?? ''}`;

  const headerCells = HEADERS.map(header => `<th>${escapeHtml(header)}</th>`).join('');
  const bodyRows = rows.map(row => `
        <tr>
          <td>${escapeHtml(row.dateLabel)}</td>
          <td>${escapeHtml(row.day)}</td>
          <td>${escapeHtml(row.holidayFlag)}</td>
          <td>${escapeHtml(row.attendingCall)}</td>
          <td>${escapeHtml(row.attendingActivities)}</td>
          <td>${escapeHtml(row.seniorResident)}</td>
          <td>${escapeHtml(row.juniorResident)}</td>
          <td class="${row.statusNotes.startsWith('Unassigned') ? 'muted' : ''}">${escapeHtml(row.statusNotes)}</td>
        </tr>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      color: #1A3A5C;
      background: #F8FAFC;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
    }
    .page {
      max-width: 1200px;
      margin: 0 auto;
      background: #fff;
      border: 1px solid #D6E4F7;
      border-radius: 10px;
      padding: 22px;
    }
    .topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 1px solid #E8EFF6;
      padding-bottom: 14px;
      margin-bottom: 14px;
    }
    h1 { margin: 0 0 5px; font-size: 22px; line-height: 1.2; }
    .meta { margin: 0; color: #64748B; line-height: 1.45; }
    .actions { display: flex; gap: 8px; white-space: nowrap; }
    button {
      border: 1px solid #C7D9EC;
      border-radius: 8px;
      background: #EEF4FF;
      color: #2C5F8A;
      font-weight: 700;
      padding: 8px 12px;
      cursor: pointer;
    }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th {
      background: #EEF4FF;
      color: #1A3A5C;
      border: 1px solid #D6E4F7;
      padding: 7px 6px;
      text-align: left;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    td {
      border: 1px solid #E8EFF6;
      padding: 7px 6px;
      vertical-align: top;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    th:nth-child(1), td:nth-child(1) { width: 12%; }
    th:nth-child(2), td:nth-child(2) { width: 9%; }
    th:nth-child(3), td:nth-child(3) { width: 14%; }
    th:nth-child(4), td:nth-child(4) { width: 13%; }
    th:nth-child(5), td:nth-child(5) { width: 17%; }
    th:nth-child(6), td:nth-child(6) { width: 12%; }
    th:nth-child(7), td:nth-child(7) { width: 15%; }
    th:nth-child(8), td:nth-child(8) { width: 14%; }
    .muted { color: #B45309; font-style: italic; }
    .footer { margin-top: 12px; text-align: center; color: #94A3B8; font-size: 10px; }
    @media print {
      body { background: #fff; padding: 0; font-size: 10px; }
      .page { max-width: none; border: none; border-radius: 0; padding: 0; }
      .actions { display: none; }
      h1 { font-size: 18px; }
      th { background: #EEF4FF !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="topbar">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p class="meta">
          ${escapeHtml([block.specialty, `${formatDateKey(startKey)} to ${formatDateKey(endKey)}`].filter(Boolean).join(' - '))}
          ${publishedLabel ? `<br>Published ${escapeHtml(publishedLabel)}` : ''}
        </p>
      </div>
      <div class="actions">
        <button type="button" onclick="window.print()">Print / Save PDF</button>
      </div>
    </header>
    <table>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows || `<tr><td colspan="${HEADERS.length}">No schedule rows available.</td></tr>`}</tbody>
    </table>
    <div class="footer">Generated by MedRota</div>
  </main>
</body>
</html>`;
}

module.exports = {
  createPrintableScheduleHtml,
  buildPrintableFilename,
};
