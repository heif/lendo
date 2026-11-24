-- email: required, asked on the welcome screen; used for receipts and when a text isn't answered
ALTER TABLE users ADD COLUMN email TEXT;
