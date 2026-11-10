-- Readable URLs: lendo.co/<handle> and lendo.co/<handle>/<item-slug>
ALTER TABLE users ADD COLUMN handle TEXT;
CREATE UNIQUE INDEX users_handle ON users(handle);
ALTER TABLE listings ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX listings_owner_slug ON listings(owner_id, slug);
-- 4-char short code per item for texts / QR: lendo.co/b7k2
ALTER TABLE listings ADD COLUMN code TEXT;
CREATE UNIQUE INDEX listings_code ON listings(code);
