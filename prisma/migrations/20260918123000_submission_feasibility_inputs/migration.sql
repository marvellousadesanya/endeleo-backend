-- M1/M2 intake inputs: the self-assessment questionnaire and year-by-year cashflow
-- projections a DSCR calculation needs. Self-assessment is a small, fixed set of
-- fields so it stays flat on project_submissions; cashflows are genuinely
-- one-to-many, so they get their own table.

-- CreateEnum
CREATE TYPE "revenue_model" AS ENUM ('tariff', 'offtake', 'government_payment', 'user_fee', 'other');

-- AlterTable
ALTER TABLE "project_submissions" ADD COLUMN     "offtake_agreement_in_place" BOOLEAN,
ADD COLUMN     "ongoing_litigation" BOOLEAN,
ADD COLUMN     "prior_default" BOOLEAN,
ADD COLUMN     "prior_dfi_funding" BOOLEAN,
ADD COLUMN     "revenue_model" "revenue_model",
ADD COLUMN     "use_of_proceeds_detail" TEXT;

-- CreateTable
CREATE TABLE "submission_cashflows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "submission_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "revenue_minor" BIGINT NOT NULL,
    "opex_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "submission_cashflows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "submission_cashflows_submission_id_year_key" ON "submission_cashflows"("submission_id", "year");

-- AddForeignKey
ALTER TABLE "submission_cashflows" ADD CONSTRAINT "submission_cashflows_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "project_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
