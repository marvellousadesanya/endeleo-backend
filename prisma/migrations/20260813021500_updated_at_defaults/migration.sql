-- `updated_at` is maintained by the database, not only by Prisma.
--
-- Prisma's @updatedAt is applied in application code. Anything writing over raw SQL —
-- the allocation, trade and cancellation procedures — bypasses it, so an INSERT hit a
-- NOT NULL column with no default, and an UPDATE left the timestamp stale.
--
-- A default plus a trigger makes the column true regardless of the write path.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'users', 'user_credentials',
    'bonds', 'bond_subscriptions', 'bond_holdings',
    'bond_coupon_payments', 'bond_escrow_accounts', 'bond_market_listings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN updated_at SET DEFAULT now()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_set_updated_at', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END $$;
