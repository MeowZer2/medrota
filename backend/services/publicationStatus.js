// Compare content represented in the immutable public snapshot. Database IDs,
// timestamps, row order, audit metadata and availability are not schedule edits.
const dateKey = value => value ? String(value instanceof Date ? value.toISOString() : value).slice(0, 10) : '';
const sorted = (rows, key) => rows.sort((a, b) => key(a).localeCompare(key(b)));

function canonicalSchedule(snapshot) {
  const block = snapshot?.block ?? {};
  return {
    block: {
      number: block.number ?? null,
      startDate: dateKey(block.startDate), endDate: dateKey(block.endDate),
      programName: block.programName ?? '', specialty: block.specialty ?? '',
      holidays: sorted((block.holidays ?? []).map(item => ({ date: dateKey(item.date), name: item.name ?? '' })), item => `${item.date}|${item.name}`),
    },
    attendingEntries: sorted((snapshot?.attendingEntries ?? []).map(item => ({
      date: dateKey(item.date), attendingName: item.attendingName ?? '',
      activityLabel: item.activityLabel ?? '', isCallDay: Boolean(item.isCallDay),
    })), item => `${item.date}|${item.attendingName}|${item.activityLabel}|${item.isCallDay}`),
    callDays: sorted((snapshot?.callDays ?? []).map(day => ({
      date: dateKey(day.date), isHoliday: Boolean(day.isHoliday), holidayName: day.holidayName ?? null,
      assignments: sorted((day.assignments ?? []).map(item => ({
        roleOnDay: item.roleOnDay ?? '', residentId: item.residentId ?? item.resident?.id ?? null,
        residentName: item.resident?.name ?? '',
      })), item => `${item.roleOnDay}|${item.residentId}|${item.residentName}`),
    })), item => item.date),
  };
}

function publicationState(block, latestSnapshot, liveSnapshot) {
  if (!latestSnapshot) return 'never_published';
  if (!block.isPublished) return 'unpublished';
  return JSON.stringify(canonicalSchedule(latestSnapshot)) === JSON.stringify(canonicalSchedule(liveSnapshot))
    ? 'current' : 'changes_unpublished';
}

module.exports = { canonicalSchedule, publicationState };
