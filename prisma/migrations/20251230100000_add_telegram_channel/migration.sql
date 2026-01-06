-- CreateEnum
CREATE TYPE "MessagingChannel" AS ENUM ('WHATSAPP', 'TELEGRAM');

-- AlterTable: Add messaging_channel with default
ALTER TABLE "tenants" ADD COLUMN "messaging_channel" "MessagingChannel" NOT NULL DEFAULT 'WHATSAPP';

-- AlterTable: Make whatsapp_phone_number_id nullable
ALTER TABLE "tenants" ALTER COLUMN "whatsapp_phone_number_id" DROP NOT NULL;

-- AlterTable: Add telegram columns
ALTER TABLE "tenants" ADD COLUMN "telegram_chat_id" TEXT;
ALTER TABLE "tenants" ADD COLUMN "telegram_linked_at" TIMESTAMP(3);

-- CreateIndex: Unique constraint on telegram_chat_id
CREATE UNIQUE INDEX "tenants_telegram_chat_id_key" ON "tenants"("telegram_chat_id");
