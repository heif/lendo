export type Env = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  APP_URL: string;
  FEE_PCT: string;
  MIN_PRICE_CENTS: string;
  BLOOIO_API_BASE: string;
  SESSION_SECRET: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  BLOOIO_API_KEY?: string;
  BLOOIO_WEBHOOK_SECRET?: string;
};

export type User = {
  id: string; phone: string; name: string | null; hood: string | null; cross_streets: string | null;
  lat: number | null; lng: number | null; pickup_spots: string | null; stripe_account_id: string | null;
  stripe_customer_id: string | null; nudges: number; texts: number; created_at: number;
};

export type Listing = {
  id: string; owner_id: string; name: string; description: string | null; price_cents: number; week_cents: number | null;
  deposit_cents: number; status: 'live' | 'paused' | 'removed'; hood: string | null; lat: number | null; lng: number | null; created_at: number;
};

export type Rental = {
  id: string; listing_id: string; owner_id: string; renter_id: string; start_day: string; end_day: string; days: number;
  rent_cents: number; fee_cents: number; total_cents: number;
  status: 'requested' | 'held' | 'confirmed' | 'picked_up' | 'returned' | 'closed' | 'declined' | 'expired' | 'canceled';
  stripe_checkout_id: string | null; stripe_payment_intent: string | null; paid_out: number; meet_spot: string | null;
  pickup_photo_key: string | null; return_photo_key: string | null;
  renter_rating: number | null; renter_review: string | null; owner_rating: number | null; owner_review: string | null;
  created_at: number; updated_at: number; expires_at: number | null;
};

export type Vars = { user: User | null };
