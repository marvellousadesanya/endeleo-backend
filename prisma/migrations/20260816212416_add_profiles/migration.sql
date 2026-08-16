-- CreateEnum
CREATE TYPE "submitter_type" AS ENUM ('individual', 'government', 'corporate');

-- CreateEnum
CREATE TYPE "kyc_status" AS ENUM ('none', 'pending', 'verified', 'rejected');

-- AlterTable
ALTER TABLE "bond_coupon_payments" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "bond_escrow_accounts" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "bond_holdings" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "bond_market_listings" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "bond_subscriptions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "bonds" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_credentials" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "profiles" (
    "user_id" UUID NOT NULL,
    "avatar_url" TEXT,
    "phone" TEXT,
    "country" TEXT,
    "address" TEXT,
    "date_of_birth" DATE,
    "currency_pref" TEXT NOT NULL DEFAULT 'NGN',
    "investor_type" TEXT,
    "submitter_type" "submitter_type",
    "company_name" TEXT,
    "contact_title" TEXT,
    "registration_number" TEXT,
    "tax_id" TEXT,
    "national_id" TEXT,
    "kyc_status" "kyc_status" NOT NULL DEFAULT 'none',
    "kyc_documents" JSONB NOT NULL DEFAULT '{}',
    "kyc_submitted_at" TIMESTAMPTZ(6),
    "referral_code" TEXT,
    "referred_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_referral_code_key" ON "profiles"("referral_code");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
