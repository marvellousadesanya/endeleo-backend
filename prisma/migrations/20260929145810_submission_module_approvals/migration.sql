-- CreateTable
CREATE TABLE "submission_module_approvals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "submission_id" UUID NOT NULL,
    "module" VARCHAR(4) NOT NULL,
    "approved_by_id" UUID NOT NULL,
    "approved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "submission_module_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "submission_module_approvals_submission_id_idx" ON "submission_module_approvals"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_module_approvals_submission_id_module_key" ON "submission_module_approvals"("submission_id", "module");

-- AddForeignKey
ALTER TABLE "submission_module_approvals" ADD CONSTRAINT "submission_module_approvals_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "project_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_module_approvals" ADD CONSTRAINT "submission_module_approvals_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
