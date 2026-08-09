-- CreateTable
CREATE TABLE "job_locks" (
    "name" TEXT NOT NULL,
    "locked_until" TIMESTAMPTZ(6) NOT NULL,
    "locked_by" TEXT,
    "last_run_at" TIMESTAMPTZ(6),

    CONSTRAINT "job_locks_pkey" PRIMARY KEY ("name")
);
