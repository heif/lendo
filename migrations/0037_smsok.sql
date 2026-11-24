-- optional rental-text opt-in (Twilio 10DLC: texts must be optional). NULL = joined before 11/24 under the old terms (treated as yes), 1 = checked the box or texted Lendo, 0 = left it unchecked
ALTER TABLE users ADD COLUMN sms_ok INTEGER;
