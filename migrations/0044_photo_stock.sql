-- a stock (web) photo added next to the owner's own photos (Scott, 11/27): doesn't count as a photo of their own
ALTER TABLE photos ADD COLUMN stock INTEGER;
