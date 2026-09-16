// Shared block date utilities used across AttendingSchedule, Calendar, BlockPage

export const BLOCK_RANGES = {
  1:  { start: '2026-01-06', end: '2026-02-02' },
  2:  { start: '2026-02-03', end: '2026-03-02' },
  3:  { start: '2026-03-03', end: '2026-03-30' },
  4:  { start: '2026-03-31', end: '2026-04-27' },
  5:  { start: '2026-04-28', end: '2026-05-25' },
  6:  { start: '2026-05-26', end: '2026-06-22' },
  7:  { start: '2026-06-23', end: '2026-07-20' },
  8:  { start: '2026-07-21', end: '2026-08-17' },
  9:  { start: '2026-08-18', end: '2026-09-14' },
  10: { start: '2026-09-15', end: '2026-10-12' },
  11: { start: '2026-10-13', end: '2026-11-09' },
  12: { start: '2026-11-10', end: '2026-12-07' },
  13: { start: '2026-12-08', end: '2027-01-04' },
};

/**
 * Convert a Date to a local YYYY-MM-DD string.
 * Uses local date parts (not UTC) to avoid off-by-one errors in non-UTC timezones.
 */
export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Build an array of Date objects (local midnight) for every day between
 * startDate and endDate (inclusive). Accepts ISO strings or Date objects.
 */
export function getDaysFromDates(startDate, endDate) {
  const start = blockDate(startDate);
  const end = blockDate(endDate);
  // Use local date components to avoid UTC-shift issues
  const cur     = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endLocal = new Date(end.getFullYear(),  end.getMonth(),   end.getDate());
  const days = [];
  while (cur <= endLocal) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

// API block boundaries are calendar dates, not instants. Preserve their date
// key when converting UTC-midnight strings for display or local day iteration.
export function blockDate(value) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatBlockDate(value, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return blockDate(value).toLocaleDateString('en-GB', options);
}

/** Returns an array of Date objects for every day in a hardcoded block range. */
export function getDaysInBlock(blockNum) {
  const range = BLOCK_RANGES[blockNum];
  if (!range) return [];
  return getDaysFromDates(range.start + 'T00:00:00', range.end + 'T00:00:00');
}

export function isWeekend(date) {
  const d = date.getDay();
  return d === 0 || d === 6;
}

export function fmtShort(date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function fmtDay(date) {
  return date.toLocaleDateString('en-GB', { weekday: 'short' });
}

export function fmtFull(date) {
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Returns the flag object for a given date from a flags array, or null.
 * @param {Array} flags - array of DayFlag objects with a `date` field
 * @param {Date}  date  - the day to look up
 */
export function getFlagForDate(flags, date) {
  if (!flags?.length) return null;
  const iso = toISODate(date);
  return flags.find(f => toISODate(new Date(f.date)) === iso) ?? null;
}
