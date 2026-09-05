-- Gives project_submissions a real review lifecycle and a link to the bond it
-- becomes once approved and promoted. Previously `status` was a free-text column
-- nothing but "submitted" ever wrote to, and there was no way to trace a submission
-- to the bond an admin eventually created from it.

-- CreateEnum
CREATE TYPE "submission_status" AS ENUM ('submitted', 'in_review', 'approved', 'rejected', 'promoted');

-- AlterTable: status text -> enum, preserving the existing "submitted" values.
ALTER TABLE "project_submissions"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "submission_status" USING ("status"::"submission_status"),
  ALTER COLUMN "status" SET DEFAULT 'submitted';

-- AlterTable: reviewedAt + bondId
ALTER TABLE "project_submissions"
  ADD COLUMN "reviewed_at" TIMESTAMPTZ(6),
  ADD COLUMN "bond_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "project_submissions_bond_id_key" ON "project_submissions"("bond_id");

-- CreateIndex
CREATE INDEX "project_submissions_status_created_at_idx" ON "project_submissions"("status", "created_at");

-- AddForeignKey
ALTER TABLE "project_submissions" ADD CONSTRAINT "project_submissions_bond_id_fkey"
  FOREIGN KEY ("bond_id") REFERENCES "bonds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
