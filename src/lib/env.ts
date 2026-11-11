export type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  AI?: Ai;
  APP_URL: string;
  FEE_PCT: string;
  MIN_PRICE_CENTS: string;
  BLOOIO_API_BASE: string;
  LENDO_NUMBER: string; // the Blooio number, for "save this contact" prompts
  MAPBOX_PUBLIC_TOKEN?: string;  // pk., URL-restricted (secret in prod, .dev.vars locally); unset → Leaflet fallback
  MAPBOX_STYLE_URL: string;      // mapbox://styles/... (light-v11 until a Studio style exists)
  MEETUP_SPOTS: string;          // "true" enables /api/meetup
  WANTED_PROMO: string;          // "true" → WANTED posters with "REWARD for listing"; else plain greyed ghost items
  ADMIN_PHONES: string;          // comma-separated E.164 numbers allowed into /admin
  SESSION_SECRET: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  BLOOIO_API_KEY?: string;
  BLOOIO_WEBHOOK_SECRET?: string;
  MAPBOX_SECRET_TOKEN?: string;
  TWILIO_ACCOUNT_SID?: string;    // login codes by SMS via Twilio Verify (works on Android / non-iMessage); unset → Blooio
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_API_KEY_SID?: string;    // optional instead of the auth token: an API key (SK…) + its secret
  TWILIO_API_KEY_SECRET?: string;
  TWILIO_VERIFY_SID?: string;     // VA… service id
  ANTHROPIC_API_KEY?: string;     // plain-English texting (intent.ts)  // sk., never sent to the client
};

export type User = {
  id: string; phone: string; name: string | null; hood: string | null; cross_streets: string | null;
  lat: number | null; lng: number | null; pickup_spots: string | null; stripe_account_id: string | null;
  stripe_customer_id: string | null; nudges: number; texts: number; replied: number; address: string | null; mapbox_id: string | null; geocoded_at: number | null; hood_id: string | null; created_at: number; alert_day?: string | null; alert_sent?: number; alert_more?: number;
  promo_cents: number; promo_claimed_at: number | null; demo: number;
  admin?: boolean; // set by loadUser from ADMIN_PHONES
};

export type Listing = {
  id: string; owner_id: string; name: string; description: string | null; price_cents: number; week_cents: number | null;
  deposit_cents: number; status: 'live' | 'paused' | 'review' | 'removed'; hood: string | null; hood_id: string | null; lat: number | null; lng: number | null; emoji: string | null; avatar_key: string | null; avatar_style: string | null; demo: number; created_at: number; grade?: string;
};

export type Rental = {
  id: string; listing_id: string; owner_id: string; renter_id: string; start_day: string; end_day: string; days: number;
  rent_cents: number; fee_cents: number; total_cents: number;
  promise_at?: number | null; promise_sig?: string | null; promise_nudged?: number;
  status: 'inquiry' | 'requested' | 'held' | 'confirmed' | 'picked_up' | 'returned' | 'closed' | 'declined' | 'expired' | 'canceled';
  stripe_checkout_id: string | null; stripe_payment_intent: string | null; paid_out: number; meet_spot: string | null;
  pickup_photo_key: string | null; return_photo_key: string | null;
  renter_rating: number | null; renter_review: string | null; owner_rating: number | null; owner_review: string | null;
  created_at: number; updated_at: number; expires_at: number | null;
  held_at: number | null; owner_nudges: number; alts: string | null; credit_cents: number; list_rent_cents: number | null; late_cancel: number;
};

export type Vars = { user: User | null };
