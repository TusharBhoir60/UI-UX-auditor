-- CreateEnum
CREATE TYPE "issue_category" AS ENUM ('accessibility', 'visual', 'usability');

-- CreateEnum
CREATE TYPE "issue_severity" AS ENUM ('Critical', 'High', 'Medium', 'Low');

-- CreateEnum
CREATE TYPE "issue_confidence" AS ENUM ('deterministic', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "issue_status" AS ENUM ('open', 'acknowledged', 'fixed');

-- CreateTable
CREATE TABLE "issues" (
    "id" UUID NOT NULL,
    "audit_id" UUID NOT NULL,
    "category" "issue_category" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "issue_severity" NOT NULL,
    "confidence" "issue_confidence" NOT NULL DEFAULT 'deterministic',
    "standard_reference" VARCHAR(255),
    "recommendation" TEXT NOT NULL,
    "status" "issue_status" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "dom_selector" VARCHAR(1024),
    "highlighted_region" JSONB,
    "screenshot_crop_url" VARCHAR(2048),
    "snippet" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "issues_audit_id_idx" ON "issues"("audit_id");

-- CreateIndex
CREATE INDEX "issues_audit_id_severity_idx" ON "issues"("audit_id", "severity");

-- CreateIndex
CREATE INDEX "evidence_issue_id_idx" ON "evidence"("issue_id");

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
