-- Per-thread "last seen" so the profile circle can show new messages. Existing threads start as read.
CREATE TABLE IF NOT EXISTS thread_reads (user_id TEXT NOT NULL, rental_id TEXT NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY (user_id, rental_id));
INSERT OR IGNORE INTO thread_reads (user_id, rental_id, seen_at) SELECT owner_id, id, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM rentals;
INSERT OR IGNORE INTO thread_reads (user_id, rental_id, seen_at) SELECT renter_id, id, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM rentals;
