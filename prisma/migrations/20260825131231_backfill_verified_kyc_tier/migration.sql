-- Verified investors were left at kyc_tier 0.
--
-- profiles.kyc_status and users.kyc_tier are separate fields, and KYC submission only
-- ever set the status. The UI read the status and showed "Verified", while the
-- subscription and market gates compared against the tier and refused every bond
-- (bonds.kyc_tier_required defaults to 1). The legacy Supabase schema had no user-side
-- tier at all, so nothing ever populated it.
--
-- Only raises: an admin-granted tier 2 or 3 is left alone.
UPDATE "users" u
SET "kyc_tier" = 1
FROM "profiles" p
WHERE p."user_id" = u."id"
  AND p."kyc_status" = 'verified'
  AND u."kyc_tier" < 1;
