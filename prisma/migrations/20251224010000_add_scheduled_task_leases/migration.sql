-- AlterTable
ALTER TABLE "scheduled_tasks" ADD COLUMN "lease_owner" TEXT;
ALTER TABLE "scheduled_tasks" ADD COLUMN "lease_expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "scheduled_tasks_lease_expires_at_idx" ON "scheduled_tasks"("lease_expires_at");
