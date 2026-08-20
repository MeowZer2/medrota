-- Append-only audit trail. Rows are written alongside the mutation they
-- describe and are never updated or deleted by application code.
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "blockId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'scheduling',
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvent_programId_createdAt_idx" ON "AuditEvent"("programId", "createdAt");
CREATE INDEX "AuditEvent_blockId_createdAt_idx" ON "AuditEvent"("blockId", "createdAt");

ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_programId_fkey"
    FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_blockId_fkey"
    FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
