#!/usr/bin/env node
// Guarded repair for legacy duplicate (callDayId, roleOnDay) rows.
//
//   npm run data:integrity-repair                            plan only, no writes
//   MEDROTA_CONFIRM_REPAIR=yes npm run data:integrity-repair  apply the plan
//
// Rules:
//   * only groups the audit classifies deterministically are touched;
//   * ambiguous groups are always left alone;
//   * every removed row is archived to JSON before deletion;
//   * all deletions happen inside one transaction.

const fs = require('node:fs');
const path = require('node:path');
const prisma = require('../lib/prisma');
const { analyzeDuplicateRoleSlots } = require('../services/dataIntegrity');

const CONFIRM = process.env.MEDROTA_CONFIRM_REPAIR === 'yes';
const ARCHIVE_DIR = path.join(__dirname, '..', 'data-repair-archive');

async function main() {
  const findings = await analyzeDuplicateRoleSlots(false);
  const resolvable = findings.filter(f => f.resolution.rule !== 'ambiguous');
  const ambiguous = findings.filter(f => f.resolution.rule === 'ambiguous');

  console.log('[data:integrity-repair] duplicate role-slot repair');
  console.log(`  ${findings.length} duplicate group(s): ${resolvable.length} resolvable, ${ambiguous.length} ambiguous`);

  if (ambiguous.length > 0) {
    console.log('  Ambiguous groups are preserved untouched:');
    for (const f of ambiguous) {
      console.log(`    ${f.date} block ${f.blockNumber} ${f.roleOnDay}: ${f.resolution.rationale}`);
    }
  }

  const removeIds = resolvable.flatMap(f => f.resolution.removeIds);
  if (removeIds.length === 0) {
    console.log('  Nothing to repair.');
    return;
  }

  console.log(`  Plan: remove ${removeIds.length} surplus row(s) across ${resolvable.length} group(s).`);
  for (const f of resolvable) {
    console.log(`    ${f.date} block ${f.blockNumber} ${f.roleOnDay} -> keep ${f.resolution.keepId.slice(0, 8)}, remove ${f.resolution.removeIds.map(id => id.slice(0, 8)).join(', ')} (${f.resolution.rule})`);
  }

  if (!CONFIRM) {
    console.log('');
    console.log('  DRY RUN. No rows were modified.');
    console.log('  Re-run with MEDROTA_CONFIRM_REPAIR=yes to apply.');
    return;
  }

  // Archive the full rows before they are removed so nothing is unrecoverable.
  const archived = await prisma.callAssignment.findMany({
    where: { id: { in: removeIds } },
    include: {
      resident: { select: { id: true, name: true, residentRole: true, isMedStudent: true } },
      callDay: { select: { id: true, blockId: true, date: true } },
    },
  });
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const archivePath = path.join(ARCHIVE_DIR, `duplicate-role-slots-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(archivePath, JSON.stringify({
    removedAt: new Date().toISOString(),
    reason: 'Legacy duplicate (callDayId, roleOnDay) repair',
    groups: resolvable.map(f => ({
      date: f.date,
      blockId: f.blockId,
      roleOnDay: f.roleOnDay,
      rule: f.resolution.rule,
      rationale: f.resolution.rationale,
      keptAssignmentId: f.resolution.keepId,
      removedAssignmentIds: f.resolution.removeIds,
    })),
    removedRows: archived,
  }, null, 2));
  console.log(`  Archived ${archived.length} row(s) to ${archivePath}`);

  const result = await prisma.$transaction(async tx => {
    // Re-read inside the transaction so a concurrent change cannot make the
    // plan stale between analysis and deletion.
    const stillPresent = await tx.callAssignment.findMany({
      where: { id: { in: removeIds } },
      select: { id: true },
    });
    if (stillPresent.length !== removeIds.length) {
      throw new Error('Assignment set changed between analysis and repair; aborting without changes.');
    }
    const deleted = await tx.callAssignment.deleteMany({ where: { id: { in: removeIds } } });

    // Every repaired group must end with exactly one row in its slot.
    for (const f of resolvable) {
      const remaining = await tx.callAssignment.count({
        where: { callDayId: f.callDayId, roleOnDay: f.roleOnDay },
      });
      if (remaining !== 1) {
        throw new Error(`Group ${f.date}/${f.roleOnDay} left ${remaining} rows; rolling back.`);
      }
    }
    return deleted.count;
  });

  console.log(`  Removed ${result} row(s) transactionally.`);
  console.log('  Re-run npm run data:integrity-audit to confirm.');
}

main()
  .catch(err => {
    console.error('[data:integrity-repair] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
