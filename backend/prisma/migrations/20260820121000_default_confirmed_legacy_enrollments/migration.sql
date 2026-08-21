-- New application-created legacy-style enrollments remain confirmed unless an
-- automatic or block-roster workflow explicitly marks them incomplete.
ALTER TABLE "BlockEnrollment"
ALTER COLUMN "availabilityConfirmed" SET DEFAULT true;
