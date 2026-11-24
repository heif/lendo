-- Every rental has a deposit hold = the item's value, set by AI (listings.value_*; legacy listings.deposit_cents is unused).
-- Problems are decided by an AI process: claim, response, rebuttals, ruling, one re-review (claims, claim_entries).
ALTER TABLE listings ADD COLUMN value_cents INTEGER;
ALTER TABLE listings ADD COLUMN value_why TEXT;
ALTER TABLE listings ADD COLUMN value_src TEXT;
ALTER TABLE listings ADD COLUMN value_at INTEGER;
ALTER TABLE listings ADD COLUMN value_appeal TEXT;
ALTER TABLE rentals ADD COLUMN returned_at INTEGER;
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  rental_id TEXT NOT NULL UNIQUE,
  listing_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  deposit_cents INTEGER NOT NULL DEFAULT 0,
  step_due INTEGER,
  award_cents INTEGER,
  ruling TEXT,
  ruled_at INTEGER,
  review_due INTEGER,
  owner_ok INTEGER NOT NULL DEFAULT 0,
  customer_ok INTEGER NOT NULL DEFAULT 0,
  final_cents INTEGER,
  final TEXT,
  final_at INTEGER,
  settled_at INTEGER,
  collected_cents INTEGER NOT NULL DEFAULT 0,
  collect_how TEXT,
  collect_pi TEXT,
  owner_due_cents INTEGER NOT NULL DEFAULT 0,
  paid_out INTEGER NOT NULL DEFAULT 0,
  tries INTEGER NOT NULL DEFAULT 0,
  cb_id TEXT,
  cb_status TEXT,
  cb_cents INTEGER,
  cb_evidence_at INTEGER,
  lendo_loss_cents INTEGER NOT NULL DEFAULT 0,
  owner_excess_cents INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS claims_status ON claims(status);
CREATE TABLE IF NOT EXISTS claim_entries (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  who TEXT NOT NULL,
  step TEXT NOT NULL,
  body TEXT,
  photos TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS claim_entries_claim ON claim_entries(claim_id, at);
INSERT OR IGNORE INTO settings (key, value) VALUES ('guarantee_cap_cents', '25000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('cb_auto_submit', '0');
