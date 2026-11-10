-- Plain-English texts that change money or bookings wait here for "Reply YES" (one per user, 15 min)
CREATE TABLE pending_actions (user_id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
