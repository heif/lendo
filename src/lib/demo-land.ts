import type { Env } from './env';
import { landAt } from './mapbox';
// Demo listings were scattered randomly; nudge any that landed on parks/water toward the nearest street-side spot.
// Processes `n` listings per call starting at settings.demo_land_cursor; returns how many it moved.
export async function fixDemoLand(env: Env, n = 120): Promise<{ checked: number; moved: number; done: boolean }> {
  const cur = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'demo_land_cursor'`).first<{ value: string }>();
  const offset = cur ? parseInt(cur.value, 10) || 0 : 0;
  const rows = (await env.DB.prepare(`SELECT id, lat, lng FROM listings WHERE demo = 1 AND status = 'live' ORDER BY id LIMIT ? OFFSET ?`).bind(n, offset).all<{ id: string; lat: number; lng: number }>()).results;
  let moved = 0;
  for (const r of rows) {
    let lat = r.lat, lng = r.lng, ok = false;
    for (let t = 0; t < 6; t++) {
      const land = await landAt(env, lng, lat);
      if (!land) { ok = true; break; }
      if (!land.park && !land.water) { ok = true; break; }
      const ang = (t * 2.4 + r.id.length) % 6.283, d = 0.0012 * (1 + t * 0.6);
      lat = r.lat + Math.sin(ang) * d; lng = r.lng + Math.cos(ang) * d * 1.3;
    }
    if (ok && (lat !== r.lat || lng !== r.lng)) { await env.DB.prepare('UPDATE listings SET lat = ?, lng = ? WHERE id = ?').bind(lat, lng, r.id).run(); moved++; }
    else if (!ok) { await env.DB.prepare(`UPDATE listings SET status = 'paused' WHERE id = ?`).bind(r.id).run(); moved++; }
  }
  await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('demo_land_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(String(offset + rows.length)).run();
  return { checked: rows.length, moved, done: rows.length < n };
}
