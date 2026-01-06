-- CreateEnum
CREATE TYPE "ToolExecutionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILURE', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "SignalType" AS ENUM ('TOOL_FAILURE', 'USER_CORRECTION', 'USER_COMPLAINT', 'RETRY_NEEDED', 'GUARD_TRIGGERED');

-- CreateTable
CREATE TABLE "tool_executions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT,
    "tool_name" TEXT NOT NULL,
    "tool_type" TEXT NOT NULL,
    "input_payload" JSONB NOT NULL,
    "output_payload" JSONB,
    "status" "ToolExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "duration_ms" INTEGER,
    "error_message" TEXT,
    "directive_used" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "tool_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_signals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "signal_type" "SignalType" NOT NULL,
    "signal_data" JSONB NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "tool_execution_id" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "improvement_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "improvement_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "trigger_type" TEXT NOT NULL,
    "trigger_signals" TEXT[],
    "analysis_summary" TEXT NOT NULL,
    "pattern_identified" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "action_details" JSONB NOT NULL,
    "before_state" TEXT,
    "after_state" TEXT,
    "verification_status" TEXT NOT NULL DEFAULT 'pending',
    "verified_at" TIMESTAMP(3),
    "rolled_back" BOOLEAN NOT NULL DEFAULT false,
    "rolled_back_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "improvement_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_baselines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tool_success_rate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "user_satisfaction_score" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "tool_metrics" JSONB NOT NULL DEFAULT '{}',
    "success_rate_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "satisfaction_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tool_executions_tenant_id_idx" ON "tool_executions"("tenant_id");

-- CreateIndex
CREATE INDEX "tool_executions_tenant_id_started_at_idx" ON "tool_executions"("tenant_id", "started_at");

-- CreateIndex
CREATE INDEX "tool_executions_tool_name_status_idx" ON "tool_executions"("tool_name", "status");

-- CreateIndex
CREATE INDEX "feedback_signals_tenant_id_idx" ON "feedback_signals"("tenant_id");

-- CreateIndex
CREATE INDEX "feedback_signals_tenant_id_signal_type_idx" ON "feedback_signals"("tenant_id", "signal_type");

-- CreateIndex
CREATE INDEX "feedback_signals_processed_idx" ON "feedback_signals"("processed");

-- CreateIndex
CREATE INDEX "improvement_logs_tenant_id_idx" ON "improvement_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "improvement_logs_tenant_id_created_at_idx" ON "improvement_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "improvement_logs_verification_status_idx" ON "improvement_logs"("verification_status");

-- CreateIndex
CREATE UNIQUE INDEX "performance_baselines_tenant_id_key" ON "performance_baselines"("tenant_id");

-- AddForeignKey
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_signals" ADD CONSTRAINT "feedback_signals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_signals" ADD CONSTRAINT "feedback_signals_improvement_id_fkey" FOREIGN KEY ("improvement_id") REFERENCES "improvement_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_logs" ADD CONSTRAINT "improvement_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_baselines" ADD CONSTRAINT "performance_baselines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
