// Server-side Mapbox calls. Only the secret token (sk.) is used here; it never reaches the client.
import type { Env } from './env';

export type Geocoded = { lat: number; lng: number; mapbox_id: string | null; full_address: string | null; hood_hint: string | null };

// Geocoding v6 forward, permanent=true → results may be stored in our DB. Returns null when not configured or no match.
export async function geocodeAddress(env: Env, query: string, proximity?: { lat: number; lng: number } | null): Promise<Geocoded | null> {
  if (!env.MAPBOX_SECRET_TOKEN || !query.trim()) return null;
  const u = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  u.searchParams.set('q', query.trim());
  u.searchParams.set('permanent', 'true');
  u.searchParams.set('limit', '1');
  u.searchParams.set('country', 'US');
  u.searchParams.set('access_token', env.MAPBOX_SECRET_TOKEN);
  if (proximity) u.searchParams.set('proximity', `${proximity.lng},${proximity.lat}`);
  const r = await fetch(u.toString());
  if (!r.ok) { console.warn('geocode', r.status, await r.text().catch(() => '')); return null; }
  const j = (await r.json()) as any;
  const f = j.features?.[0];
  if (!f) return null;
  const c = f.properties?.coordinates || {};
  const ctx = f.properties?.context || {};
  return {
    lat: c.latitude ?? f.geometry?.coordinates?.[1], lng: c.longitude ?? f.geometry?.coordinates?.[0],
    mapbox_id: f.properties?.mapbox_id || f.id || null, full_address: f.properties?.full_address || null,
    hood_hint: ctx.neighborhood?.name || ctx.locality?.name || null,
  };
}

// Matrix API (walking) — durations in seconds between coordinates. Used by /api/meetup.
export async function walkingMatrix(env: Env, coords: [number, number][]): Promise<number[][] | null> {
  if (!env.MAPBOX_SECRET_TOKEN) return null;
  const path = coords.map(c => `${c[0]},${c[1]}`).join(';');
  const r = await fetch(`https://api.mapbox.com/directions-matrix/v1/mapbox/walking/${path}?annotations=duration&access_token=${encodeURIComponent(env.MAPBOX_SECRET_TOKEN)}`);
  if (!r.ok) return null;
  const j = (await r.json()) as any;
  return j.durations || null;
}

// Search Box category search near a point (cafes, libraries). Returns name/address/coords/mapbox_id.
export async function categoryNear(env: Env, category: string, lng: number, lat: number, limit = 6) {
  if (!env.MAPBOX_SECRET_TOKEN) return [];
  const u = new URL(`https://api.mapbox.com/search/searchbox/v1/category/${encodeURIComponent(category)}`);
  u.searchParams.set('proximity', `${lng},${lat}`); u.searchParams.set('limit', String(limit)); u.searchParams.set('access_token', env.MAPBOX_SECRET_TOKEN);
  const r = await fetch(u.toString());
  if (!r.ok) return [];
  const j = (await r.json()) as any;
  return (j.features || []).map((f: any) => ({ name: f.properties?.name, address: f.properties?.full_address || f.properties?.address, mapbox_id: f.properties?.mapbox_id, lng: f.geometry?.coordinates?.[0], lat: f.geometry?.coordinates?.[1] }));
}

// Places details (opening hours). Preview API — callers must try/catch and fall back.
export async function placeDetails(env: Env, mapboxId: string): Promise<any | null> {
  if (!env.MAPBOX_SECRET_TOKEN) return null;
  const r = await fetch(`https://api.mapbox.com/search/details/v1/retrieve/${encodeURIComponent(mapboxId)}?access_token=${encodeURIComponent(env.MAPBOX_SECRET_TOKEN)}&attribute_sets=basic,visit`);
  if (!r.ok) return null;
  const j = (await r.json()) as any;
  return j.features?.[0]?.properties || null;
}

// Tilequery: is this point on a park / water / other non-residential land? (demo seeding sanity; ~1 call per point)
export async function landAt(env: Env, lng: number, lat: number): Promise<{ park: boolean; water: boolean; building: boolean } | null> {
  const tok = env.MAPBOX_SECRET_TOKEN || env.MAPBOX_PUBLIC_TOKEN; if (!tok) return null;
  const r = await fetch(`https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${lng},${lat}.json?radius=0&layers=landuse,water,building,landuse_overlay&limit=10&access_token=${encodeURIComponent(tok)}`);
  if (!r.ok) return null;
  const j: any = await r.json();
  const feats: any[] = j.features || [];
  const cls = (f: any) => String(f.properties?.class || '');
  const park = feats.some(f => (f.properties?.tilequery?.layer === 'landuse' || f.properties?.tilequery?.layer === 'landuse_overlay') && /park|cemetery|pitch|grass|wood|national_park|golf|scrub|agriculture|airport|glacier|rock|sand|wetland/.test(cls(f)));
  const water = feats.some(f => f.properties?.tilequery?.layer === 'water');
  const building = feats.some(f => f.properties?.tilequery?.layer === 'building');
  return { park, water, building };
}
