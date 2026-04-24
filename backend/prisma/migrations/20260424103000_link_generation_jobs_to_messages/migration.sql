ALTER TABLE "GenerationJob" ADD COLUMN "messageId" TEXT;

CREATE INDEX "GenerationJob_messageId_idx" ON "GenerationJob"("messageId");

ALTER TABLE "GenerationJob"
ADD CONSTRAINT "GenerationJob_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "Message"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
