ALTER TABLE "GenerationJob"
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "claimOwner" TEXT,
  ADD COLUMN "heartbeatAt" TIMESTAMP(3),
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX "GenerationJob_status_nextAttemptAt_queuedAt_idx"
  ON "GenerationJob"("status", "nextAttemptAt", "queuedAt");

CREATE INDEX "GenerationJob_status_heartbeatAt_idx"
  ON "GenerationJob"("status", "heartbeatAt");

CREATE INDEX "GenerationJob_claimOwner_status_idx"
  ON "GenerationJob"("claimOwner", "status");
