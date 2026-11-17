-- Listings of owners who never texted Lendo back get paused after 1 hour (Blooio can't reach them); back live on their first text
ALTER TABLE listings ADD COLUMN paused_why TEXT;
