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
  RESEND_API_KEY?: string;        // email (backup channel) via Resend; unset → emails are only logged
  EMAIL_FROM?: string;            // default "Lendo <hi@lendo.co>"
  LINQ_API_KEY?: string;          // set → all texts go through Linq instead of Blooio
  LINQ_WEBHOOK_SECRET?: string;   // whsec_… from the Linq webhook subscription
  MAPBOX_SECRET_TOKEN?: string;
  TWILIO_ACCOUNT_SID?: string;    // login codes by SMS via Twilio Verify (works on Android / non-iMessage); unset → Blooio
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_API_KEY_SID?: string;    // optional instead of the auth token: an API key (SK…) + its secret
  TWILIO_API_KEY_SECRET?: string;
  TWILIO_VERIFY_SID?: string;
  TWILIO_SMS_FROM?: string;       // registered 10DLC number (+1…) for Android users; unset = off     // VA… service id
  CF_VERSION_METADATA?: { id: string; tag?: string };  // this deploy's id: cache-busts /app.css, /map.js…
  BRAVE_API_KEY?: string;         // standard product photos for no-photo listings (Brave image search)
  ANTHROPIC_API_KEY?: string;     // plain-English texting (intent.ts)  // sk., never sent to the client
};

export type User = {
  id: string; phone: string; name: string | null; hood: string | null; cross_streets: string | null;
  lat: number | null; lng: number | null; pickup_spots: string | null; stripe_account_id: string | null;
  stripe_customer_id: string | null; nudges: number; texts: number; replied: number; sms_ok?: number | null; email?: string | null; address: string | null; mapbox_id: string | null; geocoded_at: number | null; hood_id: string | null; created_at: number; alert_day?: string | null; alert_sent?: number; alert_more?: number;
  promo_cents: number; promo_claimed_at: number | null; demo: number; photo_key?: string | null; ig?: string | null; x?: string | null; linkedin?: string | null;
  admin?: boolean; // set by loadUser: ADMIN_PHONES (owner) or admin_role granted at /admin/access
  admin_role?: string | null; // 'view' | 'full' (granted); owner = ADMIN_PHONES
  admin_level?: 'owner' | 'full' | 'view' | null;
  as_from?: string | null; // owner admin is viewing as this user (Log in as); original user's first name
  has_rentals?: boolean; // set by loadUser: any rental as owner or customer
  unread?: number; // set by loadUser: new messages from people + requests waiting for a YES
};

export type Listing = {
  id: string; owner_id: string; name: string; description: string | null; price_cents: number; week_cents: number | null;
  deposit_cents: number; status: 'live' | 'paused' | 'review' | 'removed'; paused_why?: string | null; stock_photo?: number; hood: string | null; hood_id: string | null; lat: number | null; lng: number | null; emoji: string | null; avatar_key: string | null; avatar_style: string | null; demo: number; created_at: number; grade?: string;
  value_cents?: number | null; value_why?: string | null; value_src?: 'ai' | 'appeal' | 'est' | null; value_at?: number | null; value_appeal?: string | null; value_nudged?: number; issues?: string | null; /* issues: what's wrong with it, asked when the grade isn't A */ /* item value = deposit hold, set by AI */
};

export type Rental = {
  id: string; listing_id: string; owner_id: string; renter_id: string; start_day: string; end_day: string; days: number;
  rent_cents: number; fee_cents: number; total_cents: number;
  pickup_time?: string | null; return_time?: string | null;
  promise_at?: number | null; promise_sig?: string | null; promise_nudged?: number;
  status: 'inquiry' | 'requested' | 'held' | 'confirmed' | 'picked_up' | 'returned' | 'closed' | 'declined' | 'expired' | 'canceled';
  stripe_checkout_id: string | null; stripe_payment_intent: string | null; paid_out: number; meet_spot: string | null;
  pickup_photo_key: string | null; return_photo_key: string | null;
  renter_rating: number | null; renter_review: string | null; owner_rating: number | null; owner_review: string | null;
  created_at: number; updated_at: number; expires_at: number | null;
  held_at: number | null; owner_nudges: number; alts: string | null; credit_cents: number; list_rent_cents: number | null; late_cancel: number; tax_cents: number; payout_cents: number | null; tax_rate: number;
  deposit_cents?: number; deposit_pi?: string | null; deposit_status?: 'due' | 'held' | 'failed' | 'released' | 'captured' | null; returned_at?: number | null; deposit_at?: number | null; stripe_customer?: string | null; stripe_pm?: string | null;
};

// A problem with a rental, decided by AI. One per rental.
export type ClaimStatus = 'response' | 'rebuttal' | 'reply' | 'judging' | 'ruled' | 'reviewing' | 'final' | 'withdrawn';
export type Claim = {
  id: string; rental_id: string; listing_id: string; owner_id: string; customer_id: string; kind: 'damage' | 'missing' | 'not_returned' | 'other';
  status: ClaimStatus; deposit_cents: number; step_due: number | null;
  award_cents: number | null; ruling: string | null; ruled_at: number | null; review_due: number | null; owner_ok: number; customer_ok: number;
  final_cents: number | null; final: string | null; final_at: number | null; settled_at: number | null;
  collected_cents: number; collect_how: 'hold' | 'card' | 'none' | null; collect_pi: string | null; owner_due_cents: number; paid_out: number; payout_ok: number; payout_by: string | null; payout_at: number | null; tries: number;
  cb_id: string | null; cb_status: string | null; cb_cents: number | null; cb_evidence_at: number | null; lendo_loss_cents: number; owner_excess_cents: number;
  created_at: number; updated_at: number;
};
export type ClaimEntry = { id: string; claim_id: string; who: 'owner' | 'customer' | 'ai'; step: string; body: string | null; photos: string | null; at: number };

export type Vars = { user: User | null };
