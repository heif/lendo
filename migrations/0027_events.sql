-- append-only activity log: rental state changes, money movements, Stripe webhooks, logins, listings, admin actions, searches, errors
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, user_id TEXT, rental_id TEXT, listing_id TEXT, amount_cents INTEGER, data TEXT);
CREATE INDEX IF NOT EXISTS events_at ON events (at);
CREATE INDEX IF NOT EXISTS events_kind ON events (kind, at);
CREATE INDEX IF NOT EXISTS events_user ON events (user_id, at);
CREATE INDEX IF NOT EXISTS events_rental ON events (rental_id, at);
