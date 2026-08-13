-- A fully-sold listing legitimately holds zero remaining units.
--
-- The original CHECK (units_minor > 0) rejected exactly that, so any trade which
-- consumed a whole listing failed at the final UPDATE. The real rule is that a listing
-- must have units to sell *while it is active*; once filled, cancelled or expired,
-- zero is the correct value.

ALTER TABLE bond_market_listings
  DROP CONSTRAINT listing_positive_units,
  ADD CONSTRAINT listing_units_positive_while_active
    CHECK (units_minor > 0 OR status <> 'active'),
  ADD CONSTRAINT listing_units_non_negative CHECK (units_minor >= 0);
