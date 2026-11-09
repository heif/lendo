-- Neighborhoods (NYC NTA 2020 to start). Polygons stored as GeoJSON text; point-in-polygon in the Worker.
CREATE TABLE hoods (
  id TEXT PRIMARY KEY,          -- e.g. NTA code MN0501
  name TEXT NOT NULL,
  city TEXT NOT NULL,           -- 'New York'
  borough TEXT,
  geojson TEXT NOT NULL         -- Polygon or MultiPolygon geometry
);
ALTER TABLE users ADD COLUMN hood_id TEXT REFERENCES hoods(id);
ALTER TABLE listings ADD COLUMN hood_id TEXT REFERENCES hoods(id);
CREATE INDEX listings_hood_id ON listings(hood_id);
