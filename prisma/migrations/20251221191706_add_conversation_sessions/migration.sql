-- CreateTable: conversation_sessions
CREATE TABLE "conversation_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sender_phone" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "conversation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_sessions_tenant_id_sender_phone_idx" ON "conversation_sessions"("tenant_id", "sender_phone");

-- CreateIndex
CREATE INDEX "conversation_sessions_tenant_id_sender_phone_ended_at_idx" ON "conversation_sessions"("tenant_id", "sender_phone", "ended_at");

-- AddForeignKey
ALTER TABLE "conversation_sessions" ADD CONSTRAINT "conversation_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 1: Add session_id as NULLABLE first
ALTER TABLE "messages" ADD COLUMN "session_id" TEXT;

-- Step 2: Create legacy sessions for each unique tenant+sender_phone combo
-- and assign existing messages to them
INSERT INTO "conversation_sessions" ("id", "tenant_id", "sender_phone", "started_at", "ended_at")
SELECT
    gen_random_uuid()::text,
    tenant_id,
    sender_phone,
    MIN(created_at) as started_at,
    NULL as ended_at
FROM "messages"
GROUP BY tenant_id, sender_phone;

-- Step 3: Update messages to reference their legacy session
UPDATE "messages" m
SET session_id = cs.id
FROM "conversation_sessions" cs
WHERE m.tenant_id = cs.tenant_id
  AND m.sender_phone = cs.sender_phone;

-- Step 4: Now make session_id NOT NULL (all rows have been populated)
ALTER TABLE "messages" ALTER COLUMN "session_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "messages_session_id_idx" ON "messages"("session_id");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "conversation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
