-- Give the sample bonds the sector and location they were always meant to have.
--
-- prisma/seed.ts created them without either, leaving it to a frontend fixture
-- (projects.ts) to fill both in from the project slug. That fixture is gone, so every one
-- of these bonds showed no sector tag and landed under "Other" in the investor's sector
-- allocation chart. Only empty values are filled — anything an admin has set is kept.
-- seed.ts now sets the same values (its STORY map), so a fresh seed matches.
UPDATE bonds b
SET sector   = COALESCE(b.sector, v.sector),
    location = COALESCE(b.location, v.location)
FROM (VALUES
  ('lagos-solar'      , 'Energy'           , 'Lagos State'),
  ('abuja-healthcare' , 'Healthcare'       , 'Abuja'),
  ('ph-water'         , 'Utilities'        , 'Port Harcourt'),
  ('ibadan-edu'       , 'Education'        , 'Ibadan'),
  ('ng-highway'       , 'Transport'        , 'Nationwide'),
  ('kaduna-agri'      , 'Agriculture'      , 'Kaduna State'),
  ('lagos-housing'    , 'Housing'          , 'Lagos State'),
  ('obudu-tourism'    , 'Tourism'          , 'Cross River State'),
  ('lagos-waste'      , 'Waste Management' , 'Lagos State'),
  ('abuja-sports'     , 'Sports'           , 'FCT — Abuja')
) AS v(slug, sector, location)
WHERE b.project_slug = v.slug
  AND (b.sector IS NULL OR b.location IS NULL);
