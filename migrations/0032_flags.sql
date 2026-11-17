-- People flag items, profiles, rentals (after return) and messages; routed to admins/agent by category
CREATE TABLE IF NOT EXISTS flags (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,          -- item | user | rental | message
  target_id TEXT NOT NULL,
  rental_id TEXT,
  reason TEXT NOT NULL,
  category TEXT NOT NULL,      -- safety | money | scam | listing | notallowed | noshow | other
  note TEXT,
  reporter_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new', -- new | looking | done
  assignee TEXT,
  agent_note TEXT,
  admin_note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS flags_status ON flags(status, created_at);
