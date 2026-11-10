-- $5 promo credit used on a rental, and the price before an owner discount (for flagging lots of free rentals).
ALTER TABLE rentals ADD COLUMN credit_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rentals ADD COLUMN list_rent_cents INTEGER;
