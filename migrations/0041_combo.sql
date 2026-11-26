-- One charge for several items answered YES together (Scott, 11/25): combo_pi = the shared charge; hold_pi = the item's own hold it replaced
ALTER TABLE rentals ADD COLUMN combo_pi TEXT;
ALTER TABLE rentals ADD COLUMN hold_pi TEXT;
