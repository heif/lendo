-- Owner reply reminders (30m / 1h / 2h) and nearby alternatives for the customer at 4h.
ALTER TABLE rentals ADD COLUMN held_at INTEGER;
ALTER TABLE rentals ADD COLUMN owner_nudges INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rentals ADD COLUMN alts TEXT;          -- JSON array of listing ids suggested to the customer (null = not sent yet)
