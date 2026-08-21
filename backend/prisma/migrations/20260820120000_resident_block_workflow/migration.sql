-- Additive resident lifecycle and block-composition fields. Existing manual
-- PGY, residentRole, academicDayPref, enrollments, and assignments are kept.
ALTER TABLE "Program"
ADD COLUMN "juniorPgyLevels" INTEGER[] NOT NULL DEFAULT ARRAY[1, 2]::INTEGER[];

ALTER TABLE "ResidentProfile"
ADD COLUMN "phone" TEXT,
ADD COLUMN "homeProgram" TEXT,
ADD COLUMN "programStartDate" TIMESTAMP(3),
ADD COLUMN "expectedCompletionDate" TIMESTAMP(3),
ADD COLUMN "residentRoleOverride" TEXT;

ALTER TABLE "BlockEnrollment"
ADD COLUMN "academicTimes" JSONB,
ADD COLUMN "otherUnavailableDates" TIMESTAMP(3)[] NOT NULL DEFAULT ARRAY[]::TIMESTAMP(3)[],
ADD COLUMN "autoEnrolled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "availabilityConfirmed" BOOLEAN NOT NULL DEFAULT false;

-- Existing enrollment rows were already the source of truth for availability.
UPDATE "BlockEnrollment" SET "availabilityConfirmed" = true;

CREATE INDEX "ResidentProfile_programId_programStartDate_expectedCompletionDate_idx"
ON "ResidentProfile"("programId", "programStartDate", "expectedCompletionDate");
