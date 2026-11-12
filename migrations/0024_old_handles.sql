-- Old profile links keep working after someone changes their handle (lendo.co/old → lendo.co/new).
CREATE TABLE IF NOT EXISTS old_handles (handle TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL);
