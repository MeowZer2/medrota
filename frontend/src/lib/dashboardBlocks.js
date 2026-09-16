export function focusBlocksForDate(blocks, today) {
  const ordered = [...blocks].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  const current = ordered.find(block => String(block.startDate).slice(0, 10) <= today && String(block.endDate).slice(0, 10) >= today);
  const upcoming = ordered.find(block => String(block.startDate).slice(0, 10) > today);
  const focusBlocks = current ? [current, upcoming].filter(Boolean) : upcoming ? [upcoming] : ordered.length ? [ordered.at(-1)] : [];
  return { ordered, current, upcoming, focusBlocks };
}
