-- Message strips above the ticker (Scott, 11/27): admin-set, by audience, one shows at a time
CREATE TABLE IF NOT EXISTS strips (
  id TEXT PRIMARY KEY,
  on_ INTEGER NOT NULL DEFAULT 1,
  msg TEXT NOT NULL,
  link TEXT,
  who TEXT NOT NULL DEFAULT '',      -- comma list: in,out,owner,customer,neither ('' = everyone)
  cities TEXT NOT NULL DEFAULT '',   -- comma list of city ids ('' = all)
  hoods TEXT NOT NULL DEFAULT '',    -- comma list of hood names ('' = all)
  device TEXT NOT NULL DEFAULT 'all',-- all | phone | computer
  start_day TEXT, end_day TEXT,      -- YYYY-MM-DD, inclusive, NY time
  style TEXT NOT NULL DEFAULT 'orange', -- orange | cream | ticker | ink
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
