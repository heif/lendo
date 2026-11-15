-- condition grades are now A great · B good · C ok · D poor · E junk (F → E)
UPDATE listings SET grade = 'E' WHERE grade = 'F';
UPDATE rentals SET grade = 'E' WHERE grade = 'F';
