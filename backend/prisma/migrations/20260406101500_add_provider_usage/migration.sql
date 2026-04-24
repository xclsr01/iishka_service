-- CreateEnum
CREATE TYPE "ProviderUsageOperation" AS ENUM ('CHAT_GENERATION', 'JOB_GENERATION');

-- CreateTable
CREATE TABLE "ProviderUsage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "chatId" TEXT,
  "messageId" TEXT,
  "generationJobId" TEXT,
  "operation" "ProviderUsageOperation" NOT NULL,
  "model" TEXT NOT NULL,
  "requestId" TEXT,
  "upstreamRequestId" TEXT,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "totalTokens" INTEGER,
  "requestUnits" INTEGER,
  "latencyMs" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProviderUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderUsage_userId_createdAt_idx" ON "ProviderUsage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderUsage_providerId_createdAt_idx" ON "ProviderUsage"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderUsage_chatId_idx" ON "ProviderUsage"("chatId");

-- CreateIndex
CREATE INDEX "ProviderUsage_messageId_idx" ON "ProviderUsage"("messageId");

-- CreateIndex
CREATE INDEX "ProviderUsage_generationJobId_idx" ON "ProviderUsage"("generationJobId");

-- CreateIndex
CREATE INDEX "ProviderUsage_requestId_idx" ON "ProviderUsage"("requestId");

-- AddForeignKey
ALTER TABLE "ProviderUsage" ADD CONSTRAINT "ProviderUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderUsage" ADD CONSTRAINT "ProviderUsage_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderUsage" ADD CONSTRAINT "ProviderUsage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderUsage" ADD CONSTRAINT "ProviderUsage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderUsage" ADD CONSTRAINT "ProviderUsage_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "GenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
