/**
 * MedRota Auto-Scheduler
 *
 * Constraint-satisfaction scheduling engine.
 * Clears non-override assignments for a block, then fills every day
 * with the most-eligible senior + junior using round-robin fairness.
 *
 * Phase 1: assign seniors + regular juniors (med students excluded)
 * Phase 2: assign med students as observers to days with a senior present
 */

const prisma = require('../lib/prisma');

// ── helpers ────────────────────────────────────────────────────────────────────

function toISO(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function startOfLogicalDay(value) {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isWeekday(dow) { return dow >= 1 && dow <= 5; }

/**
 * Returns the weekend-group key for a date.
 * Friday/Saturday/Sunday of the same calendar weekend share the same key.
 * Sunday is grouped with the PREVIOUS Saturday to keep Fri+Sat+Sun together
 * (ISO week numbering can split Sun into the next week, so we correct for that).
 */
function getWeekKey(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  // If Sunday, shift to the previous day (Saturday) before computing the week key
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1);
  // Standard ISO week number (Monday = start of week)
  const dow = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dow); // shift to Thursday (ISO week anchor)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Build fresh weekend-state object for a resident (reset each scheduler run). */
function makeWeekendState() {
  return {
    weekendGroups: new Set(), // week group keys where resident has ANY weekend call
    fridayWeeks:   new Set(), // week groups where resident has Friday
    saturdayWeeks: new Set(), // week groups where resident has Saturday
    sundayWeeks:   new Set(), // week groups where resident has Sunday
  };
}

// ── core ───────────────────────────────────────────────────────────────────────

async function generateSchedule(blockId) {
  // ── Load block + settings + holidays + enrollments ───────────────────────────
  const block = await prisma.block.findUnique({
    where: { id: blockId },
    include: {
      settings: true,
      academicYear: { include: { holidays: true, program: true } },
      enrollments: { include: { resident: true } },
      flags: true,
    },
  });

  if (!block) throw new Error(`Block ${blockId} not found`);

  console.log(`[scheduler] blockId=${blockId} number=${block.number}`);
  console.log(`[scheduler] startDate=${toISO(new Date(block.startDate))} endDate=${toISO(new Date(block.endDate))}`);
  console.log(`[scheduler] BlockEnrollment count: ${block.enrollments.length}`);

  const cfg = {
    maxCallsPerResident:     block.settings?.maxCallsPerResident    ?? 9,
    maxCallsMedStudent:      block.settings?.maxCallsMedStudent      ?? 5,
    allowWeekendConsecutive: block.settings?.allowWeekendConsecutive ?? false,
    avoidAcademicDays:       block.settings?.avoidAcademicDays       ?? true,
    limitWeekendCalls:       block.settings?.limitWeekendCalls       ?? true,
  };

  console.log(`[scheduler] block=${blockId} cfg=${JSON.stringify(cfg)}`);

  const holidaySet = new Set(
    block.academicYear.holidays.map(h => toISO(new Date(h.date)))
  );
  const academicDaySet = new Set(
    (block.flags ?? [])
      .filter(f => /academic/i.test(f.label ?? ''))
      .map(f => toISO(new Date(f.date)))
  );

  // ── Build resident state ──────────────────────────────────────────────────────
  const programId = block.academicYear?.program?.id;
  const activeServiceResidents = programId
    ? await prisma.residentProfile.findMany({
        where: { programId, isActive: true, isServiceResident: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  const enrollmentByResidentId = new Map();

  // Explicit enrollments carry block-specific data and include off-service
  // residents and med students. If present, these values must win.
  for (const enrollment of block.enrollments) {
    enrollmentByResidentId.set(enrollment.resident.id, enrollment);
  }

  // Service residents are program-level participants and often do not have
  // BlockEnrollment rows unless they have vacations or overrides for this block.
  for (const resident of activeServiceResidents) {
    if (!enrollmentByResidentId.has(resident.id)) {
      enrollmentByResidentId.set(resident.id, {
        resident,
        vacationDates: [],
        academicDayPref: null,
        callCapOverride: null,
      });
    }
  }

  const enrollmentSource = [...enrollmentByResidentId.values()];
  const usedFallback = enrollmentSource.length > block.enrollments.length;

  console.log(`[scheduler] active service residents: ${activeServiceResidents.length}`);
  console.log(`[scheduler] merged resident pool: ${enrollmentSource.length}`);

  const residents = enrollmentSource.map(e => {
    const defaultMax = e.resident.isMedStudent ? cfg.maxCallsMedStudent : cfg.maxCallsPerResident;
    const maxCalls   = e.callCapOverride ?? defaultMax;

    const vacationSet = new Set(
      (e.vacationDates ?? []).map(d => toISO(new Date(d)))
    );

    return {
      id:           e.resident.id,
      name:         e.resident.name,
      role:         e.resident.residentRole, // 'senior' | 'junior'
      isMedStudent: e.resident.isMedStudent,
      maxCalls,
      vacationSet,
      assigned:     new Set(), // ISO dates assigned
      weekendState: makeWeekendState(),
      callCount:    0,
    };
  });

  console.log(`[scheduler] loaded ${residents.length} residents (fallback=${usedFallback}):`);
  residents.forEach(r =>
    console.log(`  ${r.name} role=${r.role} isMedStudent=${r.isMedStudent} maxCalls=${r.maxCalls} vacationDays=${r.vacationSet.size}`)
  );

  // Separate med students from regular residents for phase 1 vs phase 2
  const regularResidents = residents.filter(r => !r.isMedStudent);
  const medStudents       = residents.filter(r => r.isMedStudent);

  // ── Weekend eligibility check ─────────────────────────────────────────────────

  /**
   * Returns true if a resident is allowed a weekend call on this day.
   *
   * Constraints:
   *   Hard limit: max 2 different weekend groups per block (both modes)
   *
   *   Consecutive mode:
   *     - May only use ONE weekend group (no second weekend allowed)
   *     - Cannot have all 3 days of that weekend already
   *
   *   Default mode (Fri+Sun one weekend, Sat another):
   *     - Max 1 Friday total
   *     - Max 1 Saturday total
   *     - Max 1 Sunday total
   */
  function isWeekendEligible(r, dow) {
    const ws = r.weekendState;

    // Hard limit: max 2 weekend groups per resident per block
    // (enforced below per-day check; here it is context for comment only)

    if (cfg.allowWeekendConsecutive) {
      // Consecutive mode: only 1 weekend group allowed
      if (ws.weekendGroups.size >= 1) {
        // They have a weekend group — this day must be in the SAME group
        // (the caller checks this via weekGroup; we reject if group differs)
        // All-3-days check: if they already have Fri+Sat+Sun in their group
        const [existingGroup] = ws.weekendGroups;
        if (ws.fridayWeeks.has(existingGroup) && ws.saturdayWeeks.has(existingGroup) && ws.sundayWeeks.has(existingGroup)) {
          return false; // complete weekend already
        }
      }
      return true;
    }

    // Default mode: max 1 of each day-type
    if (dow === 5 && ws.fridayWeeks.size  >= 1) return false;
    if (dow === 6 && ws.saturdayWeeks.size >= 1) return false;
    if (dow === 0 && ws.sundayWeeks.size  >= 1) return false;
    return true;
  }

  /**
   * Checks if a resident is eligible for a weekend day, respecting both
   * the max-2-groups hard limit AND the per-day-type constraints.
   * Returns { ok, reason }.
   */
  function checkWeekendState(r, day, dow) {
    const ws = r.weekendState;
    const wg = getWeekKey(day);

    // Hard limit: max 2 weekend groups per block
    if (ws.weekendGroups.size >= 2 && !ws.weekendGroups.has(wg)) {
      return { ok: false, reason: 'weekend-group-limit' };
    }

    if (cfg.allowWeekendConsecutive) {
      // Can only use one group; if they already have a different one, reject
      if (ws.weekendGroups.size === 1 && !ws.weekendGroups.has(wg)) {
        return { ok: false, reason: 'weekend-consecutive-different-group' };
      }
      if (!isWeekendEligible(r, dow)) {
        return { ok: false, reason: 'weekend-consecutive-complete' };
      }
      return { ok: true };
    }

    if (!isWeekendEligible(r, dow)) {
      const reasons = { 5: 'friday-taken', 6: 'saturday-taken', 0: 'sunday-taken' };
      return { ok: false, reason: reasons[dow] ?? 'weekend-limit' };
    }
    return { ok: true };
  }

  /** Update weekend state after a successful assignment. */
  function applyWeekendState(r, day, dow) {
    const ws = r.weekendState;
    const wg = getWeekKey(day);
    ws.weekendGroups.add(wg);
    if (dow === 5) ws.fridayWeeks.add(wg);
    if (dow === 6) ws.saturdayWeeks.add(wg);
    if (dow === 0) ws.sundayWeeks.add(wg);
  }

  // ── Full eligibility check ────────────────────────────────────────────────────

  function isEligible(r, day, ignoreWeekendState = false) {
    const iso = toISO(day);
    const dow = day.getUTCDay();

    if (r.vacationSet.has(iso))    return { ok: false, reason: 'vacation' };
    if (r.callCount >= r.maxCalls) return { ok: false, reason: `cap(${r.callCount}/${r.maxCalls})` };

    // No back-to-back weekday calls
    const prevDay = addDays(day, -1);
    const prevIso = toISO(prevDay);
    const prevDow = prevDay.getUTCDay();
    if (isWeekday(dow) && isWeekday(prevDow) && r.assigned.has(prevIso)) {
      return { ok: false, reason: 'back-to-back-weekday' };
    }

    // Weekend back-to-back (only applies in non-consecutive mode)
    if (!cfg.allowWeekendConsecutive) {
      if ((dow === 6 || dow === 0) && r.assigned.has(prevIso)) {
        return { ok: false, reason: 'weekend-consecutive' };
      }
    }

    // Weekend group / fulfilled checks
    if (cfg.limitWeekendCalls && (dow === 5 || dow === 6 || dow === 0)) {
      if (!ignoreWeekendState) {
        const wkCheck = checkWeekendState(r, day, dow);
        if (!wkCheck.ok) return wkCheck;
      }
    }

    return { ok: true };
  }

  // ── Generate day list ─────────────────────────────────────────────────────────
  const days = [];
  const cur = startOfLogicalDay(block.startDate);
  const end = startOfLogicalDay(block.endDate);
  while (cur <= end) {
    days.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  console.log(`[scheduler] block spans ${days.length} days (${toISO(days[0])} → ${toISO(days[days.length - 1])})`);

  const existingCallDays = await prisma.callDay.findMany({
    where: { blockId },
    include: {
      assignments: {
        where: { isOverride: true },
        include: { resident: true },
      },
    },
  });
  const overrideByIso = new Map();
  const residentById = new Map(residents.map(r => [r.id, r]));

  for (const callDay of existingCallDays) {
    const iso = toISO(new Date(callDay.date));
    const info = { callDay, hasSenior: false, hasJunior: false, assignments: callDay.assignments };

    for (const assignment of callDay.assignments) {
      if (assignment.roleOnDay === 'senior') info.hasSenior = true;
      if (assignment.roleOnDay === 'junior') info.hasJunior = true;

      const resident = residentById.get(assignment.residentId);
      if (resident) {
        resident.callCount++;
        resident.assigned.add(iso);
        const day = new Date(callDay.date);
        const dow = day.getUTCDay();
        if (dow === 5 || dow === 6 || dow === 0) applyWeekendState(resident, day, dow);
      }
    }

    if (callDay.assignments.length > 0) overrideByIso.set(iso, info);
  }

  // ── Phase 1: Assign seniors + regular juniors ─────────────────────────────────
  let assignedCount = 0;
  const warnings = [];

  // dayMap: iso → { callDayId, day, hasSenior, hasJunior }
  const dayMap = new Map();

  for (const day of days) {
    const iso       = toISO(day);
    const isHoliday = holidaySet.has(iso);
    const dow       = day.getUTCDay();
    const isWeekendDay = dow === 5 || dow === 6 || dow === 0;

    const overrideInfo = overrideByIso.get(iso);
    const callDay = overrideInfo?.callDay ?? await prisma.callDay.create({
      data: { blockId, date: day, isHoliday },
    });

    let dayHasSenior = overrideInfo?.hasSenior ?? false;
    let dayHasJunior = overrideInfo?.hasJunior ?? false;
    dayMap.set(iso, { callDayId: callDay.id, day, hasSenior: dayHasSenior, hasJunior: dayHasJunior });

    if (isHoliday) {
      if (dayHasSenior || dayHasJunior) assignedCount++;
      console.log(`[scheduler] ${iso} HOLIDAY — skipping`);
      continue;
    }

    if (cfg.avoidAcademicDays && academicDaySet.has(iso)) {
      warnings.push({ date: iso, message: 'Skipped academic day' });
      console.log(`[scheduler] ${iso} academic day - skipping`);
      continue;
    }

    // Sort eligible regular residents by call count (round-robin fairness)
    // For Saturdays: prefer residents who already have a Fri+Sun pair (they need their Sat)
    const eligibleRegular = (role, ignoreWeekend = false) => {
      const results = [];
      for (const r of regularResidents) {
        if (r.role !== role) continue;
        const check = isEligible(r, day, ignoreWeekend);
        if (check.ok) {
          results.push(r);
        } else {
          console.log(`  [skip] ${r.name} (${role}) on ${iso}: ${check.reason}`);
        }
      }
      return results.sort((a, b) => {
        // Saturday: prefer residents who already have a Friday assigned
        // (they pair Fri+Sun from one weekend, Sat from another)
        if (!ignoreWeekend && dow === 6) {
          const aPref = a.weekendState.fridayWeeks.size > 0 ? 0 : 1;
          const bPref = b.weekendState.fridayWeeks.size > 0 ? 0 : 1;
          if (aPref !== bPref) return aPref - bPref;
        }
        return a.callCount - b.callCount;
      });
    };

    const seniors = eligibleRegular('senior');
    const juniors = eligibleRegular('junior');

    console.log(`[scheduler] ${iso} — eligible seniors: [${seniors.map(r => r.name).join(', ')}] juniors: [${juniors.map(r => r.name).join(', ')}]`);

    // ── Assign senior ──────────────────────────────────────────────────────────
    let seniorCandidates = dayHasSenior ? [] : seniors;

    // Weekend fallback: if no eligible senior on a weekend due to weekend constraints,
    // pick the resident with fewest calls who is not on vacation
    if (!dayHasSenior && seniorCandidates.length === 0 && isWeekendDay) {
      const relaxed = regularResidents
        .filter(r => r.role === 'senior' && !r.vacationSet.has(iso) && r.callCount < r.maxCalls)
        .sort((a, b) => a.callCount - b.callCount);
      if (relaxed.length > 0) {
        const r = relaxed[0];
        await prisma.callAssignment.create({
          data: {
            callDayId:  callDay.id,
            residentId: r.id,
            roleOnDay:  'senior',
          },
        });
        r.callCount++;
        r.assigned.add(iso);
        applyWeekendState(r, day, dow);
        dayHasSenior = true;
        const msg = `Weekend constraint relaxed for ${iso} — all residents have fulfilled weekend duty`;
        warnings.push({ date: iso, message: msg });
        console.warn(`  ⚠ ${msg}: assigned senior ${r.name}`);
        seniorCandidates = []; // already assigned
      }
    }

    if (seniorCandidates.length > 0) {
      const s = seniorCandidates[0];
      await prisma.callAssignment.create({
        data: { callDayId: callDay.id, residentId: s.id, roleOnDay: 'senior' },
      });
      s.callCount++;
      s.assigned.add(iso);
      if (isWeekendDay) applyWeekendState(s, day, dow);
      dayHasSenior = true;
      console.log(`  → assigned senior: ${s.name} (calls now ${s.callCount})`);
    } else if (!dayHasSenior) {
      warnings.push({ date: iso, message: 'No eligible senior available' });
      console.warn(`  ⚠ No eligible senior on ${iso}`);
    }

    // ── Assign junior ──────────────────────────────────────────────────────────
    let juniorCandidates = dayHasJunior ? [] : juniors;

    // Weekend fallback: if no eligible junior on a weekend due to weekend constraints,
    // pick the resident with fewest calls who is not on vacation
    if (!dayHasJunior && juniorCandidates.length === 0 && isWeekendDay) {
      const relaxed = regularResidents
        .filter(r => r.role === 'junior' && !r.vacationSet.has(iso) && r.callCount < r.maxCalls)
        .sort((a, b) => a.callCount - b.callCount);
      if (relaxed.length > 0) {
        const r = relaxed[0];
        await prisma.callAssignment.create({
          data: {
            callDayId:  callDay.id,
            residentId: r.id,
            roleOnDay:  'junior',
          },
        });
        r.callCount++;
        r.assigned.add(iso);
        applyWeekendState(r, day, dow);
        dayHasJunior = true;
        const msg = `Weekend constraint relaxed for ${iso} — all residents have fulfilled weekend duty`;
        warnings.push({ date: iso, message: msg });
        console.warn(`  ⚠ ${msg}: assigned junior ${r.name}`);
        juniorCandidates = []; // already assigned
      }
    }

    if (juniorCandidates.length > 0) {
      const j = juniorCandidates[0];
      await prisma.callAssignment.create({
        data: { callDayId: callDay.id, residentId: j.id, roleOnDay: 'junior' },
      });
      j.callCount++;
      j.assigned.add(iso);
      if (isWeekendDay) applyWeekendState(j, day, dow);
      dayHasJunior = true;
      console.log(`  → assigned junior: ${j.name} (calls now ${j.callCount})`);
    } else if (!dayHasJunior) {
      warnings.push({ date: iso, message: 'No eligible junior available' });
      console.warn(`  ⚠ No eligible junior on ${iso}`);
    }

    if (dayHasSenior || dayHasJunior) assignedCount++;
    dayMap.get(iso).hasSenior = dayHasSenior;
    dayMap.get(iso).hasJunior = dayHasJunior;
  }

  // ── Phase 2: Assign med students as observers ─────────────────────────────────
  // Med students are assigned ONLY to days that have a senior present.
  // They do not count as junior coverage and are assigned AFTER all regular assignments.

  if (medStudents.length > 0) {
    console.log(`[scheduler] Phase 2: assigning ${medStudents.length} med student(s) as observers`);

    for (const [iso, info] of dayMap) {
      if (holidaySet.has(iso)) continue;
      if (!info.hasSenior) continue; // no senior — med student cannot observe

      if (info.hasJunior) continue;  // existing junior coverage, including overrides

      const day    = info.day;
      const prevIso = toISO(addDays(day, -1));

      const eligible = medStudents
        .filter(r => {
          if (r.vacationSet.has(iso))    return false;
          if (r.callCount >= r.maxCalls) return false;
          if (r.assigned.has(prevIso))   return false; // no back-to-back
          return true;
        })
        .sort((a, b) => a.callCount - b.callCount);

      if (eligible.length === 0) {
        console.log(`  [med-student] no eligible observer for ${iso}`);
        continue;
      }

      const ms = eligible[0];
      await prisma.callAssignment.create({
        data: { callDayId: info.callDayId, residentId: ms.id, roleOnDay: 'junior' },
      });
      ms.callCount++;
      ms.assigned.add(iso);
      console.log(`  [med-student] assigned observer ${ms.name} on ${iso} (calls now ${ms.callCount})`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  const workDays    = days.filter(d => !holidaySet.has(toISO(d))).length;
  const unassignedDates = [...dayMap.entries()]
    .filter(([iso, info]) => !holidaySet.has(iso) && !info.hasSenior && !info.hasJunior)
    .map(([iso]) => iso);
  const callSummary = residents
    .map(r => ({ name: r.name, role: r.role, isMedStudent: r.isMedStudent, calls: r.callCount }))
    .sort((a, b) => b.calls - a.calls);

  console.log(`[scheduler] done — assigned=${assignedCount}/${workDays} warnings=${warnings.length}`);
  console.log('[scheduler] call summary:', callSummary.map(r => `${r.name}(${r.calls})`).join(', '));

  // ── Weekend call audit log ────────────────────────────────────────────────────
  console.log('[scheduler] weekend audit:');
  for (const r of regularResidents) {
    const ws = r.weekendState;
    const parts = [];
    for (const wg of [...ws.weekendGroups].sort()) {
      // Extract just the week number for a readable label
      const wkNum = wg.split('-W')[1];
      const days_ = [];
      if (ws.fridayWeeks.has(wg))   days_.push(`Fri`);
      if (ws.saturdayWeeks.has(wg)) days_.push(`Sat`);
      if (ws.sundayWeeks.has(wg))   days_.push(`Sun`);
      if (days_.length > 0) parts.push(`${days_.join('+')} wk${wkNum}`);
    }
    const weekCount = ws.weekendGroups.size;
    const status    = weekCount <= 2 ? '✓' : '⚠ over limit';
    console.log(`  ${r.name}: ${parts.join(', ') || '(no weekend calls)'} — ${weekCount} weekend${weekCount !== 1 ? 's' : ''} ${status}`);
  }

  return {
    totalDays:   days.length,
    workDays,
    assigned:    assignedCount,
    unassigned:  unassignedDates.length,
    unassignedDates,
    warnings,
    callSummary,
    usedFallback,
  };
}

// ── clear ──────────────────────────────────────────────────────────────────────

async function clearSchedule(blockId) {
  const callDays = await prisma.callDay.findMany({ where: { blockId } });
  const callDayIds = callDays.map(d => d.id);
  if (callDayIds.length > 0) {
    await prisma.callAssignment.deleteMany({ where: { callDayId: { in: callDayIds }, isOverride: false } });
  }
  const { count } = await prisma.callDay.deleteMany({ where: { blockId, assignments: { none: {} } } });
  return { cleared: count };
}

module.exports = { generateSchedule, clearSchedule };
