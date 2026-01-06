-- DropIndex
DROP INDEX "messages_search_vector_idx";

-- AlterTable
ALTER TABLE "scheduled_tasks" ADD COLUMN     "task_type" TEXT NOT NULL DEFAULT 'reminder';
