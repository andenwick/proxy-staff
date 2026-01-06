-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('TIME', 'EVENT', 'CONDITION', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "AutonomyLevel" AS ENUM ('NOTIFY', 'CONFIRM', 'AUTO');

-- CreateEnum
CREATE TYPE "TriggerStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "TriggerExecutionStatus" AS ENUM ('PENDING', 'AWAITING_CONFIRMATION', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "ConfirmationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "triggers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger_type" "TriggerType" NOT NULL,
    "config" JSONB NOT NULL,
    "task_prompt" TEXT NOT NULL,
    "autonomy" "AutonomyLevel" NOT NULL DEFAULT 'NOTIFY',
    "status" "TriggerStatus" NOT NULL DEFAULT 'ACTIVE',
    "cooldown_seconds" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "max_errors" INTEGER NOT NULL DEFAULT 3,
    "webhook_path" TEXT,
    "webhook_secret" TEXT,
    "last_triggered_at" TIMESTAMP(3),
    "next_check_at" TIMESTAMP(3),
    "execution_state" JSONB,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trigger_executions" (
    "id" TEXT NOT NULL,
    "trigger_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "status" "TriggerExecutionStatus" NOT NULL,
    "triggered_by" TEXT,
    "input_context" JSONB,
    "output" TEXT,
    "error_message" TEXT,
    "confirmation_status" "ConfirmationStatus",
    "confirmation_deadline" TIMESTAMP(3),
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,

    CONSTRAINT "trigger_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "triggers_webhook_path_key" ON "triggers"("webhook_path");

-- CreateIndex
CREATE INDEX "triggers_tenant_id_idx" ON "triggers"("tenant_id");

-- CreateIndex
CREATE INDEX "triggers_status_next_check_at_idx" ON "triggers"("status", "next_check_at");

-- CreateIndex
CREATE INDEX "triggers_trigger_type_status_idx" ON "triggers"("trigger_type", "status");

-- CreateIndex
CREATE INDEX "trigger_executions_trigger_id_started_at_idx" ON "trigger_executions"("trigger_id", "started_at");

-- CreateIndex
CREATE INDEX "trigger_executions_confirmation_status_confirmation_deadlin_idx" ON "trigger_executions"("confirmation_status", "confirmation_deadline");

-- CreateIndex
CREATE INDEX "trigger_executions_tenant_id_idx" ON "trigger_executions"("tenant_id");

-- AddForeignKey
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trigger_executions" ADD CONSTRAINT "trigger_executions_trigger_id_fkey" FOREIGN KEY ("trigger_id") REFERENCES "triggers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trigger_executions" ADD CONSTRAINT "trigger_executions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
