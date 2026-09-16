// A block number repeats each academic year. Carry the stable ID in every new
// workspace link, while accepting the old numbered URLs as entry points.
export function blockPath(block, section = '') {
  return `/blocks/${block.number}${section ? `/${section}` : ''}?blockId=${encodeURIComponent(block.id)}`;
}

export function resolveBlock({ blockId, blockNumber, academicYears, currentAcademicYear, currentBlock }) {
  const allBlocks = academicYears.flatMap(year => year.blocks ?? []);
  if (blockId) {
    return allBlocks.find(block => block.id === blockId && (!blockNumber || block.number === Number(blockNumber))) ?? null;
  }
  if (blockNumber) return (currentAcademicYear?.blocks ?? []).find(block => block.number === Number(blockNumber)) ?? null;
  return currentBlock;
}
