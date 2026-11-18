-- Android phones: their texts (RCS) don't reach Lendo's iMessage number, so they log in on the web and are never paused for not texting back
ALTER TABLE users ADD COLUMN android INTEGER NOT NULL DEFAULT 0;
