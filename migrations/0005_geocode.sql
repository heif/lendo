-- Permanent geocoding (Mapbox Geocoding v6, permanent=true) — results may be stored.
ALTER TABLE users ADD COLUMN address TEXT;            -- raw pickup address as the owner entered/selected it
ALTER TABLE users ADD COLUMN mapbox_id TEXT;
ALTER TABLE users ADD COLUMN geocoded_at INTEGER;
ALTER TABLE listings ADD COLUMN mapbox_id TEXT;
ALTER TABLE listings ADD COLUMN geocoded_at INTEGER;
