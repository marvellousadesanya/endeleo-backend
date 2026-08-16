-- CreateEnum
CREATE TYPE "post_status" AS ENUM ('draft', 'published');

-- CreateTable
CREATE TABLE "posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "tag" TEXT NOT NULL DEFAULT '',
    "cover_url" TEXT NOT NULL DEFAULT '',
    "status" "post_status" NOT NULL DEFAULT 'draft',
    "author_id" UUID,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_updates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "author_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_room_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bond_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "issuer" TEXT,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "requires_signature" BOOLEAN NOT NULL DEFAULT false,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "data_room_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_room_signatures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "signed_name" TEXT NOT NULL,
    "ip_address" TEXT,
    "signed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_room_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "project_title" TEXT NOT NULL,
    "organization" TEXT,
    "sector" TEXT,
    "location_state" TEXT,
    "project_stage" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "capital_required_minor" BIGINT,
    "expected_return_bps" INTEGER,
    "tenor_months" INTEGER,
    "website_url" TEXT,
    "additional_links" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "submitter_name" TEXT,
    "submitter_email" TEXT,
    "submitter_phone" TEXT,
    "submitter_type" "submitter_type",
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "reviewer_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investor_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firm" TEXT,
    "role" TEXT,
    "country" TEXT,
    "investor_type" TEXT,
    "organization_type" TEXT,
    "ticket_range" TEXT,
    "timeline" TEXT,
    "sectors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkedin_url" TEXT,
    "heard_from" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "landing_path" TEXT,
    "referrer" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "investor_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "posts_slug_key" ON "posts"("slug");

-- CreateIndex
CREATE INDEX "posts_status_published_at_idx" ON "posts"("status", "published_at");

-- CreateIndex
CREATE INDEX "project_updates_project_slug_created_at_idx" ON "project_updates"("project_slug", "created_at");

-- CreateIndex
CREATE INDEX "data_room_documents_bond_id_category_sort_order_idx" ON "data_room_documents"("bond_id", "category", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "data_room_signatures_document_id_user_id_key" ON "data_room_signatures"("document_id", "user_id");

-- CreateIndex
CREATE INDEX "project_submissions_user_id_created_at_idx" ON "project_submissions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "investor_applications_status_created_at_idx" ON "investor_applications"("status", "created_at");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_room_documents" ADD CONSTRAINT "data_room_documents_bond_id_fkey" FOREIGN KEY ("bond_id") REFERENCES "bonds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_room_signatures" ADD CONSTRAINT "data_room_signatures_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "data_room_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_room_signatures" ADD CONSTRAINT "data_room_signatures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_submissions" ADD CONSTRAINT "project_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investor_applications" ADD CONSTRAINT "investor_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
