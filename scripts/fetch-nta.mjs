// Download NYC 2020 Neighborhood Tabulation Areas from NYC Open Data and write data/nyc-ntas.geojson + data/hoods.sql
// Usage: node scripts/fetch-nta.mjs            (then: npx wrangler d1 execute lendo --remote --file data/hoods.sql)
// Dataset: "2020 Neighborhood Tabulation Areas (NTAs)" — https://data.cityofnewyork.us/City-Government/2020-Neighborhood-Tabulation-Areas-NTAs-/9nt8-h7nd
import { writeFileSync, mkdirSync } from 'node:fs';
const URL_ = 'https://data.cityofnewyork.us/api/geospatial/9nt8-h7nd?method=export&format=GeoJSON';
const res = await fetch(URL_);
if (!res.ok) throw new Error('download failed ' + res.status);
const raw = await res.json();
const round = (n) => Math.round(n * 1e5) / 1e5; // ~1 m precision, shrinks the file a lot
const rr = (c) => Array.isArray(c[0]) ? c.map(rr) : [round(c[0]), round(c[1])];
const feats = raw.features
  .filter(f => String(f.properties.ntatype ?? f.properties.NTAType ?? '0') === '0') // 0 = residential; skip parks/cemeteries/airports
  .map(f => ({ type: 'Feature', properties: { id: f.properties.nta2020 || f.properties.NTA2020, name: f.properties.ntaname || f.properties.NTAName, borough: f.properties.boroname || f.properties.BoroName, city: 'New York' }, geometry: { type: f.geometry.type, coordinates: rr(f.geometry.coordinates) } }))
  .filter(f => f.properties.id && f.properties.name);
mkdirSync('data', { recursive: true });
writeFileSync('data/nyc-ntas.geojson', JSON.stringify({ type: 'FeatureCollection', features: feats }));
const esc = (s) => String(s).replace(/'/g, "''");
const sql = ['DELETE FROM hoods WHERE city = \'New York\';', ...feats.map(f => `INSERT INTO hoods (id,name,city,borough,geojson) VALUES ('${esc(f.properties.id)}','${esc(f.properties.name)}','New York','${esc(f.properties.borough)}','${esc(JSON.stringify(f.geometry))}');`)].join('\n');
writeFileSync('data/hoods.sql', sql);
console.log(`wrote ${feats.length} hoods → data/nyc-ntas.geojson, data/hoods.sql`);
