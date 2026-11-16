-- Secondary-market trades now settle cash, not just units.
--
-- Until now execute_trade moved units seller -> buyer and recorded a price and a fee, but
-- never touched a wallet: the buyer got the units for nothing and the seller was never
-- paid. This redefines it so the money moves in the same transaction as the units —
-- either the whole trade happens or none of it does.
--
-- Who pays what:
--   buyer   is debited the price (units x ask price) — exactly what the Buy dialog quotes.
--   seller  is credited the price, then charged the 0.2% platform fee.
--
-- Ledger rows all carry reference 'trade:<trade id>', which is also how the backfill at
-- the bottom tells a settled trade from an unsettled one.

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
  _buyer_wallet  wallets;
  _seller_wallet wallets;
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

  -- Cash leg. Make sure both wallets exist, then lock them in a fixed order (by user id)
  -- so two trades running in opposite directions cannot deadlock on each other.
  INSERT INTO wallets(user_id, currency, updated_at)
    VALUES (_buyer_id, _bond.currency::text, now()), (_listing.seller_id, _bond.currency::text, now())
    ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM wallets WHERE user_id IN (_buyer_id, _listing.seller_id)
    ORDER BY user_id FOR UPDATE;
  SELECT * INTO _buyer_wallet  FROM wallets WHERE user_id = _buyer_id;
  SELECT * INTO _seller_wallet FROM wallets WHERE user_id = _listing.seller_id;

  -- A wallet holds one currency; settling an NGN bond out of a USD wallet would be a
  -- silent conversion at no rate at all.
  IF _buyer_wallet.currency <> _bond.currency::text
     OR _seller_wallet.currency <> _bond.currency::text THEN
    RAISE EXCEPTION 'WALLET_CURRENCY_MISMATCH';
  END IF;
  IF _buyer_wallet.balance_minor < _price THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS'; END IF;

  UPDATE wallets SET balance_minor = balance_minor - _price, updated_at = now()
    WHERE user_id = _buyer_id;
  UPDATE wallets SET balance_minor = balance_minor + _price - _fee, updated_at = now()
    WHERE user_id = _listing.seller_id;

  -- Units leg (unchanged).
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

  -- What each side sees on their wallet's activity list.
  INSERT INTO wallet_transactions(user_id, kind, status, amount_minor, method, reference, note, completed_at)
    VALUES
      (_buyer_id, 'investment', 'completed', _price, 'market', 'trade:' || _trade.id,
        'Bought ' || _bond.title || ' units from another investor', now()),
      (_listing.seller_id, 'payout', 'completed', _price, 'market', 'trade:' || _trade.id,
        'Sold ' || _bond.title || ' units to another investor', now());
  IF _fee > 0 THEN
    INSERT INTO wallet_transactions(user_id, kind, status, amount_minor, method, reference, note, completed_at)
      VALUES (_listing.seller_id, 'fee', 'completed', _fee, 'market', 'trade:' || _trade.id,
        '0.2% platform fee on the sale of ' || _bond.title || ' units', now());
  END IF;

  INSERT INTO bond_audit_log(bond_id, user_id, event, payload)
    VALUES(_bond.id, _buyer_id, 'trade_executed',
      jsonb_build_object('trade_id', _trade.id, 'seller', _listing.seller_id,
                         'units', _units, 'price', _price, 'fee', _fee));

  RETURN _trade;
END $$;

-- Backfill: settle the cash for trades executed before this fix. A trade counts as
-- settled once any wallet row references it, so re-running this is a no-op. A trade whose
-- buyer can no longer cover the price is left alone (with a notice) rather than driving
-- a wallet negative — someone has to decide that one by hand.
DO $$
DECLARE
  t       RECORD;
  _bal    BIGINT;
  _title  TEXT;
BEGIN
  FOR t IN
    SELECT tr.* FROM bond_market_trades tr
    WHERE NOT EXISTS (
      SELECT 1 FROM wallet_transactions w WHERE w.reference = 'trade:' || tr.id
    )
    ORDER BY tr.executed_at
  LOOP
    SELECT title INTO _title FROM bonds WHERE id = t.bond_id;
    INSERT INTO wallets(user_id, currency, updated_at)
      VALUES (t.buyer_id, 'NGN', now()), (t.seller_id, 'NGN', now())
      ON CONFLICT (user_id) DO NOTHING;
    PERFORM 1 FROM wallets WHERE user_id IN (t.buyer_id, t.seller_id) ORDER BY user_id FOR UPDATE;
    SELECT balance_minor INTO _bal FROM wallets WHERE user_id = t.buyer_id;

    IF _bal < t.price_minor THEN
      RAISE NOTICE 'trade % not settled: buyer % holds % but owes %', t.id, t.buyer_id, _bal, t.price_minor;
      CONTINUE;
    END IF;

    UPDATE wallets SET balance_minor = balance_minor - t.price_minor, updated_at = now()
      WHERE user_id = t.buyer_id;
    UPDATE wallets SET balance_minor = balance_minor + t.price_minor - t.fee_minor, updated_at = now()
      WHERE user_id = t.seller_id;

    INSERT INTO wallet_transactions(user_id, kind, status, amount_minor, method, reference, note, completed_at)
      VALUES
        (t.buyer_id, 'investment', 'completed', t.price_minor, 'market', 'trade:' || t.id,
          'Bought ' || _title || ' units from another investor', t.executed_at),
        (t.seller_id, 'payout', 'completed', t.price_minor, 'market', 'trade:' || t.id,
          'Sold ' || _title || ' units to another investor', t.executed_at);
    IF t.fee_minor > 0 THEN
      INSERT INTO wallet_transactions(user_id, kind, status, amount_minor, method, reference, note, completed_at)
        VALUES (t.seller_id, 'fee', 'completed', t.fee_minor, 'market', 'trade:' || t.id,
          '0.2% platform fee on the sale of ' || _title || ' units', t.executed_at);
    END IF;

    INSERT INTO bond_audit_log(bond_id, user_id, event, payload)
      VALUES (t.bond_id, t.buyer_id, 'trade_cash_backfilled',
        jsonb_build_object('trade_id', t.id, 'price', t.price_minor, 'fee', t.fee_minor));
  END LOOP;
END $$;
