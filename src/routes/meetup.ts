// Meetup spot suggestions — behind MEETUP_SPOTS flag. Plumbing only in v1.
// midpoint by walking time (Matrix API) → Search Box category search (cafe, library) → Places details (hours) → 3 open at pickup time.
import { Hono } from 'hono';
import type { Env, Vars } from '../lib/env';
import { rentalById, userById, listingById } from '../lib/db';
import { geocodePlace } from '../lib/geo';
import { walkingMatrix, categoryNear, placeDetails } from '../lib/mapbox';

export const meetup = new Hono<{ Bindings: Env; Variables: Vars }>();

type Spot = { name: string; address: string | null; lat: number; lng: number; mapbox_id: string | null; walk_owner_min: number | null; walk_renter_min: number | null; open: boolean | null };

meetup.get('/api/meetup', async (c) => {
  if (c.env.MEETUP_SPOTS !== 'true') return c.json({ error: 'meetup spots are off (MEETUP_SPOTS flag)' }, 404);
  const u = c.get('user');
  const r = await rentalById(c.env.DB, c.req.query('rental') || '');
  if (!u || !r || (r.owner_id !== u.id && r.renter_id !== u.id)) return c.json({ error: 'not found' }, 404);
  const [owner, renter] = await Promise.all([userById(c.env.DB, r.owner_id), userById(c.env.DB, r.renter_id)]);
  const fallback = { spots: [] as Spot[], fallback: `Meet at ${owner?.cross_streets || "the owner's address"}`, reason: '' };
  if (!owner?.lat || !owner.lng) return c.json({ ...fallback, reason: 'owner has no location' });
  if (!renter?.lat || !renter.lng) return c.json({ ...fallback, reason: 'renter has no location' });
  const at = c.req.query('at') ? new Date(c.req.query('at')!) : new Date(); // pickup time (ISO); default now
  try {
    const r2 = await suggestSpots(c.env, { lat: owner.lat, lng: owner.lng }, { lat: renter.lat, lng: renter.lng }, at);
    return c.json({ spots: r2.spots, midpoint: r2.midpoint, fallback: r2.spots.length ? null : fallback.fallback, reason: r2.reason || '' });
  } catch (e: any) {
    console.warn('meetup failed', e);
    return c.json({ ...fallback, reason: 'error: ' + (e?.message || e) });
  }
});


export async function suggestSpots(env: Env, owner: { lat: number; lng: number }, renter: { lat: number; lng: number }, at: Date): Promise<{ spots: Spot[]; midpoint: [number, number]; reason?: string }> {
  const c = { env } as any; void c;
    // 1) walking-time midpoint: sample points along the straight line, pick the one with the most even walking times
    const samples: [number, number][] = [];
    for (let k = 1; k <= 7; k++) { const t = k / 8; samples.push([owner.lng + (renter.lng - owner.lng) * t, owner.lat + (renter.lat - owner.lat) * t]); }
    const coords: [number, number][] = [[owner.lng, owner.lat], [renter.lng, renter.lat], ...samples];
    const m = await walkingMatrix(env, coords);
    let mid: [number, number] = samples[3];
    if (m) {
      let best = Infinity;
      samples.forEach((s, i) => { const a = m[0][i + 2], b = m[1][i + 2]; if (a != null && b != null && Math.abs(a - b) < best) { best = Math.abs(a - b); mid = s; } });
    }
    // 2) candidates: cafes + libraries near the midpoint
    const [cafes, libs] = await Promise.all([categoryNear(env, 'cafe', mid[0], mid[1], 6), categoryNear(env, 'library', mid[0], mid[1], 3)]);
    const cands = [...cafes, ...libs].filter(x => x.lat != null).slice(0, 8);
    if (!cands.length) return { spots: [], midpoint: mid, reason: 'no places near midpoint' };
    // 3) walking minutes from each party + opening hours (Places details is preview → per-candidate try/catch)
    const m2 = await walkingMatrix(env, [[owner.lng, owner.lat], [renter.lng, renter.lat], ...cands.map(x => [x.lng, x.lat] as [number, number])]);
    const spots: Spot[] = [];
    for (let i = 0; i < cands.length; i++) {
      const x = cands[i];
      let open: boolean | null = null;
      try { const d = x.mapbox_id ? await placeDetails(env, x.mapbox_id) : null; open = d ? isOpenAt(d, at) : null; } catch { open = null; }
      spots.push({ name: x.name, address: x.address || null, lat: x.lat, lng: x.lng, mapbox_id: x.mapbox_id || null,
        walk_owner_min: m2?.[0]?.[i + 2] != null ? Math.round(m2[0][i + 2] / 60) : null, walk_renter_min: m2?.[1]?.[i + 2] != null ? Math.round(m2[1][i + 2] / 60) : null, open });
    }
    const ranked = spots.filter(s => s.open !== false).sort((a, b) => ((a.walk_owner_min || 0) + (a.walk_renter_min || 0)) - ((b.walk_owner_min || 0) + (b.walk_renter_min || 0))).slice(0, 3);
    return { spots: ranked, midpoint: mid };
}

// Item-page preview: "where are you coming from?" → geocode → spots between there and the owner. No rental needed.
meetup.get('/api/meetup/preview', async (c) => {
  if (c.env.MEETUP_SPOTS !== 'true') return c.json({ spots: [] });
  const it = await listingById(c.env.DB, c.req.query('listing') || '');
  const from = (c.req.query('from') || '').trim().slice(0, 80);
  if (!it || from.length < 3) return c.json({ spots: [] });
  const owner = await userById(c.env.DB, it.owner_id);
  const base = owner?.lat != null && owner.lng != null ? { lat: owner.lat, lng: owner.lng } : it.lat != null && it.lng != null ? { lat: it.lat, lng: it.lng } : null;
  if (!base) return c.json({ spots: [], reason: 'owner has no location' });
  const g = await geocodePlace(c.env, from);
  if (!g) return c.json({ spots: [], reason: 'could not place that' });
  try { const r = await suggestSpots(c.env, base, { lat: g.lat, lng: g.lng }, new Date()); return c.json({ spots: r.spots.slice(0, 1), from: g.full_address || from, reason: r.reason || '' }); }
  catch (e: any) { return c.json({ spots: [], reason: 'error: ' + (e?.message || e) }); }
});

// Interpret Mapbox Places "visit" attributes (opening hours). Shapes vary by provider; be lenient and return null when unsure.
function isOpenAt(props: any, at: Date): boolean | null {
  const oh = props?.metadata?.open_hours || props?.open_hours || props?.metadata?.openHours;
  if (!oh) return null;
  const periods: any[] = oh.periods || [];
  if (!periods.length) return null;
  const day = at.getUTCDay(), hm = at.getUTCHours() * 100 + at.getUTCMinutes();
  for (const p of periods) {
    const o = p.open || {}, cl = p.close || {};
    const od = Number(o.day), cd = Number(cl.day ?? o.day), ot = parseInt(String(o.time || '0000'), 10), ct = parseInt(String(cl.time || '2359'), 10);
    if (od === day && hm >= ot && (cd !== day || hm <= ct)) return true;
  }
  return false;
}
