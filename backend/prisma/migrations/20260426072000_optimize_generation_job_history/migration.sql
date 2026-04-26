CREATE INDEX "GenerationJob_userId_providerId_kind_createdAt_idx"
ON "GenerationJob"("userId", "providerId", "kind", "createdAt");

CREATE INDEX "GenerationJob_userId_providerId_kind_status_createdAt_idx"
ON "GenerationJob"("userId", "providerId", "kind", "status", "createdAt");
