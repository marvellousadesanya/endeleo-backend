-- CreateEnum
CREATE TYPE "checklist_kind" AS ENUM ('compliance', 'due_diligence');

-- CreateEnum
CREATE TYPE "checklist_status" AS ENUM ('not_started', 'in_progress', 'submitted', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "agreement_status" AS ENUM ('draft', 'sent', 'signed');

-- CreateEnum
CREATE TYPE "milestone_status" AS ENUM ('pending', 'due', 'released');

-- CreateEnum
CREATE TYPE "team_role" AS ENUM ('editor', 'viewer');

-- CreateEnum
CREATE TYPE "team_member_status" AS ENUM ('pending', 'active');

-- CreateTable
CREATE TABLE "sponsor_checklist_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bond_id" UUID NOT NULL,
    "kind" "checklist_kind" NOT NULL,
    "area" TEXT,
    "label" TEXT NOT NULL,
    "status" "checklist_status" NOT NULL DEFAULT 'not_started',
    "notes" TEXT,
    "evidence_path" TEXT,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sponsor_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsor_agreements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bond_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "file_path" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "status" "agreement_status" NOT NULL DEFAULT 'draft',
    "sent_at" TIMESTAMPTZ(6),
    "signed_at" TIMESTAMPTZ(6),
    "signed_name" TEXT,
    "signed_by" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sponsor_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_milestones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bond_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "target_minor" BIGINT NOT NULL,
    "due_date" DATE,
    "status" "milestone_status" NOT NULL DEFAULT 'pending',
    "released_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "funding_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsor_team_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_user_id" UUID NOT NULL,
    "member_user_id" UUID,
    "invited_email" TEXT NOT NULL,
    "role" "team_role" NOT NULL DEFAULT 'viewer',
    "status" "team_member_status" NOT NULL DEFAULT 'pending',
    "invited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joined_at" TIMESTAMPTZ(6),

    CONSTRAINT "sponsor_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sponsor_checklist_items_bond_id_kind_idx" ON "sponsor_checklist_items"("bond_id", "kind");

-- CreateIndex
CREATE INDEX "sponsor_agreements_bond_id_idx" ON "sponsor_agreements"("bond_id");

-- CreateIndex
CREATE INDEX "funding_milestones_bond_id_idx" ON "funding_milestones"("bond_id");

-- CreateIndex
CREATE INDEX "sponsor_team_members_owner_user_id_idx" ON "sponsor_team_members"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sponsor_team_members_owner_user_id_invited_email_key" ON "sponsor_team_members"("owner_user_id", "invited_email");

-- AddForeignKey
ALTER TABLE "sponsor_checklist_items" ADD CONSTRAINT "sponsor_checklist_items_bond_id_fkey" FOREIGN KEY ("bond_id") REFERENCES "bonds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsor_agreements" ADD CONSTRAINT "sponsor_agreements_bond_id_fkey" FOREIGN KEY ("bond_id") REFERENCES "bonds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_milestones" ADD CONSTRAINT "funding_milestones_bond_id_fkey" FOREIGN KEY ("bond_id") REFERENCES "bonds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsor_team_members" ADD CONSTRAINT "sponsor_team_members_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsor_team_members" ADD CONSTRAINT "sponsor_team_members_member_user_id_fkey" FOREIGN KEY ("member_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
