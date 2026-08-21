function cleanName(value) {
  return String(value ?? '')
    .trim()
    .replace(/^(dr\.?|doctor)\s+/i, '')
    .replace(/\s+/g, ' ');
}

function nameParts(value) {
  const parts = cleanName(value).split(' ').filter(Boolean);
  return {
    full: parts.join(' '),
    first: parts[0] ?? 'Resident',
    middle: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    last: parts.at(-1) ?? 'Resident',
  };
}

function roleDifferentiator(resident) {
  if (resident.isMedStudent) return 'Medical Student';
  if (resident.isServiceResident === false) return resident.homeProgram || 'Off-service';
  return resident.pgyLevel ? `PGY-${String(resident.pgyLevel).replace(/^PGY-?/i, '')}` : 'In-service';
}

/**
 * Build unambiguous clinical display names for one visible resident scope.
 * No email, phone, database id, or other private identifier is ever used.
 */
function buildResidentDisplayNames(residents = []) {
  const parsed = residents.map((resident, index) => ({ resident, index, ...nameParts(resident.name) }));
  const lastCounts = new Map();
  const initialCounts = new Map();
  const fullCounts = new Map();

  for (const item of parsed) {
    const lastKey = item.last.toLocaleLowerCase();
    const initialKey = `${item.first[0]?.toLocaleLowerCase()}.${lastKey}`;
    const fullKey = item.full.toLocaleLowerCase();
    lastCounts.set(lastKey, (lastCounts.get(lastKey) ?? 0) + 1);
    initialCounts.set(initialKey, (initialCounts.get(initialKey) ?? 0) + 1);
    fullCounts.set(fullKey, (fullCounts.get(fullKey) ?? 0) + 1);
  }

  const duplicateOrdinal = new Map();
  return new Map(parsed.map(item => {
    const lastKey = item.last.toLocaleLowerCase();
    const initialKey = `${item.first[0]?.toLocaleLowerCase()}.${lastKey}`;
    const fullKey = item.full.toLocaleLowerCase();
    let displayName;
    if (lastCounts.get(lastKey) === 1) {
      displayName = `Dr. ${item.last}`;
    } else if (initialCounts.get(initialKey) === 1) {
      displayName = `Dr. ${item.first[0].toUpperCase()}. ${item.last}`;
    } else {
      displayName = `Dr. ${item.full}`;
      if ((fullCounts.get(fullKey) ?? 0) > 1) {
        const differentiationKey = `${fullKey}|${roleDifferentiator(item.resident).toLocaleLowerCase()}`;
        const ordinal = (duplicateOrdinal.get(differentiationKey) ?? 0) + 1;
        duplicateOrdinal.set(differentiationKey, ordinal);
        displayName += ` (${roleDifferentiator(item.resident)}${ordinal > 1 ? ` ${ordinal}` : ''})`;
      }
    }
    return [item.resident.id ?? `resident-${item.index}`, displayName];
  }));
}

function decorateResidentDisplayNames(residents = []) {
  const names = buildResidentDisplayNames(residents);
  return residents.map((resident, index) => ({
    ...resident,
    displayName: names.get(resident.id ?? `resident-${index}`),
  }));
}

module.exports = { buildResidentDisplayNames, decorateResidentDisplayNames, cleanName };
