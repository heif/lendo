-- sales tax (customer pays) + owner payout after Lendo's fee (fee now comes out of the owner's side)
ALTER TABLE rentals ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rentals ADD COLUMN payout_cents INTEGER;
ALTER TABLE rentals ADD COLUMN tax_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE rental_extensions ADD COLUMN tax_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rental_extensions ADD COLUMN payout_cents INTEGER;
