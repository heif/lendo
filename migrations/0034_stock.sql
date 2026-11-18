-- Listing posted with a standard product photo (owner confirmed it looks like this) instead of their own photo
ALTER TABLE listings ADD COLUMN stock_photo INTEGER NOT NULL DEFAULT 0;
