// Neighborhood lookup: point-in-polygon over the hoods table, cached per isolate.
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import type { Env } from './env';

type Hood = { id: string; name: string; borough: string | null; geometry: any; bbox: [number, number, number, number] };
let cache: { at: number; hoods: Hood[] } | null = null;
const TTL = 10 * 60 * 1000;

function bboxOf(geom: any): [number, number, number, number] {
  let w = 180, s = 90, e = -180, n = -90;
  const walk = (c: any) => { if (typeof c[0] === 'number') { if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1]; } else c.forEach(walk); };
  walk(geom.coordinates);
  return [w, s, e, n];
}

export async function loadHoods(env: Env): Promise<Hood[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.hoods;
  const rows = await env.DB.prepare('SELECT id, name, borough, geojson FROM hoods').all<{ id: string; name: string; borough: string | null; geojson: string }>();
  const hoods = rows.results.map(r => { const geometry = JSON.parse(r.geojson); return { id: r.id, name: r.name, borough: r.borough, geometry, bbox: bboxOf(geometry) }; });
  cache = { at: Date.now(), hoods };
  return hoods;
}

export async function hoodAt(env: Env, lat: number, lng: number): Promise<{ id: string; name: string } | null> {
  const hoods = await loadHoods(env);
  const pt = point([lng, lat]);
  for (const h of hoods) {
    const [w, s, e, n] = h.bbox;
    if (lng < w || lng > e || lat < s || lat > n) continue;
    if (booleanPointInPolygon(pt, { type: 'Feature', properties: {}, geometry: h.geometry } as any)) return { id: h.id, name: h.name };
  }
  return null;
}

// Assign hood_id (+ display name) to a user or listing row from its coordinates. Returns the hood or null.
export async function assignHood(env: Env, table: 'users' | 'listings', id: string, lat: number | null, lng: number | null) {
  if (lat == null || lng == null) return null;
  const h = await hoodAt(env, lat, lng);
  if (!h) return null;
  await env.DB.prepare(`UPDATE ${table} SET hood_id = ?, hood = ? WHERE id = ?`).bind(h.id, h.name, id).run();
  return h;
}
