-- Cost guard: count Mapbox map initializations per day (free tier = 50k loads/month).
CREATE TABLE map_loads_daily (day TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0);
