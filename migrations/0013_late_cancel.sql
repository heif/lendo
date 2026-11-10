-- Customer canceled after the owner said YES: 50% refunded, owner keeps half the rent (paid out like a pickup).
ALTER TABLE rentals ADD COLUMN late_cancel INTEGER NOT NULL DEFAULT 0;
