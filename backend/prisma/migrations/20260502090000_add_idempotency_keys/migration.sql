CREATE TYPE "IdempotencyRequestStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

CREATE TYPE "IdempotencyAction" AS ENUM ('MESSAGE_CREATE', 'GENERATION_JOB_CREATE');

CREATE TABLE "IdempotencyKey" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" "IdempotencyAction" NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" "IdempotencyRequestStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "resourceType" TEXT,
  "resourceId" TEXT,
  "response" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdempotencyKey_userId_action_key_key" ON "IdempotencyKey"("userId", "action", "key");
CREATE INDEX "IdempotencyKey_userId_createdAt_idx" ON "IdempotencyKey"("userId", "createdAt");
CREATE INDEX "IdempotencyKey_status_updatedAt_idx" ON "IdempotencyKey"("status", "updatedAt");

ALTER TABLE "IdempotencyKey"
  ADD CONSTRAINT "IdempotencyKey_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
