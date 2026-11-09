-- Demo data (seeded showcase city). demo=1 rows are fake: shown everywhere, but renting is blocked at the item page button.
ALTER TABLE users ADD COLUMN demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE listings ADD COLUMN demo INTEGER NOT NULL DEFAULT 0;
