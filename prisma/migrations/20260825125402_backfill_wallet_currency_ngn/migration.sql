-- Wallets were created USD-only in the Supabase era (balance_usd numeric), before the
-- bond engine introduced a currency concept at all. The platform is Naira-denominated:
-- bonds, escrow and currency_pref all default to NGN. No real balances existed, and the
-- minor unit is 1/100 in both currencies, so amounts carry over untouched — only the
-- label was ever wrong.
UPDATE "wallets" SET "currency" = 'NGN' WHERE "currency" = 'USD';
