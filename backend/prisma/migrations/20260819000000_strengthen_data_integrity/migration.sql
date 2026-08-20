-- Safe logical uniqueness constraints. Duplicate diagnostics were run before
-- this migration; the legacy (callDayId, roleOnDay) key is intentionally not
-- constrained because existing duplicate role rows require owner review.
CREATE UNIQUE INDEX "ProgramMember_programId_userId_key" ON "ProgramMember"("programId", "userId");
CREATE UNIQUE INDEX "BlockEnrollment_blockId_residentId_key" ON "BlockEnrollment"("blockId", "residentId");
CREATE UNIQUE INDEX "CallDay_blockId_date_key" ON "CallDay"("blockId", "date");
CREATE UNIQUE INDEX "CallAssignment_callDayId_residentId_key" ON "CallAssignment"("callDayId", "residentId");

-- Foreign-key and common route query indexes.
CREATE INDEX "Program_orgId_idx" ON "Program"("orgId");
CREATE INDEX "Invite_programId_idx" ON "Invite"("programId");
CREATE INDEX "User_orgId_idx" ON "User"("orgId");
CREATE INDEX "ProgramMember_userId_idx" ON "ProgramMember"("userId");
CREATE INDEX "AcademicYear_programId_idx" ON "AcademicYear"("programId");
CREATE INDEX "PublicHoliday_academicYearId_date_idx" ON "PublicHoliday"("academicYearId", "date");
CREATE INDEX "Block_academicYearId_idx" ON "Block"("academicYearId");
CREATE INDEX "DayFlag_blockId_date_idx" ON "DayFlag"("blockId", "date");
CREATE INDEX "ResidentProfile_programId_idx" ON "ResidentProfile"("programId");
CREATE INDEX "BlockEnrollment_residentId_idx" ON "BlockEnrollment"("residentId");
CREATE INDEX "AttendingRoster_programId_idx" ON "AttendingRoster"("programId");
CREATE INDEX "AttendingEntry_blockId_date_idx" ON "AttendingEntry"("blockId", "date");
CREATE INDEX "CallDay_attendingEntryId_idx" ON "CallDay"("attendingEntryId");
CREATE INDEX "CallAssignment_residentId_idx" ON "CallAssignment"("residentId");
CREATE INDEX "ScheduleVersion_blockId_publishedAt_idx" ON "ScheduleVersion"("blockId", "publishedAt");
CREATE INDEX "AttendingScheduleTemplate_programId_idx" ON "AttendingScheduleTemplate"("programId");
