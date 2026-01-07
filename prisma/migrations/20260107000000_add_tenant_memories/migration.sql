-- CreateTable
CREATE TABLE "tenant_memories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "memory_type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "markdown" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_memories_tenant_id_idx" ON "tenant_memories"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memories_tenant_id_memory_type_key" ON "tenant_memories"("tenant_id", "memory_type");

-- AddForeignKey
ALTER TABLE "tenant_memories" ADD CONSTRAINT "tenant_memories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
