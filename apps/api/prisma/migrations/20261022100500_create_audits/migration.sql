-- CreateEnum
CREATE TYPE "audit_status" AS ENUM ('queued', 'running', 'complete', 'failed');

-- CreateTable
CREATE TABLE "audits" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "status" "audit_status" NOT NULL DEFAULT 'queued',
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audits_user_id_idx" ON "audits"("user_id");

-- CreateIndex
CREATE INDEX "audits_user_id_created_at_idx" ON "audits"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
