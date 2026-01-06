/*
  Warnings:

  - You are about to drop the column `enabled_tools` on the `tenant_configs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "tenant_configs" DROP COLUMN "enabled_tools";
