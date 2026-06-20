ALTER TABLE "User" ADD COLUMN "category" TEXT;
ALTER TABLE "User" ADD COLUMN "clinicalIdentity" TEXT;
ALTER TABLE "User" ADD COLUMN "desiredRole" TEXT;
ALTER TABLE "User" ADD COLUMN "homeSpecialty" TEXT;

UPDATE "ProgramMember"
SET "role" = CASE
  WHEN lower("role") = 'coordinator' THEN 'program_director'
  WHEN lower("role") = 'admin' THEN 'program_admin'
  WHEN lower("role") = 'builder' THEN 'chief_resident'
  WHEN lower("role") = 'editor' THEN 'chief_resident'
  WHEN lower("role") = 'viewer' THEN 'viewer'
  WHEN lower("role") IN ('chief_resident', 'program_admin', 'program_director') THEN lower("role")
  ELSE 'viewer'
END;

UPDATE "Invite"
SET "role" = CASE
  WHEN lower("role") = 'coordinator' THEN 'program_director'
  WHEN lower("role") = 'admin' THEN 'program_admin'
  WHEN lower("role") = 'builder' THEN 'chief_resident'
  WHEN lower("role") = 'editor' THEN 'chief_resident'
  WHEN lower("role") = 'viewer' THEN 'viewer'
  WHEN lower("role") IN ('chief_resident', 'program_admin', 'program_director') THEN lower("role")
  ELSE 'viewer'
END;

WITH programs_without_admin AS (
  SELECT pm."programId", MIN(pm."createdAt") AS first_created_at
  FROM "ProgramMember" pm
  GROUP BY pm."programId"
  HAVING SUM(CASE WHEN pm."role" = 'program_admin' THEN 1 ELSE 0 END) = 0
)
UPDATE "ProgramMember" pm
SET "role" = 'program_admin'
FROM programs_without_admin pwa
WHERE pm."programId" = pwa."programId"
  AND pm."createdAt" = pwa.first_created_at;
