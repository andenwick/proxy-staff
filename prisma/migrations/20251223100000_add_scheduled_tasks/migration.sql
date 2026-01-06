-- CreateTable
CREATE TABLE "scheduled_tasks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_phone" TEXT NOT NULL,
    "task_prompt" TEXT NOT NULL,
    "cron_expr" TEXT,
    "run_at" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'America/Denver',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_one_time" BOOLEAN NOT NULL,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_tasks_tenant_id_idx" ON "scheduled_tasks"("tenant_id");

-- CreateIndex
CREATE INDEX "scheduled_tasks_next_run_at_enabled_idx" ON "scheduled_tasks"("next_run_at", "enabled");

-- CreateIndex
CREATE INDEX "scheduled_tasks_tenant_id_user_phone_idx" ON "scheduled_tasks"("tenant_id", "user_phone");

-- AddForeignKey
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
