-- Brand/model autocomplete learns from what owners post with a stock photo (per "What have you got?" idea); shown once 2+ owners used it
CREATE TABLE IF NOT EXISTS ac_terms (idea TEXT NOT NULL, term TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 1, last_at INTEGER, PRIMARY KEY (idea, term));
