-- Lendo v1 schema (D1 / SQLite)

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,            -- E.164
  name TEXT,                             -- "Fiona S."
  hood TEXT,                             -- home neighborhood
  cross_streets TEXT,                    -- shown to renters; never the address
  lat REAL, lng REAL,                    -- home base (fuzzed when shown)
  pickup_spots TEXT,                     -- JSON array of strings
  stripe_account_id TEXT,                -- Connect Express account (owner payouts)
  stripe_customer_id TEXT,
  nudges INTEGER NOT NULL DEFAULT 1,     -- 0 after "STOP NUDGES"
  texts INTEGER NOT NULL DEFAULT 1,      -- 0 after "STOP" (money/pickup texts still go out? no: full stop)
  created_at INTEGER NOT NULL
);

CREATE TABLE otp_codes (
  phone TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE listings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL,          -- per day
  week_cents INTEGER,                    -- per week (default 30% off 7 days)
  deposit_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'live',   -- live | paused | removed
  hood TEXT,
  lat REAL, lng REAL,                    -- fuzzed ~100m for display
  created_at INTEGER NOT NULL
);
CREATE INDEX listings_geo ON listings(status, lat, lng);
CREATE INDEX listings_owner ON listings(owner_id);
CREATE INDEX listings_hood ON listings(hood);

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  r2_key TEXT NOT NULL,
  pos INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX photos_listing ON photos(listing_id);

CREATE TABLE blocked_days (                -- owner blocked a day manually
  listing_id TEXT NOT NULL REFERENCES listings(id),
  day TEXT NOT NULL,                     -- YYYY-MM-DD
  PRIMARY KEY (listing_id, day)
);

CREATE TABLE rentals (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  renter_id TEXT NOT NULL REFERENCES users(id),
  start_day TEXT NOT NULL,               -- YYYY-MM-DD inclusive
  end_day TEXT NOT NULL,                 -- YYYY-MM-DD inclusive
  days INTEGER NOT NULL,
  rent_cents INTEGER NOT NULL,           -- goes to owner
  fee_cents INTEGER NOT NULL,            -- Lendo's 15%, paid by renter
  total_cents INTEGER NOT NULL,          -- rent + fee, charged to renter
  -- state machine:
  -- requested (checkout not finished) -> held (card authorized, waiting for owner YES)
  -- -> confirmed (captured) -> picked_up -> returned -> closed
  -- or: declined | expired | canceled
  status TEXT NOT NULL DEFAULT 'requested',
  stripe_checkout_id TEXT,
  stripe_payment_intent TEXT,
  paid_out INTEGER NOT NULL DEFAULT 0,   -- rent transferred to owner's Stripe account
  meet_spot TEXT,
  pickup_photo_key TEXT,
  return_photo_key TEXT,
  renter_rating INTEGER, renter_review TEXT,   -- renter rates the owner/item
  owner_rating INTEGER, owner_review TEXT,     -- owner rates the renter
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER                      -- held request auto-expires
);
CREATE INDEX rentals_owner ON rentals(owner_id, status);
CREATE INDEX rentals_renter ON rentals(renter_id, status);
CREATE INDEX rentals_listing ON rentals(listing_id, start_day, end_day);
CREATE INDEX rentals_pi ON rentals(stripe_payment_intent);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  rental_id TEXT NOT NULL REFERENCES rentals(id),
  sender_id TEXT,                        -- NULL = system
  body TEXT NOT NULL,
  via TEXT NOT NULL DEFAULT 'web',       -- web | text | system
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_rental ON messages(rental_id, created_at);

-- every text Lendo sends, so the Inbox page can show "what we text you"
CREATE TABLE outbound_texts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  category TEXT NOT NULL,                -- login | rental | money | pickup | nudge | milestone
  rental_id TEXT,
  provider_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX outbound_user ON outbound_texts(user_id, created_at);

CREATE TABLE saved (
  user_id TEXT NOT NULL REFERENCES users(id),
  listing_id TEXT NOT NULL REFERENCES listings(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, listing_id)
);
