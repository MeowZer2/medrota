// Date-only keys stay in UTC calendar space so local DST changes cannot add or skip a day.
export function rangeKeys(start, end) {
  const keys = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last && keys.length < 370) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}
