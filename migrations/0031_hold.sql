-- $150 hold on items worth over $150 now (listings.deposit_cents, owner toggle). Placed at pickup, released at return.
ALTER TABLE rentals ADD COLUMN deposit_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rentals ADD COLUMN deposit_pi TEXT;
ALTER TABLE rentals ADD COLUMN deposit_status TEXT;
ALTER TABLE rentals ADD COLUMN deposit_at INTEGER;
ALTER TABLE rentals ADD COLUMN stripe_customer TEXT;
ALTER TABLE rentals ADD COLUMN stripe_pm TEXT;
