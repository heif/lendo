-- Daily prices can go down to $1; every rental charges at least $5 (util.ts MIN_RENT_CENTS). Scott, 11/24
UPDATE settings SET value = '100' WHERE key = 'price_min_cents';
