-- CreateEnum
CREATE TYPE "bond_status" AS ENUM ('draft', 'open', 'subscribed', 'active', 'matured', 'closed', 'defaulted');

-- CreateEnum
CREATE TYPE "bond_currency" AS ENUM ('NGN', 'USD', 'GBP', 'EUR');

-- CreateEnum
CREATE TYPE "coupon_frequency" AS ENUM ('monthly', 'quarterly', 'semiannual', 'annual', 'zero');

-- CreateEnum
CREATE TYPE "allocation_rule" AS ENUM ('fcfs', 'pro_rata', 'waitlist');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('pending', 'allocated', 'waitlisted', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'paid', 'failed', 'retry', 'escalated');

-- CreateEnum
CREATE TYPE "redemption_stage" AS ENUM ('t_minus_90', 't_minus_30', 't_minus_7', 'maturity', 'default_declared', 'archived');

-- CreateEnum
CREATE TYPE "escrow_purpose" AS ENUM ('coupon', 'principal', 'default_reserve');

-- CreateEnum
CREATE TYPE "listing_status" AS ENUM ('active', 'filled', 'cancelled', 'expired');

-- CreateTable
CREATE TABLE "bonds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "isin_ref" TEXT NOT NULL,
    "project_slug" TEXT,
    "issuer_id" UUID NOT NULL,
    "spv_reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "currency" "bond_currency" NOT NULL DEFAULT 'NGN',
    "total_size_minor" BIGINT NOT NULL,
    "minimum_investment_minor" BIGINT NOT NULL,
    "raised_minor" BIGINT NOT NULL DEFAULT 0,
    "tenor_months" INTEGER NOT NULL,
    "coupon_rate_bps" INTEGER NOT NULL,
    "coupon_frequency" "coupon_frequency" NOT NULL DEFAULT 'quarterly',
    "allocation_rule" "allocation_rule" NOT NULL DEFAULT 'fcfs',
    "concentration_limit_bps" INTEGER NOT NULL DEFAULT 2000,
    "kyc_tier_required" SMALLINT NOT NULL DEFAULT 1,
    "geo_block" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subscription_open_at" TIMESTAMPTZ(6) NOT NULL,
    "subscription_close_at" TIMESTAMPTZ(6) NOT NULL,
    "issue_date" DATE,
    "maturity_date" DATE,
    "status" "bond_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bonds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bond_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bond_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "status" "subscription_status" NOT NULL DEFAULT 'pending',
    "cooling_off_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "escrow_reference" TEXT,
    "allocated_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bond_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bond_holdings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bond_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "units_minor" BIGINT NOT NULL,
    "certificate_hash" TEXT,
    "first_settled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bond_holdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bond_coupon_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bond_id" UUID NOT NULL,
    "period_index" INTEGER NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "scheduled_pay_date" DATE NOT NULL,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bond_coupon_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bond_coupon_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schedule_id" UUID NOT NULL,
    "bond_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "unit_days" BIGINT NOT NULL,
    "days_held" INTEGER NOT NULL,
    "closing_units_minor" BIGINT NOT NULL,
    "gross_minor" BIGINT NOT NULL,
    "wht_minor" BIGINT NOT NULL,
    "net_minor" BIGINT NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "provider_ref" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bond_coupon_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bond_tax_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bond_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "coupon_payment_id" UUID,
    "tax_year" INTEGER NOT NULL,
    "gross_minor" BIGINT NOT NULL,
    "wht_minor" BIGINT NOT NULL,
    "wht_rate_bps" INTEGER NOT NULL DEFAULT 1000,
    "currency" "bond_currency" NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bond_tax_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bond_escrow_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bond_id" UUID NOT NULL,
    "purpose" "escrow_purpose" NOT NULL,
    "balance_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" "bond_currency" NOT NULL,
    "last_verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bond_escrow_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bond_redemption_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bond_id" UUID NOT NULL,
    "stage" "redemption_stage" NOT NULL,
    "scheduled_for" DATE NOT NULL,
    "executed_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bond_redemption_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bond_principal_returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bond_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "provider_ref" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bond_principal_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bond_market_listings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bond_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "units_minor" BIGINT NOT NULL,
    "ask_price_bps" INTEGER NOT NULL,
    "status" "listing_status" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ(6),
    "filled_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bond_market_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bond_market_trades" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "bond_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "units_minor" BIGINT NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "fee_minor" BIGINT NOT NULL,
    "trade_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "executed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bond_market_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bond_audit_log" (
    "id" BIGSERIAL NOT NULL,
    "bond_id" UUID,
    "user_id" UUID,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "bond_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bonds_isin_ref_key" ON "bonds"("isin_ref");

-- CreateIndex
CREATE INDEX "bonds_status_idx" ON "bonds"("status");

-- CreateIndex
CREATE INDEX "bond_subscriptions_bond_id_status_idx" ON "bond_subscriptions"("bond_id", "status");

-- CreateIndex
CREATE INDEX "bond_subscriptions_user_id_idx" ON "bond_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "bond_holdings_user_id_idx" ON "bond_holdings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "bond_holdings_bond_id_user_id_key" ON "bond_holdings"("bond_id", "user_id");

-- CreateIndex
CREATE INDEX "bond_coupon_schedules_scheduled_pay_date_idx" ON "bond_coupon_schedules"("scheduled_pay_date");

-- CreateIndex
CREATE UNIQUE INDEX "bond_coupon_schedules_bond_id_period_index_key" ON "bond_coupon_schedules"("bond_id", "period_index");

-- CreateIndex
CREATE INDEX "bond_coupon_payments_status_idx" ON "bond_coupon_payments"("status");

-- CreateIndex
CREATE INDEX "bond_coupon_payments_user_id_idx" ON "bond_coupon_payments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "bond_coupon_payments_schedule_id_user_id_key" ON "bond_coupon_payments"("schedule_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "bond_tax_records_coupon_payment_id_key" ON "bond_tax_records"("coupon_payment_id");

-- CreateIndex
CREATE INDEX "bond_tax_records_user_id_tax_year_idx" ON "bond_tax_records"("user_id", "tax_year");

-- CreateIndex
CREATE UNIQUE INDEX "bond_escrow_accounts_bond_id_purpose_key" ON "bond_escrow_accounts"("bond_id", "purpose");

-- CreateIndex
CREATE INDEX "bond_redemption_events_scheduled_for_idx" ON "bond_redemption_events"("scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "bond_redemption_events_bond_id_stage_key" ON "bond_redemption_events"("bond_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "bond_principal_returns_bond_id_user_id_key" ON "bond_principal_returns"("bond_id", "user_id");

-- CreateIndex
CREATE INDEX "bond_market_listings_bond_id_status_idx" ON "bond_market_listings"("bond_id", "status");

-- CreateIndex
CREATE INDEX "bond_market_listings_seller_id_idx" ON "bond_market_listings"("seller_id");

-- CreateIndex
CREATE INDEX "bond_market_trades_bond_id_executed_at_idx" ON "bond_market_trades"("bond_id", "executed_at");

-- CreateIndex
CREATE INDEX "bond_audit_log_bond_id_created_at_idx" ON "bond_audit_log"("bond_id", "created_at");

-- AddForeignKey
ALTER TABLE "bonds" ADD CONSTRAINT "bonds_issuer_id_fkey" FOREIGN KEY ("issuer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_subscriptions" ADD CONSTRAINT "bond_subscriptions_bond_id_fkey" FOREIGN KEY ("bond_id") REFERENCES "bonds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_subscriptions" ADD CONSTRAINT "bond_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_holdings" ADD CONSTRAINT "bond_holdings_bond_id_fkey" FOREIGN KEY ("bond_id") REFERENCES "bonds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_holdings" ADD CONSTRAINT "bond_holdings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_coupon_schedules" ADD CONSTRAINT "bond_coupon_schedules_bond_id_fkey" FOREIGN KEY ("bond_id") REFERENCES "bonds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_coupon_payments" ADD CONSTRAINT "bond_coupon_payments_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "bond_coupon_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_coupon_payments" ADD CONSTRAINT "bond_coupon_payments_bond_id_fkey" FOREIGN KEY ("bond_id") REFERENCES "bonds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_coupon_payments" ADD CONSTRAINT "bond_coupon_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_tax_records" ADD CONSTRAINT "bond_tax_records_bond_id_fkey" FOREIGN KEY ("bond_id") REFERENCES "bonds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_tax_records" ADD CONSTRAINT "bond_tax_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_tax_records" ADD CONSTRAINT "bond_tax_records_coupon_payment_id_fkey" FOREIGN KEY ("coupon_payment_id") REFERENCES "bond_coupon_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_escrow_accounts" ADD CONSTRAINT "bond_escrow_accounts_bond_id_fkey" FOREIGN KEY ("bond_id") REFERENCES "bonds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_redemption_events" ADD CONSTRAINT "bond_redemption_events_bond_id_fkey" FOREIGN KEY ("bond_id") REFERENCES "bonds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_principal_returns" ADD CONSTRAINT "bond_principal_returns_bond_id_fkey" FOREIGN KEY ("bond_id") REFERENCES "bonds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_principal_returns" ADD CONSTRAINT "bond_principal_returns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_market_listings" ADD CONSTRAINT "bond_market_listings_bond_id_fkey" FOREIGN KEY ("bond_id") REFERENCES "bonds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_market_listings" ADD CONSTRAINT "bond_market_listings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_market_trades" ADD CONSTRAINT "bond_market_trades_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "bond_market_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_market_trades" ADD CONSTRAINT "bond_market_trades_bond_id_fkey" FOREIGN KEY ("bond_id") REFERENCES "bonds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_market_trades" ADD CONSTRAINT "bond_market_trades_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_market_trades" ADD CONSTRAINT "bond_market_trades_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_audit_log" ADD CONSTRAINT "bond_audit_log_bond_id_fkey" FOREIGN KEY ("bond_id") REFERENCES "bonds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bond_audit_log" ADD CONSTRAINT "bond_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Guarantees Prisma cannot express.
--
-- These are hand-written into the generated migration deliberately: one
-- migration system, one history, procedures under version control.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Constraints ────────────────────────────────────────────────────────────
ALTER TABLE bonds
  ADD CONSTRAINT bonds_positive_size        CHECK (total_size_minor > 0),
  ADD CONSTRAINT bonds_positive_minimum     CHECK (minimum_investment_minor > 0),
  ADD CONSTRAINT bonds_minimum_within_total CHECK (minimum_investment_minor <= total_size_minor),
  ADD CONSTRAINT bonds_raised_non_negative  CHECK (raised_minor >= 0),
  -- The previous engine had no backstop against overselling: only the allocation
  -- procedure prevented it, so any other write path could breach the raise.
  ADD CONSTRAINT bonds_no_oversell          CHECK (raised_minor <= total_size_minor),
  ADD CONSTRAINT bonds_tenor_range          CHECK (tenor_months BETWEEN 1 AND 360),
  ADD CONSTRAINT bonds_rate_range           CHECK (coupon_rate_bps BETWEEN 0 AND 5000),
  ADD CONSTRAINT bonds_concentration_range  CHECK (concentration_limit_bps BETWEEN 1 AND 10000),
  ADD CONSTRAINT bonds_kyc_tier_range       CHECK (kyc_tier_required BETWEEN 0 AND 3),
  ADD CONSTRAINT bonds_window_valid         CHECK (subscription_close_at > subscription_open_at),
  ADD CONSTRAINT bonds_maturity_after_issue CHECK (maturity_date IS NULL OR issue_date IS NULL OR maturity_date > issue_date);

ALTER TABLE bond_subscriptions
  ADD CONSTRAINT subscriptions_positive_amount CHECK (amount_minor > 0);

ALTER TABLE bond_holdings
  ADD CONSTRAINT holdings_non_negative CHECK (units_minor >= 0);

ALTER TABLE bond_coupon_schedules
  ADD CONSTRAINT coupon_period_valid CHECK (period_end > period_start);

ALTER TABLE bond_coupon_payments
  ADD CONSTRAINT coupon_amounts_non_negative
    CHECK (gross_minor >= 0 AND wht_minor >= 0 AND net_minor >= 0 AND unit_days >= 0),
  ADD CONSTRAINT coupon_net_is_gross_less_wht CHECK (net_minor = gross_minor - wht_minor);

ALTER TABLE bond_escrow_accounts
  ADD CONSTRAINT escrow_non_negative CHECK (balance_minor >= 0);

ALTER TABLE bond_market_listings
  ADD CONSTRAINT listing_positive_units CHECK (units_minor > 0),
  ADD CONSTRAINT listing_price_range    CHECK (ask_price_bps BETWEEN 1 AND 20000);

ALTER TABLE bond_market_trades
  ADD CONSTRAINT trade_positive_units CHECK (units_minor > 0),
  ADD CONSTRAINT trade_no_self_dealing CHECK (seller_id <> buyer_id);

-- ── The NGN floor ──────────────────────────────────────────────────────────
-- A trigger rather than a CHECK so the amount can be revised without a table rewrite.
CREATE OR REPLACE FUNCTION enforce_bond_minimum()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.currency = 'NGN' AND NEW.minimum_investment_minor < 1000000 THEN
    RAISE EXCEPTION 'NGN bonds require a minimum of at least NGN 10,000 (1,000,000 kobo)';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER bonds_enforce_minimum
  BEFORE INSERT OR UPDATE ON bonds
  FOR EACH ROW EXECUTE FUNCTION enforce_bond_minimum();

-- ── The lifecycle state machine ────────────────────────────────────────────
-- A trigger, not application code, so the rule holds for every writer: this API,
-- a future service, a migration, or somebody at a psql prompt.
CREATE OR REPLACE FUNCTION enforce_bond_state()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  IF NOT (OLD.status, NEW.status) IN (
    ('draft','open'),
    ('open','subscribed'), ('open','closed'),
    ('subscribed','open'),        -- a cooling-off cancellation can un-fill a bond
    ('subscribed','active'),
    ('active','matured'), ('active','defaulted'),
    ('matured','closed'),
    ('defaulted','closed')
  ) THEN
    RAISE EXCEPTION 'Illegal bond status transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER bonds_state_machine
  BEFORE UPDATE OF status ON bonds
  FOR EACH ROW EXECUTE FUNCTION enforce_bond_state();

-- ── Audit log immutability ─────────────────────────────────────────────────
-- Stronger than the previous engine, which relied on there being no row-level
-- security policy permitting writes. That only holds while every connection is
-- an unprivileged role; this holds regardless.
CREATE OR REPLACE FUNCTION bond_audit_log_is_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'bond_audit_log is append-only: % is not permitted', TG_OP;
END $$;

CREATE TRIGGER bond_audit_log_no_update
  BEFORE UPDATE OR DELETE ON bond_audit_log
  FOR EACH ROW EXECUTE FUNCTION bond_audit_log_is_append_only();

-- ═══════════════════════════════════════════════════════════════════════════
-- Money procedures.
--
-- These stay in SQL because each has to read a balance, decide, and write —
-- indivisibly. Doing that in application code means two investors arriving in
-- the same millisecond can both be told there is room. FOR UPDATE makes the
-- second one wait; nothing in TypeScript does that for free.
--
-- No auth.uid() checks: unlike the Supabase original, nothing but this API can
-- reach the database, so authorisation belongs in the application layer.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Allocation ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION allocate_subscription(_sub_id UUID)
RETURNS bond_holdings
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _sub      bond_subscriptions;
  _bond     bonds;
  _holding  bond_holdings;
  _after    BIGINT;
  _limit    BIGINT;
BEGIN
  -- Lock the subscription, then the bond. Always in that order: consistent lock
  -- ordering is what stops two concurrent allocations deadlocking each other.
  SELECT * INTO _sub FROM bond_subscriptions WHERE id = _sub_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND'; END IF;
  IF _sub.status <> 'pending' THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_PENDING: %', _sub.status;
  END IF;

  SELECT * INTO _bond FROM bonds WHERE id = _sub.bond_id FOR UPDATE;
  IF _bond.status <> 'open' THEN RAISE EXCEPTION 'BOND_NOT_OPEN: %', _bond.status; END IF;

  IF _bond.raised_minor + _sub.amount_minor > _bond.total_size_minor THEN
    INSERT INTO bond_audit_log(bond_id, user_id, event, payload)
      VALUES(_bond.id, _sub.user_id, 'capacity_block',
        jsonb_build_object('requested', _sub.amount_minor,
                           'raised', _bond.raised_minor,
                           'total', _bond.total_size_minor));
    RAISE EXCEPTION 'CAPACITY_EXCEEDED';
  END IF;

  SELECT COALESCE(units_minor, 0) INTO _after
    FROM bond_holdings WHERE bond_id = _bond.id AND user_id = _sub.user_id;
  _after := COALESCE(_after, 0) + _sub.amount_minor;
  _limit := (_bond.total_size_minor * _bond.concentration_limit_bps) / 10000;

  IF _after > _limit THEN
    INSERT INTO bond_audit_log(bond_id, user_id, event, payload)
      VALUES(_bond.id, _sub.user_id, 'concentration_block',
        jsonb_build_object('would_hold', _after, 'limit', _limit));
    RAISE EXCEPTION 'CONCENTRATION_LIMIT_EXCEEDED';
  END IF;

  INSERT INTO bond_holdings(bond_id, user_id, units_minor)
    VALUES(_bond.id, _sub.user_id, _sub.amount_minor)
    ON CONFLICT (bond_id, user_id) DO UPDATE
      SET units_minor = bond_holdings.units_minor + EXCLUDED.units_minor,
          updated_at  = now()
    RETURNING * INTO _holding;

  UPDATE bonds
    SET raised_minor = raised_minor + _sub.amount_minor,
        status = CASE WHEN raised_minor + _sub.amount_minor >= total_size_minor
                      THEN 'subscribed' ELSE status END
    WHERE id = _bond.id;

  UPDATE bond_subscriptions
    SET status = 'allocated', allocated_at = now()
    WHERE id = _sub.id;

  INSERT INTO bond_audit_log(bond_id, user_id, event, payload)
    VALUES(_bond.id, _sub.user_id, 'allocation_executed',
      jsonb_build_object('subscription_id', _sub.id, 'amount_minor', _sub.amount_minor));

  RETURN _holding;
END $$;

-- ── Cooling-off cancellation ───────────────────────────────────────────────
-- The original refunded the investor but left their units in the register and the
-- raise total overstated: money back, bonds kept.
CREATE OR REPLACE FUNCTION cancel_subscription(_sub_id UUID)
RETURNS bond_subscriptions
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _sub       bond_subscriptions;
  _bond      bonds;
  _holding   bond_holdings;
  _allocated BOOLEAN;
  _sold      BIGINT;
  _listed    BIGINT;
BEGIN
  SELECT * INTO _sub FROM bond_subscriptions WHERE id = _sub_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND'; END IF;
  IF _sub.status NOT IN ('pending','allocated') THEN RAISE EXCEPTION 'NOT_CANCELLABLE'; END IF;
  IF _sub.cooling_off_expires_at < now() THEN RAISE EXCEPTION 'COOLING_OFF_EXPIRED'; END IF;

  _allocated := (_sub.status = 'allocated');
  SELECT * INTO _bond FROM bonds WHERE id = _sub.bond_id FOR UPDATE;

  IF _allocated THEN
    -- Units already traded away cannot be clawed back from the buyer.
    SELECT COALESCE(SUM(units_minor),0) INTO _sold
      FROM bond_market_trades WHERE bond_id = _sub.bond_id AND seller_id = _sub.user_id;
    IF _sold > 0 THEN RAISE EXCEPTION 'HOLDING_PARTIALLY_SOLD'; END IF;

    -- An open listing would promise units the seller no longer has.
    SELECT COALESCE(SUM(units_minor),0) INTO _listed
      FROM bond_market_listings
      WHERE bond_id = _sub.bond_id AND seller_id = _sub.user_id AND status = 'active';
    IF _listed > 0 THEN RAISE EXCEPTION 'HOLDING_LISTED_FOR_SALE'; END IF;

    SELECT * INTO _holding FROM bond_holdings
      WHERE bond_id = _sub.bond_id AND user_id = _sub.user_id FOR UPDATE;
    IF NOT FOUND OR _holding.units_minor < _sub.amount_minor THEN
      RAISE EXCEPTION 'INSUFFICIENT_UNITS_TO_REVERSE';
    END IF;

    UPDATE bond_holdings
      SET units_minor = units_minor - _sub.amount_minor, updated_at = now()
      WHERE id = _holding.id;

    UPDATE bonds
      SET raised_minor = raised_minor - _sub.amount_minor,
          status = CASE WHEN status = 'subscribed' AND subscription_close_at > now()
                        THEN 'open' ELSE status END
      WHERE id = _bond.id;

    INSERT INTO bond_audit_log(bond_id, user_id, event, payload)
      VALUES(_bond.id, _sub.user_id, 'allocation_reversed',
        jsonb_build_object('units_returned', _sub.amount_minor, 'subscription_id', _sub.id));
  END IF;

  UPDATE bond_subscriptions
    SET status = 'cancelled', cancelled_at = now()
    WHERE id = _sub.id
    RETURNING * INTO _sub;

  INSERT INTO bond_audit_log(bond_id, user_id, event, payload)
    VALUES(_bond.id, _sub.user_id, 'subscription_cancelled',
      jsonb_build_object('subscription_id', _sub.id, 'allocation_reversed', _allocated));

  RETURN _sub;
END $$;

-- ── Secondary market trade ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION execute_trade(
  _listing_id UUID,
  _buyer_id   UUID,
  _units      BIGINT,
  _fee_bps    INT DEFAULT 20          -- Endeleo's 0.2% cut
)
RETURNS bond_market_trades
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _listing bond_market_listings;
  _bond    bonds;
  _seller  bond_holdings;
  _after   BIGINT;
  _limit   BIGINT;
  _price   BIGINT;
  _fee     BIGINT;
  _trade   bond_market_trades;
BEGIN
  IF _units <= 0 THEN RAISE EXCEPTION 'UNITS_MUST_BE_POSITIVE'; END IF;

  SELECT * INTO _listing FROM bond_market_listings WHERE id = _listing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LISTING_NOT_FOUND'; END IF;
  IF _listing.status <> 'active' THEN RAISE EXCEPTION 'LISTING_NOT_ACTIVE'; END IF;
  IF _units > _listing.units_minor THEN RAISE EXCEPTION 'UNITS_EXCEED_LISTING'; END IF;
  IF _listing.seller_id = _buyer_id THEN RAISE EXCEPTION 'SELF_TRADE_FORBIDDEN'; END IF;
  IF _listing.expires_at IS NOT NULL AND _listing.expires_at < now() THEN
    RAISE EXCEPTION 'LISTING_EXPIRED';
  END IF;

  SELECT * INTO _bond FROM bonds WHERE id = _listing.bond_id FOR UPDATE;
  IF _bond.status NOT IN ('subscribed','active') THEN RAISE EXCEPTION 'BOND_NOT_TRADEABLE'; END IF;

  SELECT * INTO _seller FROM bond_holdings
    WHERE bond_id = _bond.id AND user_id = _listing.seller_id FOR UPDATE;
  IF NOT FOUND OR _seller.units_minor < _units THEN
    RAISE EXCEPTION 'SELLER_INSUFFICIENT_UNITS';
  END IF;

  SELECT COALESCE(units_minor,0) INTO _after
    FROM bond_holdings WHERE bond_id = _bond.id AND user_id = _buyer_id;
  _after := COALESCE(_after,0) + _units;
  _limit := (_bond.total_size_minor * _bond.concentration_limit_bps) / 10000;
  IF _after > _limit THEN
    INSERT INTO bond_audit_log(bond_id, user_id, event, payload)
      VALUES(_bond.id, _buyer_id, 'concentration_block',
        jsonb_build_object('would_hold', _after, 'limit', _limit, 'via', 'trade'));
    RAISE EXCEPTION 'CONCENTRATION_LIMIT_EXCEEDED';
  END IF;

  _price := (_units * _listing.ask_price_bps) / 10000;
  _fee   := (_price * _fee_bps) / 10000;

  UPDATE bond_holdings
    SET units_minor = units_minor - _units, updated_at = now()
    WHERE id = _seller.id;

  INSERT INTO bond_holdings(bond_id, user_id, units_minor)
    VALUES(_bond.id, _buyer_id, _units)
    ON CONFLICT (bond_id, user_id) DO UPDATE
      SET units_minor = bond_holdings.units_minor + EXCLUDED.units_minor,
          updated_at  = now();

  UPDATE bond_market_listings
    SET units_minor = units_minor - _units,
        status      = CASE WHEN units_minor - _units = 0 THEN 'filled' ELSE status END,
        filled_at   = CASE WHEN units_minor - _units = 0 THEN now() ELSE filled_at END
    WHERE id = _listing.id;

  INSERT INTO bond_market_trades(listing_id, bond_id, seller_id, buyer_id, units_minor, price_minor, fee_minor)
    VALUES(_listing.id, _bond.id, _listing.seller_id, _buyer_id, _units, _price, _fee)
    RETURNING * INTO _trade;

  INSERT INTO bond_audit_log(bond_id, user_id, event, payload)
    VALUES(_bond.id, _buyer_id, 'trade_executed',
      jsonb_build_object('trade_id', _trade.id, 'seller', _listing.seller_id,
                         'units', _units, 'price', _price, 'fee', _fee));

  RETURN _trade;
END $$;
