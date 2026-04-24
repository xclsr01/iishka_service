ALTER TABLE "GenerationJob" DROP CONSTRAINT IF EXISTS "GenerationJob_messageId_fkey";
DROP INDEX IF EXISTS "GenerationJob_messageId_idx";
ALTER TABLE "GenerationJob" DROP COLUMN IF EXISTS "messageId";
