-- Customer's signed promise to the owner (community agreement): 3 checks + finger signature, needed before pickup
ALTER TABLE rentals ADD COLUMN promise_at INTEGER;
ALTER TABLE rentals ADD COLUMN promise_sig TEXT;
ALTER TABLE rentals ADD COLUMN promise_nudged INTEGER NOT NULL DEFAULT 0;
