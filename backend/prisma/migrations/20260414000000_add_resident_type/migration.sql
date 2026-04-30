-- AlterTable: add isServiceResident and isActive to ResidentProfile
-- All existing residents default to service residents (true) and active (true)
ALTER TABLE "ResidentProfile" ADD COLUMN "isServiceResident" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ResidentProfile" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
