-- What people send Lendo (by text or from the web inbox), so the inbox reads like a normal chat.
CREATE TABLE IF NOT EXISTS inbound_texts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, body TEXT NOT NULL, via TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS inbound_texts_user ON inbound_texts(user_id, created_at);
