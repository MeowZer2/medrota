-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "orgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramMember" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicYear" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademicYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicHoliday" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "PublicHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResidentProfile" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pgyLevel" INTEGER NOT NULL,
    "residentRole" TEXT NOT NULL,
    "isMedStudent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResidentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockEnrollment" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "vacationDates" TIMESTAMP(3)[],
    "academicDayPref" TEXT,
    "callCapOverride" INTEGER,

    CONSTRAINT "BlockEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockSettings" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "allowWeekendConsecutive" BOOLEAN NOT NULL DEFAULT false,
    "allowAttendingOnlyDays" BOOLEAN NOT NULL DEFAULT false,
    "avoidAcademicDays" BOOLEAN NOT NULL DEFAULT true,
    "maxCallsPerResident" INTEGER NOT NULL DEFAULT 9,
    "maxCallsMedStudent" INTEGER NOT NULL DEFAULT 5,

    CONSTRAINT "BlockSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendingEntry" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "attendingName" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "activityLabel" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "AttendingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallDay" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "isHoliday" BOOLEAN NOT NULL DEFAULT false,
    "holidayName" TEXT,
    "attendingEntryId" TEXT,

    CONSTRAINT "CallDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallAssignment" (
    "id" TEXT NOT NULL,
    "callDayId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "roleOnDay" TEXT NOT NULL,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "BlockSettings_blockId_key" ON "BlockSettings"("blockId");

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramMember" ADD CONSTRAINT "ProgramMember_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramMember" ADD CONSTRAINT "ProgramMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicYear" ADD CONSTRAINT "AcademicYear_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicHoliday" ADD CONSTRAINT "PublicHoliday_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentProfile" ADD CONSTRAINT "ResidentProfile_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockEnrollment" ADD CONSTRAINT "BlockEnrollment_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockEnrollment" ADD CONSTRAINT "BlockEnrollment_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "ResidentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockSettings" ADD CONSTRAINT "BlockSettings_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendingEntry" ADD CONSTRAINT "AttendingEntry_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallDay" ADD CONSTRAINT "CallDay_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallDay" ADD CONSTRAINT "CallDay_attendingEntryId_fkey" FOREIGN KEY ("attendingEntryId") REFERENCES "AttendingEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallAssignment" ADD CONSTRAINT "CallAssignment_callDayId_fkey" FOREIGN KEY ("callDayId") REFERENCES "CallDay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallAssignment" ADD CONSTRAINT "CallAssignment_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "ResidentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
