-- CreateTable
CREATE TABLE "oauth_exchange_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_exchange_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_exchange_codes_code_hash_key" ON "oauth_exchange_codes"("code_hash");

-- CreateIndex
CREATE INDEX "oauth_exchange_codes_expires_at_idx" ON "oauth_exchange_codes"("expires_at");

-- AddForeignKey
ALTER TABLE "oauth_exchange_codes" ADD CONSTRAINT "oauth_exchange_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
