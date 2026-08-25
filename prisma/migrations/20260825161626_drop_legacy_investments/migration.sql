-- Remove the legacy pre-bond-engine investment product.
--
-- `investments` and `payouts` predate the bond engine: they modelled a flat "put in X,
-- get Y% over Z months" arrangement with no escrow, allocation or cooling-off, and
-- referenced a project by loose text rather than a foreign key. Bonds, subscriptions and
-- holdings replace all of it.
--
-- The dashboard was still reading these tables after the portfolio had moved onto bond
-- data, so the two pages disagreed about what the investor owned. Dropping the tables
-- removes the second source of truth rather than leaving it to drift.
DROP TABLE IF EXISTS "payouts";
DROP TABLE IF EXISTS "investments";
