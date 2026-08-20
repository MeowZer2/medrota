-- Program-defined clinical services, attending activities, and Chief Resident permissions.
CREATE TABLE "ProgramService" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProgramService_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendingActivityType" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendingActivityType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProgramRolePermission" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProgramRolePermission_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AttendingRoster"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "officeLocation" TEXT,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "AttendingEntry" ADD COLUMN "activityTypeId" TEXT;
ALTER TABLE "AttendingScheduleTemplate" ADD COLUMN "activityTypeId" TEXT;

CREATE UNIQUE INDEX "ProgramService_programId_normalizedName_key" ON "ProgramService"("programId", "normalizedName");
CREATE INDEX "ProgramService_programId_isActive_sortOrder_idx" ON "ProgramService"("programId", "isActive", "sortOrder");
CREATE UNIQUE INDEX "AttendingActivityType_programId_normalizedName_key" ON "AttendingActivityType"("programId", "normalizedName");
CREATE INDEX "AttendingActivityType_programId_isActive_sortOrder_idx" ON "AttendingActivityType"("programId", "isActive", "sortOrder");
CREATE UNIQUE INDEX "ProgramRolePermission_programId_role_permission_key" ON "ProgramRolePermission"("programId", "role", "permission");
CREATE INDEX "ProgramRolePermission_programId_role_idx" ON "ProgramRolePermission"("programId", "role");
CREATE INDEX "AttendingEntry_activityTypeId_idx" ON "AttendingEntry"("activityTypeId");
CREATE INDEX "AttendingScheduleTemplate_activityTypeId_idx" ON "AttendingScheduleTemplate"("activityTypeId");

ALTER TABLE "ProgramService" ADD CONSTRAINT "ProgramService_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendingActivityType" ADD CONSTRAINT "AttendingActivityType_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProgramRolePermission" ADD CONSTRAINT "ProgramRolePermission_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendingEntry" ADD CONSTRAINT "AttendingEntry_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "AttendingActivityType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AttendingScheduleTemplate" ADD CONSTRAINT "AttendingScheduleTemplate_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "AttendingActivityType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Import every distinct historical activity label without changing the original text.
WITH labels AS (
  SELECT ay."programId", btrim(ae."activityLabel") AS name
  FROM "AttendingEntry" ae
  JOIN "Block" b ON b."id" = ae."blockId"
  JOIN "AcademicYear" ay ON ay."id" = b."academicYearId"
  WHERE btrim(ae."activityLabel") <> ''
  UNION
  SELECT ast."programId", btrim(ast."activityLabel") AS name
  FROM "AttendingScheduleTemplate" ast
  WHERE btrim(ast."activityLabel") <> ''
  UNION
  SELECT ar."programId", btrim(activity) AS name
  FROM "AttendingRoster" ar, unnest(ar."typicalActivities") AS activity
  WHERE btrim(activity) <> ''
), ranked AS (
  SELECT DISTINCT ON ("programId", lower(regexp_replace(name, '\s+', ' ', 'g')))
    "programId", name, lower(regexp_replace(name, '\s+', ' ', 'g')) AS normalized
  FROM labels
  ORDER BY "programId", lower(regexp_replace(name, '\s+', ' ', 'g')), name
)
INSERT INTO "AttendingActivityType" ("id", "programId", "name", "normalizedName", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "programId", name, normalized,
       row_number() OVER (PARTITION BY "programId" ORDER BY name) - 1,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM ranked;

UPDATE "AttendingEntry" ae
SET "activityTypeId" = aat."id"
FROM "Block" b, "AcademicYear" ay, "AttendingActivityType" aat
WHERE b."id" = ae."blockId"
  AND ay."id" = b."academicYearId"
  AND aat."programId" = ay."programId"
  AND aat."normalizedName" = lower(regexp_replace(btrim(ae."activityLabel"), '\s+', ' ', 'g'));

UPDATE "AttendingScheduleTemplate" ast
SET "activityTypeId" = aat."id"
FROM "AttendingActivityType" aat
WHERE aat."programId" = ast."programId"
  AND aat."normalizedName" = lower(regexp_replace(btrim(ast."activityLabel"), '\s+', ' ', 'g'));
