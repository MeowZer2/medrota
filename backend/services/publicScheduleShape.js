const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function toDateKey(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function dayOfWeek(value) {
  const key = toDateKey(value);
  if (!key) return null;
  const date = new Date(`${key}T00:00:00.000Z`);
  return DAY_NAMES[date.getUTCDay()];
}

function publicDate(value) {
  const key = toDateKey(value);
  return key ? `${key}T12:00:00.000Z` : null;
}

function publicHolidayShape(holiday) {
  const date = toDateKey(holiday?.date);
  return {
    date: publicDate(date),
    dateKey: date,
    dayOfWeek: dayOfWeek(date),
    name: holiday?.name ?? '',
  };
}

function publicAttendingShape(entry) {
  const date = toDateKey(entry?.date);
  return {
    date: publicDate(date),
    dateKey: date,
    dayOfWeek: dayOfWeek(date),
    attendingName: entry?.attendingName ?? '',
    activityLabel: entry?.activityLabel ?? '',
    isCallDay: Boolean(entry?.isCallDay),
  };
}

function publicAssignmentShape(assignment) {
  const residentName =
    typeof assignment?.resident === 'string'
      ? assignment.resident
      : assignment?.resident?.name ?? '';

  return {
    roleOnDay: assignment?.roleOnDay ?? '',
    status: residentName ? 'assigned' : 'unassigned',
    resident: {
      name: residentName,
    },
  };
}

function publicCallDayShape(callDay) {
  const date = toDateKey(callDay?.date);
  return {
    date: publicDate(date),
    dateKey: date,
    dayOfWeek: dayOfWeek(date),
    isHoliday: Boolean(callDay?.isHoliday),
    holidayName: callDay?.holidayName ?? null,
    assignments: (callDay?.assignments ?? []).map(publicAssignmentShape),
  };
}

function publicFlagShape(flag) {
  const date = toDateKey(flag?.date);
  return {
    date: publicDate(date),
    dateKey: date,
    dayOfWeek: dayOfWeek(date),
    label: flag?.label ?? '',
    color: flag?.color ?? '#F59E0B',
  };
}

function shapePublicSchedule({ snapshot, publishedAt, flags = [] }) {
  const block = snapshot?.block ?? {};
  const startDate = toDateKey(block.startDate);
  const endDate = toDateKey(block.endDate);

  return {
    block: {
      number: block.number ?? null,
      startDate: publicDate(startDate),
      endDate: publicDate(endDate),
      startDateKey: startDate,
      endDateKey: endDate,
      programName: block.programName ?? 'Program',
      specialty: block.specialty ?? '',
      holidays: (block.holidays ?? []).map(publicHolidayShape),
    },
    attendingEntries: (snapshot?.attendingEntries ?? []).map(publicAttendingShape),
    callDays: (snapshot?.callDays ?? []).map(publicCallDayShape),
    flags: flags.map(publicFlagShape),
    publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
  };
}

module.exports = {
  shapePublicSchedule,
  toDateKey,
};
