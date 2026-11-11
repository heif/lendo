-- Extend a rental: customer picks a later return day → card hold for the extra days → owner YES → capture, end_day moves.
CREATE TABLE IF NOT EXISTS rental_extensions (
  id TEXT PRIMARY KEY,
  rental_id TEXT NOT NULL REFERENCES rentals(id),
  listing_id TEXT NOT NULL,
  from_day TEXT NOT NULL,                -- first extra day (old end_day + 1)
  new_end TEXT NOT NULL,
  days INTEGER NOT NULL,
  rent_cents INTEGER NOT NULL,           -- extra rent → owner
  fee_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested', -- requested → held → confirmed | declined | expired | canceled
  stripe_checkout_id TEXT,
  stripe_payment_intent TEXT,
  paid_out INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rental_extensions_rental ON rental_extensions(rental_id, status);
CREATE INDEX IF NOT EXISTS rental_extensions_listing ON rental_extensions(listing_id, status);
