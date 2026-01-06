-- CreateEnum
CREATE TYPE "AsyncJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED');

-- CreateTable
CREATE TABLE "async_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sender_phone" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL DEFAULT 'cli_task',
    "status" "AsyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "input_message" TEXT NOT NULL,
    "output_result" TEXT,
    "error_message" TEXT,
    "estimated_ms" INTEGER,
    "dedup_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "progress_updates" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "async_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "async_jobs_tenant_id_status_idx" ON "async_jobs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "async_jobs_sender_phone_status_idx" ON "async_jobs"("sender_phone", "status");

-- CreateIndex
CREATE INDEX "async_jobs_dedup_hash_idx" ON "async_jobs"("dedup_hash");

-- CreateIndex
CREATE INDEX "async_jobs_created_at_idx" ON "async_jobs"("created_at");

-- AddForeignKey
ALTER TABLE "async_jobs" ADD CONSTRAINT "async_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
