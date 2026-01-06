-- CreateEnum
CREATE TYPE "SessionEndJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "conversation_sessions" ADD COLUMN     "lease_expires_at" TIMESTAMP(3),
ADD COLUMN     "lease_owner" TEXT,
ADD COLUMN     "reset_timestamp" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "session_end_jobs" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "status" "SessionEndJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "error_message" TEXT,

    CONSTRAINT "session_end_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "browser_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "persistent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),

    CONSTRAINT "browser_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_end_jobs_status_created_at_idx" ON "session_end_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "session_end_jobs_tenant_id_idx" ON "session_end_jobs"("tenant_id");

-- CreateIndex
CREATE INDEX "browser_sessions_tenant_id_idx" ON "browser_sessions"("tenant_id");

-- CreateIndex
CREATE INDEX "browser_sessions_lease_expires_at_idx" ON "browser_sessions"("lease_expires_at");

-- CreateIndex
CREATE INDEX "browser_sessions_tenant_id_session_id_idx" ON "browser_sessions"("tenant_id", "session_id");

-- CreateIndex
CREATE INDEX "conversation_sessions_lease_expires_at_idx" ON "conversation_sessions"("lease_expires_at");

-- AddForeignKey
ALTER TABLE "session_end_jobs" ADD CONSTRAINT "session_end_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
