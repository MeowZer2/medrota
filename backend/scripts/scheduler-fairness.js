require('dotenv').config();

// Quantitative fairness assessment of the greedy generator.
//
// Two questions:
//   1. How evenly is call distributed within a role group?
//   2. Does a resident's position in the roster change how much call they get?
//
// (2) is the one that matters. If simply reordering the roster materially moves
// call between people, the generator is deciding by database order rather than
// by workload, and no amount of tuning the caps will make that fair.
//
//   npm run scheduler:fairness
//   npm run scheduler:fairness -- --json

const prisma = require('../lib/prisma');
const { generateSchedule } = require('../services/scheduler');
const { validateSchedule } = require('../services/scheduleValidator');
const { makeTag, buildScenario, destroyScenario, collectMetrics, spread } = require('./lib/acceptanceFixtures');

const AS_JSON = process.argv.includes('--json');
const realLog = console.log;
async function quiet(fn) {
  console.log = () => {};
  try { return await fn(); } finally { console.log = realLog; }
}

const SENIORS = 4;
const JUNIORS = 4;
const SENIOR_NAMES = Array.from({ length: SENIORS }, (_, i) => `Senior ${i + 1}`);
const JUNIOR_NAMES = Array.from({ length: JUNIORS }, (_, i) => `Junior ${i + 1}`);

function rotate(list, by) {
  return list.map((_, index) => list[(index + by) % list.length]);
}

// Four deterministic roster orderings. Same people, same constraints, different
// order in the enrollment table.
function orderings() {
  return [
    { label: 'natural', names: [...SENIOR_NAMES, ...JUNIOR_NAMES] },
    { label: 'reversed', names: [...[...SENIOR_NAMES].reverse(), ...[...JUNIOR_NAMES].reverse()] },
    { label: 'rotated-1', names: [...rotate(SENIOR_NAMES, 1), ...rotate(JUNIOR_NAMES, 1)] },
    { label: 'rotated-2', names: [...rotate(SENIOR_NAMES, 2), ...rotate(JUNIOR_NAMES, 2)] },
  ];
}

const BASE_SPEC = {
  startKey: '2034-01-02',
  days: 28,
  program: { juniorInHouseCall: true, seniorInHouseCall: false },
  seniors: SENIORS,
  juniors: JUNIORS,
  academicWeekday: 3,
  holidays: ['2034-01-25'],
  attendingEveryDay: true,
};

async function runOrdering(ordering) {
  let orgId;
  try {
    const scenario = await buildScenario({
      ...BASE_SPEC,
      tag: makeTag('FAIR'),
      enrollmentOrder: ordering.names,
    });
    orgId = scenario.orgId;
    await quiet(() => generateSchedule(scenario.blockId));
    const validation = await quiet(() => validateSchedule(scenario.blockId));
    const metrics = await quiet(() => collectMetrics(scenario));

    const byName = new Map(metrics.rows.map(row => [row.name, row]));
    return {
      label: ordering.label,
      names: ordering.names,
      compliant: validation.compliant,
      violations: validation.violations.map(v => v.code),
      unfilledSlots: metrics.unfilledSlots.length,
      totalSlots: scenario.coverableDateKeys.length * 2,
      rows: metrics.rows,
      byName,
      // Calls indexed by the resident's position within their role group in
      // this ordering, which is what exposes positional bias.
      seniorByPosition: ordering.names.filter(n => n.startsWith('Senior')).map(n => byName.get(n).calls),
      juniorByPosition: ordering.names.filter(n => n.startsWith('Junior')).map(n => byName.get(n).calls),
    };
  } finally {
    await destroyScenario(orgId);
  }
}

function meanOfColumns(rowsOfArrays) {
  const width = rowsOfArrays[0].length;
  return Array.from({ length: width }, (_, column) => {
    const values = rowsOfArrays.map(row => row[column]);
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
  });
}

// Correlation between roster position and mean call load. A strong negative
// value means the earliest roster entries are systematically favoured, which is
// the specific failure mode a positional tie-break produces.
function positionCorrelation(means) {
  const n = means.length;
  if (n < 2) return 0;
  const positions = Array.from({ length: n }, (_, index) => index);
  const meanX = (n - 1) / 2;
  const meanY = means.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = positions[index] - meanX;
    const dy = means[index] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  if (denomX === 0 || denomY === 0) return 0;
  return Number((numerator / Math.sqrt(denomX * denomY)).toFixed(3));
}

function coefficientOfVariation(stats) {
  if (!stats.mean) return 0;
  return Number((stats.stdDev / stats.mean).toFixed(3));
}

async function main() {
  const runs = [];
  for (const ordering of orderings()) {
    runs.push(await runOrdering(ordering));
  }

  // Within-run distribution: how evenly is call spread among peers?
  const distribution = runs.map(run => ({
    ordering: run.label,
    senior: spread(run.rows.filter(r => r.role === 'senior').map(r => r.calls)),
    junior: spread(run.rows.filter(r => r.role === 'junior').map(r => r.calls)),
    seniorWeekend: spread(run.rows.filter(r => r.role === 'senior').map(r => r.weekendCalls)),
    juniorWeekend: spread(run.rows.filter(r => r.role === 'junior').map(r => r.weekendCalls)),
    seniorBurden: spread(run.rows.filter(r => r.role === 'senior').map(r => r.weightedBurden)),
    juniorBurden: spread(run.rows.filter(r => r.role === 'junior').map(r => r.weightedBurden)),
    unfilledSlots: run.unfilledSlots,
    compliant: run.compliant,
  }));

  // Cross-run identity effect: does the same person get the same load when only
  // the roster order changes?
  const perResident = {};
  for (const name of [...SENIOR_NAMES, ...JUNIOR_NAMES]) {
    const counts = runs.map(run => run.byName.get(name).calls);
    perResident[name] = { counts, spread: spread(counts) };
  }
  const maxIdentitySwing = Math.max(...Object.values(perResident).map(entry => entry.spread.range));

  // Positional effect: averaged over orderings, does roster position predict load?
  const seniorPositionMeans = meanOfColumns(runs.map(run => run.seniorByPosition));
  const juniorPositionMeans = meanOfColumns(runs.map(run => run.juniorByPosition));
  const positionalBias = Math.max(
    Math.max(...seniorPositionMeans) - Math.min(...seniorPositionMeans),
    Math.max(...juniorPositionMeans) - Math.min(...juniorPositionMeans),
  );

  const seniorCorrelation = positionCorrelation(seniorPositionMeans);
  const juniorCorrelation = positionCorrelation(juniorPositionMeans);
  const earlyEntryAdvantage = Math.max(-seniorCorrelation, -juniorCorrelation);

  const report = {
    generatedAt: new Date().toISOString(),
    scenario: { ...BASE_SPEC, orderings: orderings().map(o => o.label) },
    distribution,
    perResident,
    maxIdentitySwing,
    seniorPositionMeans,
    juniorPositionMeans,
    positionalBias: Number(positionalBias.toFixed(2)),
    seniorCorrelation,
    juniorCorrelation,
    earlyEntryAdvantage,
    coefficientOfVariation: {
      senior: coefficientOfVariation(distribution[0].senior),
      junior: coefficientOfVariation(distribution[0].junior),
    },
    unfilledSlots: distribution[0].unfilledSlots,
    totalSlots: runs[0].totalSlots,
  };

  if (AS_JSON) {
    realLog(JSON.stringify(report, null, 2));
    return;
  }

  realLog('[scheduler:fairness] greedy generator fairness assessment');
  realLog(`  scenario: ${SENIORS} seniors + ${JUNIORS} juniors, 28-day block, weekly academic day, 1 holiday`);
  realLog('');
  realLog('  Within-run distribution (call counts per role group)');
  console.table(distribution.map(row => ({
    ordering: row.ordering,
    compliant: row.compliant,
    unfilled: row.unfilledSlots,
    'senior min/max': `${row.senior.min}/${row.senior.max}`,
    'senior sd': row.senior.stdDev,
    'junior min/max': `${row.junior.min}/${row.junior.max}`,
    'junior sd': row.junior.stdDev,
    'sr weekend range': row.seniorWeekend.range,
    'jr weekend range': row.juniorWeekend.range,
  })));

  realLog('  Same resident across the four roster orderings');
  console.table(Object.entries(perResident).map(([name, entry]) => ({
    resident: name,
    calls: entry.counts.join(' / '),
    range: entry.spread.range,
    stdDev: entry.spread.stdDev,
  })));

  realLog(`  Mean calls by roster position, seniors: ${seniorPositionMeans.join(', ')} (r = ${seniorCorrelation})`);
  realLog(`  Mean calls by roster position, juniors: ${juniorPositionMeans.join(', ')} (r = ${juniorCorrelation})`);
  realLog('');
  realLog(`  Coverage: ${report.totalSlots - report.unfilledSlots}/${report.totalSlots} slots filled`);
  realLog(`  Coefficient of variation: senior ${report.coefficientOfVariation.senior}, junior ${report.coefficientOfVariation.junior}`);
  realLog(`  Largest swing for one resident caused only by roster order: ${maxIdentitySwing} call(s)`);
  realLog(`  Spread of mean calls across roster positions: ${report.positionalBias}`);
  realLog('');

  // Two different failure modes, reported separately.
  if (earlyEntryAdvantage >= 0.6) {
    realLog(`  SYSTEMATIC BIAS: earlier roster entries are consistently favoured (r = ${-earlyEntryAdvantage}).`);
  } else {
    realLog('  No systematic advantage to earlier roster entries: position does not predict load monotonically.');
  }
  if (maxIdentitySwing >= 2) {
    realLog(`  RESIDUAL DETERMINISM: roster order still moves up to ${maxIdentitySwing} calls between individuals.`);
    realLog('  Greedy assignment is order-sensitive by nature; removing this needs a solver, which is out of scope.');
  } else {
    realLog('  Roster order does not materially change who receives call.');
  }
}

main()
  .catch(error => {
    console.log = realLog;
    console.error('[scheduler:fairness] failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
