-- Backfills the six due-diligence items added to BondsService.seedChecklist() — the
-- SEC Nigeria filing set, plus the board resolution and legal opinion — onto bonds
-- that already existed when those items were introduced. Seeding only runs at bond
-- creation, so without this only bonds created after that change would ever have them.
--
-- INSERT-only and idempotent. The NOT EXISTS guard matches on (bond_id, label), so
-- re-running is a no-op, an item an admin already added by hand is never duplicated,
-- and no existing row's status, notes, evidence or sort_order is modified.
--
-- Scope is deliberately bonds still in flight. A matured, defaulted or closed bond's
-- arrangement is finished; adding filing items nobody will ever complete would only
-- drag its completeness percentage down for no reason. Add those statuses to the IN
-- list below if they are wanted after all.
--
-- sort_order runs 8-13 rather than matching the 2/8/10-13 a newly seeded bond gets.
-- The portal groups items by `area` before rendering, so within each area the
-- resulting order is identical either way — and this avoids having to UPDATE the
-- sort_order of rows that already exist.

INSERT INTO "sponsor_checklist_items" ("bond_id", "kind", "area", "label", "sort_order", "updated_at")
SELECT b."id", 'due_diligence'::"checklist_kind", v."area", v."label", v."sort_order", now()
FROM "bonds" b
CROSS JOIN (VALUES
  ('Corporate',  'Board resolution authorising the bond issuance',           8),
  ('Legal',      'Legal opinion from qualified capital markets counsel',     9),
  ('Regulatory', 'SEC Form 2 (Offer for Subscription)',                     10),
  ('Regulatory', 'Information Memorandum (draft, pending legal sign-off)',  11),
  ('Regulatory', 'Directors'' particulars and fit-and-proper declarations', 12),
  ('Regulatory', 'Application for listing (FMDQ / NSE)',                    13)
) AS v("area", "label", "sort_order")
WHERE b."status" IN ('draft', 'open', 'subscribed', 'active')
  AND NOT EXISTS (
    SELECT 1 FROM "sponsor_checklist_items" c
    WHERE c."bond_id" = b."id" AND c."label" = v."label"
  );
