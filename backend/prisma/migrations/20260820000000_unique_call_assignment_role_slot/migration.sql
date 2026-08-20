-- Enforce one resident per role slot per call day.
--
-- Legacy duplicate (callDayId, roleOnDay) rows were classified and repaired by
-- scripts/data-integrity-repair.js before this migration. The guard below makes
-- the migration fail with an actionable message instead of a bare constraint
-- violation if any database still carries unresolved duplicates.
DO $$
DECLARE
  duplicate_groups INT;
BEGIN
  SELECT COUNT(*) INTO duplicate_groups
  FROM (
    SELECT 1
    FROM "CallAssignment"
    GROUP BY "callDayId", "roleOnDay"
    HAVING COUNT(*) > 1
  ) AS d;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce UNIQUE(callDayId, roleOnDay): % duplicate role-slot group(s) remain. Run "npm run data:integrity-audit" to review them and "MEDROTA_CONFIRM_REPAIR=yes npm run data:integrity-repair" to resolve the deterministic ones first.',
      duplicate_groups;
  END IF;
END
$$;

CREATE UNIQUE INDEX "CallAssignment_callDayId_roleOnDay_key"
  ON "CallAssignment"("callDayId", "roleOnDay");
