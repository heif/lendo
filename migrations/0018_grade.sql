-- Condition grade: owner sets it when listing (default A); customers grade at return; shown = average.
ALTER TABLE listings ADD COLUMN grade TEXT NOT NULL DEFAULT 'A';
ALTER TABLE rentals ADD COLUMN grade TEXT;
