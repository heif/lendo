-- has the user ever texted us back? (Blooio caps new conversations at 3 outbound before a reply; iOS spam-filters links from unknown senders)
ALTER TABLE users ADD COLUMN replied INTEGER NOT NULL DEFAULT 0;
