-- Saved-search alerts: every search is saved automatically (Turn off anytime). 1 text/day unless they reply YES for more;
-- held matches go out in a morning bundle.
CREATE TABLE saved_searches (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, query TEXT NOT NULL, lat REAL, lng REAL, hood TEXT, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX saved_searches_user_q ON saved_searches(user_id, query);
CREATE TABLE alert_queue (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, search_id TEXT NOT NULL, listing_id TEXT NOT NULL, created_at INTEGER NOT NULL, sent_at INTEGER);
CREATE UNIQUE INDEX alert_queue_once ON alert_queue(user_id, listing_id);
ALTER TABLE users ADD COLUMN alert_day TEXT;
ALTER TABLE users ADD COLUMN alert_sent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN alert_more INTEGER NOT NULL DEFAULT 0;
