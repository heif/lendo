-- $5-off promo credit claimed from the map's phone bar; applied to the first rental.
ALTER TABLE users ADD COLUMN promo_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN promo_claimed_at INTEGER;
