require('dotenv').config();

// Realistic scheduler acceptance harness.
//
// Answers a different question from the unit and integration smokes: would a
// Chief Resident accept what comes out? Each scenario builds its own isolated,
// anonymized organization, generates a schedule, and asserts against the rules
// a program actually cares about. Every scenario removes exactly what it made.
//
//   npm run scheduler:acceptance
//   npm run scheduler:acceptance -- --report    also print the metrics tables

const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { generateSchedule } = require('../services/scheduler');
const { validateSchedule } = require('../services/scheduleValidator');
const {
  makeTag, buildScenario, destroyScenario, collectMetrics, spread, dayOfWeek,
} = require('./lib/acceptanceFixtures');
const {
  addDaysToDateKey, isFridaySaturdaySunday, getWeekendKey, getCompleteWeekendKeys,
  requiredCompleteWeekendsOff, getInHouseMax, getHomeCallMax, calculateDaysOnService,
} = require('../services/paroRules');

const SHOW_REPORT = process.argv.includes('--report');

// The scheduler is deliberately chatty. Acceptance output should be the verdict,
// not the trace.
const realLog = console.log;
async function quiet(fn) {
  console.log = () => {};
  try { return await fn(); } finally { console.log = realLog; }
}

const results = [];
function record(scenario, name, detail) {
  results.push({ scenario, name, detail });
}

// ---------------------------------------------------------------------------
// Shared rule assertions. These describe what a program would reject, not what
// the implementation happens to do.
// ---------------------------------------------------------------------------

function assertNoHardViolations(label, validation) {
  assert.equal(
    validation.compliant, true,
    `${label}: generated schedule must satisfy every hard rule, got ${validation.violations.map(v => `${v.code}@${v.date}`).join(', ')}`,
  );
}

function assertNoConsecutiveCalls(label, metrics) {
  for (const row of metrics.rows) {
    for (let index = 1; index < row.dates.length; index += 1) {
      assert.notEqual(
        row.dates[index - 1], addDaysToDateKey(row.dates[index], -1),
        `${label}: ${row.name} has consecutive call on ${row.dates[index - 1]} and ${row.dates[index]}`,
      );
    }
  }
}

function assertVacationRespected(label, metrics, vacationsByName) {
  for (const row of metrics.rows) {
    const ranges = vacationsByName[row.name] ?? [];
    for (const [from, to] of ranges) {
      for (const dateKey of row.dates) {
        assert.ok(
          dateKey < from || dateKey > to,
          `${label}: ${row.name} is assigned ${dateKey} inside vacation ${from}..${to}`,
        );
        assert.notEqual(
          addDaysToDateKey(dateKey, 1), from,
          `${label}: ${row.name} is post-call on ${dateKey}, the day before vacation starts ${from}`,
        );
      }
    }
  }
}

function assertWeekendRules(label, scenario, metrics, program) {
  const required = requiredCompleteWeekendsOff(scenario.blockDateKeys);
  const completeWeekends = getCompleteWeekendKeys(scenario.blockDateKeys);

  for (const row of metrics.rows) {
    const workedWeekends = new Set(row.dates.filter(isFridaySaturdaySunday).map(getWeekendKey));
    const weekendsOff = completeWeekends.filter(key => !workedWeekends.has(key)).length;
    assert.ok(
      weekendsOff >= required,
      `${label}: ${row.name} has ${weekendsOff} complete weekends off, needs ${required}`,
    );

    const isHomeCall = row.role === 'senior' ? !program.seniorInHouseCall : program.juniorInHouseCall === false;
    if (!isHomeCall) continue;
    const sorted = [...workedWeekends].sort();
    for (let index = 1; index < sorted.length; index += 1) {
      assert.notEqual(
        sorted[index - 1], addDaysToDateKey(sorted[index], -7),
        `${label}: ${row.name} has home call on consecutive weekends ${sorted[index - 1]} and ${sorted[index]}`,
      );
    }
  }
}

function assertParoMaximums(label, scenario, metrics, vacationsByName, localCap) {
  for (const row of metrics.rows) {
    const vacationDays = (vacationsByName[row.name] ?? []).reduce((sum, [from, to]) => {
      let count = 0;
      for (let key = from; key <= to; key = addDaysToDateKey(key, 1)) {
        if (scenario.blockDateKeys.includes(key)) count += 1;
      }
      return sum + count;
    }, 0);
    const daysOnService = scenario.blockDateKeys.length - vacationDays;
    assert.ok(
      row.inHouseCalls <= getInHouseMax(daysOnService),
      `${label}: ${row.name} has ${row.inHouseCalls} in-house calls over the PARO max ${getInHouseMax(daysOnService)} for ${daysOnService} days on service`,
    );
    assert.ok(
      row.homeCalls <= getHomeCallMax(daysOnService),
      `${label}: ${row.name} has ${row.homeCalls} home calls over the PARO max ${getHomeCallMax(daysOnService)} for ${daysOnService} days on service`,
    );
    assert.ok(
      row.weightedBurden <= 30,
      `${label}: ${row.name} has a weighted call burden of ${row.weightedBurden}, over the blended limit of 30`,
    );
    assert.ok(
      row.calls <= localCap,
      `${label}: ${row.name} has ${row.calls} calls over the configured local ceiling of ${localCap}`,
    );
  }
}

function assertBalanced(label, metrics, maxRange) {
  for (const role of ['senior', 'junior']) {
    const counts = metrics.rows.filter(row => row.role === role && !row.isMedStudent).map(row => row.calls);
    if (counts.length < 2) continue;
    const stats = spread(counts);
    assert.ok(
      stats.range <= maxRange,
      `${label}: ${role} call counts range ${stats.range} (min ${stats.min}, max ${stats.max}) exceeds the acceptable spread of ${maxRange}`,
    );
  }
}

function assertEveryGapExplained(label, summary, metrics) {
  const explained = new Set(
    summary.warnings
      .filter(item => item.date && /No PARO-eligible/.test(item.message ?? ''))
      .map(item => item.date),
  );
  for (const slot of metrics.unfilledSlots) {
    assert.ok(
      explained.has(slot.date),
      `${label}: ${slot.date} ${slot.roleOnDay} is unfilled with no explanation of the binding constraint`,
    );
  }
  for (const item of summary.warnings.filter(w => /No PARO-eligible/.test(w.message ?? ''))) {
    assert.match(
      item.message, /\(.+\)$/,
      `${label}: unfilled-slot warning on ${item.date} must name the constraints that rejected candidates`,
    );
  }
}

function reportMetrics(label, scenario, metrics) {
  if (!SHOW_REPORT) return;
  realLog(`\n  --- ${label} metrics ---`);
  const rows = metrics.rows.map(row => ({
    resident: row.name,
    role: row.isMedStudent ? 'student' : row.role,
    calls: row.calls,
    weekday: row.weekdayCalls,
    weekend: row.weekendCalls,
    home: row.homeCalls,
    inHouse: row.inHouseCalls,
    burden: row.weightedBurden,
  }));
  console.table(rows);
  for (const role of ['senior', 'junior']) {
    const counts = metrics.rows.filter(r => r.role === role && !r.isMedStudent).map(r => r.calls);
    if (counts.length) realLog(`  ${role} spread: ${JSON.stringify(spread(counts))}`);
  }
  realLog(`  slots filled: ${scenario.coverableDateKeys.length * 2 - metrics.unfilledSlots.length}/${scenario.coverableDateKeys.length * 2}`);
}

// ---------------------------------------------------------------------------
// Scenario A - a normal 28-day block
// ---------------------------------------------------------------------------

async function scenarioA() {
  const vacations = {
    'Senior 2': [['2034-01-09', '2034-01-15']],
    'Junior 3': [['2034-01-16', '2034-01-22']],
  };
  const program = { juniorInHouseCall: true, seniorInHouseCall: false };
  let orgId;
  try {
    const scenario = await buildScenario({
      tag: makeTag('A'),
      startKey: '2034-01-02',
      days: 28,
      program,
      seniors: 4,
      juniors: 4,
      vacations,
      settings: { maxCallsPerResident: 9 },
      academicWeekday: 3,
      holidays: ['2034-01-25'],
      attendingEveryDay: true,
    });
    orgId = scenario.orgId;

    assert.equal(dayOfWeek(scenario.startKey), 1, 'scenario A must start on a Monday');
    assert.equal(scenario.academicDates.length, 4, 'scenario A must have one academic day per week');
    assert.equal(scenario.holidayDates.length, 1);

    const summary = await quiet(() => generateSchedule(scenario.blockId));
    const validation = await quiet(() => validateSchedule(scenario.blockId));
    const metrics = await quiet(() => collectMetrics(scenario));

    assertNoHardViolations('A', validation);
    assertNoConsecutiveCalls('A', metrics);
    assertVacationRespected('A', metrics, vacations);
    assertWeekendRules('A', scenario, metrics, program);
    assertParoMaximums('A', scenario, metrics, vacations, 9);
    assertBalanced('A', metrics, 2);
    assertEveryGapExplained('A', summary, metrics);

    // Academic days and the holiday must stay clear of generated call.
    for (const dateKey of [...scenario.academicDates, ...scenario.holidayDates]) {
      const onDay = metrics.rows.filter(row => row.dates.includes(dateKey));
      assert.equal(onDay.length, 0, `A: ${dateKey} is an academic day or holiday and must carry no generated call`);
    }

    // Every resident must carry a share of the work.
    for (const row of metrics.rows) {
      assert.ok(row.calls > 0, `A: ${row.name} received no call at all`);
    }

    const totalSlots = scenario.coverableDateKeys.length * 2;
    const filled = totalSlots - metrics.unfilledSlots.length;
    assert.ok(
      filled / totalSlots >= 0.8,
      `A: only ${filled}/${totalSlots} slots filled; a normal block should be mostly covered`,
    );

    reportMetrics('A', scenario, metrics);
    record('A', 'normal 28-day block', `${filled}/${totalSlots} slots filled, compliant, spread <= 2`);
  } finally {
    await destroyScenario(orgId);
  }
}

// ---------------------------------------------------------------------------
// Scenario B - a roster that genuinely cannot cover the block
// ---------------------------------------------------------------------------

async function scenarioB() {
  const vacations = {
    'Senior 1': [['2034-01-09', '2034-01-20']],
    'Senior 2': [['2034-01-14', '2034-01-25']],
    'Junior 1': [['2034-01-09', '2034-01-20']],
  };
  const program = { juniorInHouseCall: true, seniorInHouseCall: false };
  let orgId;
  try {
    const scenario = await buildScenario({
      tag: makeTag('B'),
      startKey: '2034-01-02',
      days: 28,
      program,
      seniors: 2,
      juniors: 2,
      vacations,
      academicWeekday: 3,
      holidays: ['2034-01-25'],
      attendingEveryDay: true,
    });
    orgId = scenario.orgId;

    const summary = await quiet(() => generateSchedule(scenario.blockId));
    const validation = await quiet(() => validateSchedule(scenario.blockId));
    const metrics = await quiet(() => collectMetrics(scenario));

    // The point of this scenario: under-staffing must produce gaps, never
    // rule-breaking.
    assert.ok(metrics.unfilledSlots.length > 0, 'B: an under-staffed block must leave slots unassigned');
    assertNoHardViolations('B', validation);
    assertNoConsecutiveCalls('B', metrics);
    assertVacationRespected('B', metrics, vacations);
    assertWeekendRules('B', scenario, metrics, program);
    assertParoMaximums('B', scenario, metrics, vacations, 9);
    assertEveryGapExplained('B', summary, metrics);

    // The validator must agree with the state the generator left behind.
    assert.equal(
      validation.compliant, true,
      'B: the validator must agree the stored under-staffed schedule breaks no hard rule',
    );
    const unassignedInValidator = validation.days
      .filter(day => !day.isHoliday && !day.isAcademicDay && (!day.seniorAssigned || !day.juniorAssigned))
      .map(day => day.date);
    for (const slot of metrics.unfilledSlots) {
      assert.ok(
        unassignedInValidator.includes(slot.date),
        `B: validator must also report ${slot.date} as uncovered`,
      );
    }

    const constraintNames = new Set();
    for (const item of summary.warnings) {
      const match = /\(([^)]+)\)$/.exec(item.message ?? '');
      if (!match) continue;
      for (const part of match[1].split(', ')) constraintNames.add(part.split('(')[0].split(':')[0].trim());
    }
    assert.ok(constraintNames.size > 0, 'B: the summary must name which constraints are binding');

    reportMetrics('B', scenario, metrics);
    record('B', 'constrained roster', `${metrics.unfilledSlots.length} slots left open, 0 violations, binding constraints: ${[...constraintNames].join(', ')}`);
  } finally {
    await destroyScenario(orgId);
  }
}

// ---------------------------------------------------------------------------
// Scenario C - a deliberate manual exception through the real API
// ---------------------------------------------------------------------------

async function scenarioC(app) {
  let orgId;
  let server;
  try {
    const scenario = await buildScenario({
      tag: makeTag('C'),
      startKey: '2034-01-02',
      days: 28,
      seniors: 4,
      juniors: 4,
      academicWeekday: 3,
      attendingEveryDay: true,
    });
    orgId = scenario.orgId;

    const chief = await prisma.user.create({
      data: {
        name: `${scenario.tag}_CHIEF`,
        email: `${scenario.tag.toLowerCase()}-chief@example.invalid`,
        passwordHash: await bcrypt.hash('AcceptanceHarness_123!', 10),
        orgId: scenario.orgId,
      },
    });
    await prisma.programMember.create({
      data: { programId: scenario.programId, userId: chief.id, role: 'chief_resident' },
    });
    const token = jwt.sign({ userId: chief.id, email: chief.email }, process.env.JWT_SECRET, { expiresIn: '1h' });

    await quiet(() => generateSchedule(scenario.blockId));
    const beforeValidation = await quiet(() => validateSchedule(scenario.blockId));
    assertNoHardViolations('C', beforeValidation);

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    const request = async (path, options = {}) => {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
      });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      return { status: response.status, body };
    };

    // Find a resident already on call and put them on call the very next day.
    const metricsBefore = await quiet(() => collectMetrics(scenario));
    const victim = metricsBefore.rows.find(row => row.role === 'senior' && row.dates.length > 0);
    const anchorDate = victim.dates[0];
    const violatingDate = addDaysToDateKey(anchorDate, 1);
    const victimResident = scenario.residents.find(r => r.name === victim.name);
    assert.ok(
      !scenario.academicDates.includes(violatingDate) && !scenario.holidayDates.includes(violatingDate),
      'C: the chosen violation date must be a normal working day',
    );

    // 1. The first request must refuse and ask for confirmation.
    const firstAttempt = await request('/assignments/day', {
      method: 'PUT',
      body: JSON.stringify({ blockId: scenario.blockId, date: violatingDate, seniorId: victimResident.id }),
    });
    assert.equal(firstAttempt.status, 409, `C: a violating edit must ask for confirmation, got ${firstAttempt.status}`);
    assert.equal(firstAttempt.body.requiresOverrideConfirmation, true);
    assert.ok(
      firstAttempt.body.violations.some(v => v.code === 'CONSECUTIVE_CALL'),
      `C: the confirmation must name the rule being broken, got ${firstAttempt.body.violations.map(v => v.code).join(', ')}`,
    );

    // 2. Confirming without a reason must still be refused.
    const noReason = await request('/assignments/day', {
      method: 'PUT',
      body: JSON.stringify({ blockId: scenario.blockId, date: violatingDate, seniorId: victimResident.id, confirmOverride: true }),
    });
    assert.equal(noReason.status, 400, 'C: confirming a violation without a reason must be refused');

    // 3. Confirming with a reason must save.
    const reason = 'Coverage exception agreed with the program.';
    const saved = await request('/assignments/day', {
      method: 'PUT',
      body: JSON.stringify({
        blockId: scenario.blockId, date: violatingDate, seniorId: victimResident.id,
        confirmOverride: true, overrideReason: reason,
      }),
    });
    assert.equal(saved.status, 200, `C: a confirmed and documented override must save, got ${JSON.stringify(saved.body)}`);

    // 4. Validation must surface it as a documented override, not a silent error.
    const afterValidation = await quiet(() => validateSchedule(scenario.blockId));
    const documented = afterValidation.violations.find(
      v => v.code === 'CONSECUTIVE_CALL' && v.residentId === victimResident.id,
    );
    assert.ok(documented, 'C: the deliberate violation must remain visible to validation');
    assert.equal(documented.isOverride, true, 'C: the violation must be marked as a manual override');
    assert.ok(documented.overrideReasons.includes(reason), 'C: the documented reason must be carried through');

    // 5. Regenerating must not quietly erase the override.
    const regenerated = await quiet(() => generateSchedule(scenario.blockId));
    const stillThere = await prisma.callAssignment.findFirst({
      where: {
        residentId: victimResident.id,
        isOverride: true,
        callDay: { blockId: scenario.blockId, date: new Date(`${violatingDate}T00:00:00.000Z`) },
      },
    });
    assert.ok(stillThere, 'C: regeneration must preserve a documented manual override');
    assert.equal(stillThere.overrideReason, reason, 'C: the override reason must survive regeneration');
    assert.ok(
      regenerated.warnings.some(w => w.code === 'CONSECUTIVE_CALL' && /Manual override/.test(w.message ?? '')),
      'C: regeneration must report the surviving override as a warning',
    );

    record('C', 'manual exception', 'confirmation required, reason enforced, override survives regeneration and stays visible');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await destroyScenario(orgId);
  }
}

// ---------------------------------------------------------------------------
// Scenario D - program call-type settings
// ---------------------------------------------------------------------------

async function scenarioD() {
  const variants = [
    { label: 'junior in-house ON / senior in-house OFF', juniorInHouseCall: true, seniorInHouseCall: false },
    { label: 'junior OFF / senior OFF', juniorInHouseCall: false, seniorInHouseCall: false },
    { label: 'junior ON / senior ON', juniorInHouseCall: true, seniorInHouseCall: true },
  ];

  for (const variant of variants) {
    let orgId;
    try {
      const program = { juniorInHouseCall: variant.juniorInHouseCall, seniorInHouseCall: variant.seniorInHouseCall };
      const scenario = await buildScenario({
        tag: makeTag('D'),
        startKey: '2034-01-02',
        days: 28,
        program,
        seniors: 4,
        juniors: 4,
        academicWeekday: 3,
        attendingEveryDay: true,
      });
      orgId = scenario.orgId;

      await quiet(() => generateSchedule(scenario.blockId));
      const validation = await quiet(() => validateSchedule(scenario.blockId));
      const metrics = await quiet(() => collectMetrics(scenario));

      assertNoHardViolations(`D[${variant.label}]`, validation);
      assertWeekendRules(`D[${variant.label}]`, scenario, metrics, program);
      assertParoMaximums(`D[${variant.label}]`, scenario, metrics, {}, 9);

      // Each role's calls must be counted as the configured call type, and be
      // measured against the matching PARO ceiling.
      for (const row of metrics.rows) {
        if (row.calls === 0) continue;
        const expectInHouse = row.role === 'senior' ? variant.seniorInHouseCall : variant.juniorInHouseCall;
        if (expectInHouse) {
          assert.equal(row.homeCalls, 0, `D[${variant.label}]: ${row.name} must have no home calls`);
          assert.equal(row.inHouseCalls, row.calls, `D[${variant.label}]: every ${row.role} call must count as in-house`);
          assert.equal(row.weightedBurden, 4 * row.calls, `D[${variant.label}]: in-house call must weigh 4 points`);
        } else {
          assert.equal(row.inHouseCalls, 0, `D[${variant.label}]: ${row.name} must have no in-house calls`);
          assert.equal(row.homeCalls, row.calls, `D[${variant.label}]: every ${row.role} call must count as home call`);
          assert.equal(row.weightedBurden, 3 * row.calls, `D[${variant.label}]: home call must weigh 3 points`);
        }

        const daysOnService = calculateDaysOnService(scenario.blockDateKeys, []);
        const ceiling = expectInHouse ? getInHouseMax(daysOnService) : getHomeCallMax(daysOnService);
        assert.ok(
          row.calls <= ceiling,
          `D[${variant.label}]: ${row.name} has ${row.calls} calls over the ${expectInHouse ? 'in-house' : 'home-call'} max of ${ceiling}`,
        );
      }

      // Home call carries the consecutive-weekend restriction; in-house does not.
      const homeCallRoles = metrics.rows.filter(row => row.homeCalls > 0);
      for (const row of homeCallRoles) {
        const weekends = [...new Set(row.dates.filter(isFridaySaturdaySunday).map(getWeekendKey))].sort();
        for (let index = 1; index < weekends.length; index += 1) {
          assert.notEqual(
            weekends[index - 1], addDaysToDateKey(weekends[index], -7),
            `D[${variant.label}]: ${row.name} has home call on consecutive weekends`,
          );
        }
      }

      reportMetrics(`D[${variant.label}]`, scenario, metrics);
      record('D', variant.label, 'call type, weighting and ceiling all follow the program setting');
    } finally {
      await destroyScenario(orgId);
    }
  }
}

// ---------------------------------------------------------------------------
// Scenario E - a resident with no block availability
// ---------------------------------------------------------------------------

async function scenarioE() {
  let orgId;
  try {
    const scenario = await buildScenario({
      tag: makeTag('E'),
      startKey: '2034-01-02',
      days: 28,
      seniors: 3,
      juniors: 3,
      unenrolled: ['Junior 3'],
      academicWeekday: 3,
      attendingEveryDay: true,
    });
    orgId = scenario.orgId;
    const excluded = scenario.residentByName.get('Junior 3');

    const summary = await quiet(() => generateSchedule(scenario.blockId));
    const validation = await quiet(() => validateSchedule(scenario.blockId));
    const metrics = await quiet(() => collectMetrics(scenario));

    // 1. Silence is not allowed: no calls, and a warning that names the person
    //    and the fix.
    const excludedRow = metrics.rows.find(row => row.name === 'Junior 3');
    assert.equal(excludedRow.calls, 0, 'E: a resident with no block availability must not be scheduled');

    const warningItem = summary.warnings.find(
      item => item.code === 'MISSING_RESIDENT_AVAILABILITY' && item.residentId === excluded.id,
    );
    assert.ok(warningItem, 'E: the missing resident must produce a warning');
    assert.ok(warningItem.residentName && warningItem.message.includes(warningItem.residentName), 'E: the warning must name the resident');
    assert.ok(warningItem.action && warningItem.action.length > 0, 'E: the warning must say what to do about it');
    assert.ok(
      summary.excludedResidents.some(item => item.residentId === excluded.id),
      'E: the summary must list the excluded resident explicitly',
    );
    assert.equal(summary.availabilityComplete, false, 'E: the summary must report availability as incomplete');
    assert.ok(
      validation.warnings.some(w => w.code === 'MISSING_RESIDENT_AVAILABILITY' && w.residentId === excluded.id),
      'E: validation must raise the same actionable warning',
    );
    assertNoHardViolations('E', validation);

    // 2. Supplying valid block availability must make them schedulable.
    await prisma.blockEnrollment.update({
      where: { blockId_residentId: { blockId: scenario.blockId, residentId: excluded.id } },
      data: { availabilityConfirmed: true },
    });
    await prisma.callAssignment.deleteMany({
      where: { callDay: { blockId: scenario.blockId }, isOverride: false },
    });

    const afterSummary = await quiet(() => generateSchedule(scenario.blockId));
    const afterMetrics = await quiet(() => collectMetrics(scenario));
    const afterValidation = await quiet(() => validateSchedule(scenario.blockId));

    assert.equal(afterSummary.availabilityComplete, true, 'E: availability must read complete once enrollment exists');
    assert.equal(afterSummary.excludedResidents.length, 0, 'E: nobody should remain excluded');
    assert.ok(
      !afterSummary.warnings.some(w => w.code === 'MISSING_RESIDENT_AVAILABILITY'),
      'E: the missing-availability warning must clear',
    );
    const afterRow = afterMetrics.rows.find(row => row.name === 'Junior 3');
    assert.ok(afterRow.calls > 0, 'E: the resident must become schedulable once availability is supplied');
    assertNoHardViolations('E after enrollment', afterValidation);

    record('E', 'missing availability', `excluded with an actionable warning, then scheduled ${afterRow.calls} calls once availability was supplied`);
  } finally {
    await destroyScenario(orgId);
  }
}

async function main() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
  // Required lazily: loading the app opens the express router stack.
  const app = require('../index');

  await scenarioA();
  await scenarioB();
  await scenarioC(app);
  await scenarioD();
  await scenarioE();

  realLog('');
  for (const item of results) {
    realLog(`  [${item.scenario}] ${item.name}: ${item.detail}`);
  }
  realLog(`[scheduler-acceptance] ${results.length} scenario checks passed`);
}

main()
  .catch(error => {
    console.log = realLog;
    console.error('[scheduler-acceptance] failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
