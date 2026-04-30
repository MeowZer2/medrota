-- CreateTable
CREATE TABLE "AttendingRoster" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "attendingName" TEXT NOT NULL,
    "typicalActivities" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendingRoster_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AttendingRoster" ADD CONSTRAINT "AttendingRoster_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
