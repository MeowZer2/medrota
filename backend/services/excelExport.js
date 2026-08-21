const ExcelJS = require('exceljs');
const { buildResidentDisplayNames } = require('./residentDisplayName');
const { toDateKey } = require('./publicScheduleShape');

const HEADERS = [
  'Date',
  'Day',
  'Holiday / Flag',
  'Attending Call',
  'Attending Activities',
  'Senior Resident',
  'Junior Resident / Med Student',
  'Status / Notes',
];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dateFromKey(key) {
  if (!key) return null;
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function addDaysKey(key, count) {
  const date = dateFromKey(key);
  if (!date) return null;
  return new Date(date.getTime() + count * MS_PER_DAY).toISOString().slice(0, 10);
}

function enumerateDateKeys(startKey, endKey) {
  if (!startKey || !endKey) return [];
  const start = dateFromKey(startKey);
  const end = dateFromKey(endKey);
  if (!start || !end || start > end) return [];

  const days = [];
  for (let key = startKey; key && dateFromKey(key) <= end; key = addDaysKey(key, 1)) {
    days.push(key);
  }
  return days;
}

function compactJoin(values, separator = ', ') {
  return values.map(value => String(value ?? '').trim()).filter(Boolean).join(separator);
}

function safeFilenamePart(value) {
  return String(value ?? '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'Schedule';
}

function excelDateLabel(key) {
  const date = dateFromKey(key);
  return date
    ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : key;
}

function dayName(key) {
  const date = dateFromKey(key);
  return date ? DAY_NAMES[date.getUTCDay()] : '';
}

function buildMap(items, mapper) {
  const map = new Map();
  for (const item of items ?? []) {
    const key = item.dateKey ?? toDateKey(item.date);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(mapper ? mapper(item) : item);
  }
  return map;
}

function buildScheduleRows(schedule, options = {}) {
  const block = schedule.block ?? {};
  const startKey = block.startDateKey ?? toDateKey(block.startDate);
  const endKey = block.endDateKey ?? toDateKey(block.endDate);
  const days = enumerateDateKeys(startKey, endKey);

  const holidays = new Map();
  for (const holiday of block.holidays ?? []) {
    const key = holiday.dateKey ?? toDateKey(holiday.date);
    if (key && holiday.name) holidays.set(key, holiday.name);
  }

  const flags = buildMap(schedule.flags);
  const attendings = buildMap(schedule.attendingEntries);
  const callDays = buildMap(schedule.callDays);

  return days.map(key => {
    const dayAttendings = attendings.get(key) ?? [];
    const dayCallDays = callDays.get(key) ?? [];
    const assignments = dayCallDays.flatMap(callDay => callDay.assignments ?? []);
    const callDayHoliday = dayCallDays.find(callDay => callDay.holidayName)?.holidayName;
    const flagLabels = (flags.get(key) ?? []).map(flag => flag.label);
    const holidayFlag = compactJoin([holidays.get(key), callDayHoliday, ...flagLabels]);

    const callAttendings = dayAttendings.filter(entry => entry.isCallDay);
    const nonCallAttendings = dayAttendings.filter(entry => !entry.isCallDay);
    const attendingCall = compactJoin(callAttendings.map(entry => entry.attendingName));
    const attendingActivities = compactJoin(
      nonCallAttendings.map(entry => compactJoin([entry.attendingName, entry.activityLabel], ' - '))
    );
    const seniorResident = compactJoin(
      assignments
        .filter(assignment => assignment.roleOnDay === 'senior')
        .map(assignment => assignment.resident?.name ?? assignment.resident)
    );
    const juniorResident = compactJoin(
      assignments
        .filter(assignment => assignment.roleOnDay === 'junior')
        .map(assignment => assignment.resident?.name ?? assignment.resident)
    );

    const notes = options.includeNotes
      ? compactJoin(dayAttendings.map(entry => entry.notes), '; ')
      : '';
    const status = seniorResident || juniorResident ? 'Assigned' : 'Unassigned';

    return {
      date: key,
      dateLabel: excelDateLabel(key),
      day: dayName(key),
      holidayFlag,
      attendingCall,
      attendingActivities,
      seniorResident,
      juniorResident,
      statusNotes: compactJoin([status, notes], ' - '),
    };
  });
}

function buildExcelFilename(schedule) {
  const block = schedule.block ?? {};
  const number = block.number ?? 'Schedule';
  const startKey = block.startDateKey ?? toDateKey(block.startDate);
  const endKey = block.endDateKey ?? toDateKey(block.endDate);
  return safeFilenamePart(`MedRota_Block_${number}_${startKey || 'start'}_to_${endKey || 'end'}`) + '.xlsx';
}

function applyBorders(cell) {
  const border = { style: 'thin', color: { argb: 'FFD6E4F7' } };
  cell.border = { top: border, right: border, bottom: border, left: border };
}

function createScheduleWorkbook(schedule, options = {}) {
  const block = schedule.block ?? {};
  const rows = buildScheduleRows(schedule, options);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MedRota';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Schedule');
  const startKey = block.startDateKey ?? toDateKey(block.startDate);
  const endKey = block.endDateKey ?? toDateKey(block.endDate);
  const title = `MedRota - ${block.programName ?? 'Program'} - Block ${block.number ?? ''} - ${startKey ?? ''} to ${endKey ?? ''}`;

  sheet.mergeCells('A1:H1');
  sheet.getCell('A1').value = title;
  sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 28;

  sheet.mergeCells('A2:H2');
  sheet.getCell('A2').value = compactJoin([
    block.specialty,
    schedule.publishedAt
      ? `Published schedule - ${new Date(schedule.publishedAt).toISOString()}`
      : 'Draft schedule',
  ]);
  sheet.getCell('A2').font = { size: 11, color: { argb: 'FF64748B' } };
  sheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' };

  sheet.getRow(4).values = HEADERS;
  sheet.getRow(4).height = 22;
  sheet.getRow(4).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C5F8A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    applyBorders(cell);
  });

  for (const row of rows) {
    sheet.addRow([
      row.dateLabel,
      row.day,
      row.holidayFlag,
      row.attendingCall,
      row.attendingActivities,
      row.seniorResident,
      row.juniorResident,
      row.statusNotes,
    ]);
  }

  sheet.columns = [
    { key: 'date', width: 16 },
    { key: 'day', width: 13 },
    { key: 'holidayFlag', width: 22 },
    { key: 'attendingCall', width: 24 },
    { key: 'attendingActivities', width: 32 },
    { key: 'seniorResident', width: 24 },
    { key: 'juniorResident', width: 28 },
    { key: 'statusNotes', width: 28 },
  ];

  for (let rowNumber = 5; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    row.height = 34;
    row.eachCell(cell => {
      cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
      cell.font = { size: 10, color: { argb: 'FF1A3A5C' } };
      applyBorders(cell);
    });
    const statusCell = row.getCell(8);
    if (String(statusCell.value ?? '').startsWith('Unassigned')) {
      statusCell.font = { size: 10, italic: true, color: { argb: 'FFD97706' } };
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
    }
    const holidayCell = row.getCell(3);
    if (holidayCell.value) {
      holidayCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    }
  }

  sheet.views = [{ state: 'frozen', ySplit: 4 }];
  sheet.autoFilter = { from: 'A4', to: 'H4' };

  return { workbook, rows, filename: buildExcelFilename(schedule), headers: HEADERS };
}

function shapeProtectedSchedule(block) {
  const enrolledResidents = (block.enrollments ?? []).map(item => item.resident).filter(Boolean);
  const assignedResidents = (block.callDays ?? []).flatMap(day => day.assignments ?? []).map(item => item.resident).filter(Boolean);
  const residents = [...new Map([...enrolledResidents, ...assignedResidents].map(item => [item.id, item])).values()];
  const displayNames = buildResidentDisplayNames(residents);
  return {
    scheduleState: 'draft',
    block: {
      number: block.number ?? null,
      startDate: block.startDate,
      endDate: block.endDate,
      startDateKey: toDateKey(block.startDate),
      endDateKey: toDateKey(block.endDate),
      programName: block.academicYear?.program?.name ?? 'Program',
      specialty: block.academicYear?.program?.specialty ?? '',
      holidays: (block.academicYear?.holidays ?? []).map(holiday => ({
        date: holiday.date,
        dateKey: toDateKey(holiday.date),
        name: holiday.name ?? '',
      })),
    },
    attendingEntries: (block.attendingEntries ?? []).map(entry => ({
      date: entry.date,
      dateKey: toDateKey(entry.date),
      attendingName: entry.attendingName ?? '',
      activityLabel: entry.activityLabel ?? '',
      isCallDay: Boolean(entry.isCallDay),
      notes: entry.notes ?? '',
    })),
    callDays: (block.callDays ?? []).map(callDay => ({
      date: callDay.date,
      dateKey: toDateKey(callDay.date),
      holidayName: callDay.holidayName ?? null,
      assignments: (callDay.assignments ?? []).map(assignment => ({
        roleOnDay: assignment.roleOnDay ?? '',
        resident: {
          name: displayNames.get(assignment.resident?.id) ?? assignment.resident?.name ?? '',
        },
      })),
    })),
    flags: (block.flags ?? []).map(flag => ({
      date: flag.date,
      dateKey: toDateKey(flag.date),
      label: flag.label ?? '',
      color: flag.color ?? '#F59E0B',
    })),
  };
}

module.exports = {
  HEADERS,
  buildScheduleRows,
  createScheduleWorkbook,
  buildExcelFilename,
  shapeProtectedSchedule,
};
