-- agreed meetup times ("HH:MM", local to the item) for pickup and return; null = not set
ALTER TABLE rentals ADD COLUMN pickup_time TEXT;
ALTER TABLE rentals ADD COLUMN return_time TEXT;
