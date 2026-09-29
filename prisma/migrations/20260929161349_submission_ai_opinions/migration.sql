-- CreateTable
CREATE TABLE "submission_ai_opinions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "submission_id" UUID NOT NULL,
    "module" VARCHAR(4) NOT NULL,
    "based_on" TIMESTAMPTZ(6) NOT NULL,
    "verdict" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL,
    "flags" TEXT[],
    "model" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID,

    CONSTRAINT "submission_ai_opinions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "submission_ai_opinions_submission_id_idx" ON "submission_ai_opinions"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_ai_opinions_submission_id_module_key" ON "submission_ai_opinions"("submission_id", "module");

-- AddForeignKey
ALTER TABLE "submission_ai_opinions" ADD CONSTRAINT "submission_ai_opinions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "project_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_ai_opinions" ADD CONSTRAINT "submission_ai_opinions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
