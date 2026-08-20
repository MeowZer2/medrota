#!/usr/bin/env node
// Read-only scheduling data integrity audit.
//
//   npm run data:integrity-audit                 human-readable, no names
//   npm run data:integrity-audit -- --json       machine-readable report
//   npm run data:integrity-audit -- --names      include resident names
//   npm run data:integrity-audit -- --strict     exit 1 when findings exist
//
// This script never writes. Use scripts/data-integrity-repair.js to act on it.

const prisma = require('../lib/prisma');
const { runIntegrityAudit, canAddRoleSlotUniqueness } = require('../services/dataIntegrity');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const includeNames = args.includes('--names') || args.includes('--include-names');
const strict = args.includes('--strict');

function section(title, rows, render) {
  if (rows.length === 0) {
    console.log(`  OK    ${title}: none`);
    return 0;
  }
  console.log(`  FOUND ${title}: ${rows.length}`);
  for (const row of rows) console.log(`          ${render(row)}`);
  return rows.length;
}

async function main() {
  const report = await runIntegrityAudit({ includeNames });

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const who = row => (row.name ? row.name : `resident ${row.residentId.slice(0, 8)}`);

    console.log('[data:integrity-audit] MedRota scheduling data integrity');
    console.log(`  generated ${report.generatedAt}`);
    console.log(`  scope: ${report.totals.blocks} blocks, ${report.totals.callDays} call days, ${report.totals.callAssignments} assignments`);
    console.log('');

    const dup = report.duplicateRoleSlotSummary;
    if (dup.groups === 0) {
      console.log('  OK    Duplicate role slots: none');
    } else {
      console.log(`  FOUND Duplicate role slots: ${dup.groups} groups / ${dup.rows} rows`);
      console.log(`          ${dup.deterministicallyResolvable} deterministically resolvable, ${dup.ambiguous} ambiguous`);
      console.log(`          ${dup.rowsToRemove} surplus rows would be removed by repair`);
      for (const finding of report.duplicateRoleSlots) {
        console.log('');
        console.log(`          ${finding.date}  block ${finding.blockNumber}  ${finding.roleOnDay} slot  (${finding.rowCount} rows)`);
        console.log(`            published: ${finding.blockIsPublished}, snapshots: ${finding.publishedVersionCount}`);
        for (const row of finding.rows) {
          const keep = finding.resolution.keepId === row.assignmentId ? 'KEEP  '
            : (finding.resolution.removeIds ?? []).includes(row.assignmentId) ? 'REMOVE' : '?     ';
          const tags = [
            row.isMedStudent ? 'med-student' : row.role,
            row.isOverride ? 'manual-override' : 'generated',
            row.isActive ? null : 'inactive',
          ].filter(Boolean).join(', ');
          console.log(`            ${keep} ${who(row)} (${tags}) created ${row.createdAt}`);
        }
        console.log(`            rule: ${finding.resolution.rule}`);
        console.log(`            ${finding.resolution.rationale}`);
      }
    }
    console.log('');

    section('Same resident in both slots on one day', report.sameResidentBothSlots,
      r => `${r.date} block-day ${r.callDayId.slice(0, 8)} ${who(r)} x${r.slotCount}`);
    section('Assignments crossing program boundaries', report.crossProgramAssignments,
      r => `${r.date} ${who(r)} resident-program ${r.residentProgramId.slice(0, 8)} vs block-program ${r.blockProgramId.slice(0, 8)}`);
    section('Residents ineligible for their assigned slot', report.ineligibleRoleAssignments,
      r => `${r.date} ${r.roleOnDay} ${who(r)} (${r.isMedStudent ? 'med-student' : r.role}${r.isActive ? '' : ', inactive'})${r.isOverride ? ' [override]' : ''}`);
    section('Assignments without block availability', report.assignmentsWithoutEnrollment,
      r => `${r.date} ${r.roleOnDay} ${who(r)} block ${r.blockId.slice(0, 8)}`);
    section('Call days outside their block date range', report.callDaysOutsideBlock,
      r => `${r.date} block ${r.blockNumber} (${r.blockStart} to ${r.blockEnd})`);
    section('Published blocks with no snapshot', report.publishedWithoutVersion,
      r => `block ${r.blockNumber} ${r.blockId.slice(0, 8)} token=${r.hasPublicToken}`);

    console.log('');
    console.log(canAddRoleSlotUniqueness(report)
      ? '  UNIQUE(callDayId, roleOnDay) can be enforced once repair has run.'
      : '  UNIQUE(callDayId, roleOnDay) must NOT be enforced yet: ambiguous duplicates remain.');
    if (!includeNames) {
      console.log('  Resident names were not printed. Re-run with --names if you need them.');
    }
    console.log('  This audit is read-only. No rows were modified.');
  }

  if (strict) {
    const findingCount = report.duplicateRoleSlots.length
      + report.sameResidentBothSlots.length
      + report.crossProgramAssignments.length
      + report.ineligibleRoleAssignments.length
      + report.publishedWithoutVersion.length;
    if (findingCount > 0) {
      process.exitCode = 1;
    }
  }
}

main()
  .catch(err => {
    console.error('[data:integrity-audit] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
