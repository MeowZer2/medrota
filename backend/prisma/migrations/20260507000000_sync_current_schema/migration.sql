-- AlterTable
ALTER TABLE "Block" ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicToken" TEXT;

-- AlterTable
ALTER TABLE "BlockSettings" ADD COLUMN     "limitWeekendCalls" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ResidentProfile" ADD COLUMN     "email" TEXT,
ALTER COLUMN "pgyLevel" SET DATA TYPE TEXT;

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayFlag" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#F59E0B',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleVersion" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendingScheduleTemplate" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "attendingName" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "activityLabel" TEXT NOT NULL,

    CONSTRAINT "AttendingScheduleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invite_token_key" ON "Invite"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Block_publicToken_key" ON "Block"("publicToken");

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayFlag" ADD CONSTRAINT "DayFlag_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleVersion" ADD CONSTRAINT "ScheduleVersion_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendingScheduleTemplate" ADD CONSTRAINT "AttendingScheduleTemplate_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
