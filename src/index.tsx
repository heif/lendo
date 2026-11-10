import { iconsDone, makeWantedIcon, auditIcons } from './lib/wanted-icons';
import { morningBundle } from './lib/alerts';
import { backfillAvatars, auditAvatars } from './lib/avatar';
import { fixDemoLand } from './lib/demo-land';
import { hoodAt } from './lib/hoods';
import { WANTED_ALL } from './lib/places';
import { Hono } from 'hono';
import type { Env, Vars } from './lib/env';
import { loadUser } from './lib/auth';
import { auth } from './routes/auth';
import { browse } from './routes/browse';
import { listings } from './routes/listings';
import { rentals } from './routes/rentals';
import { webhooks } from './routes/webhooks';
import { api } from './routes/api';
import { meetup } from './routes/meetup';
import { admin } from './routes/admin';
import { expireHolds , chaseHolds } from './lib/rentals';
import { Layout } from './pages/layout';

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.use('*', async (c, next) => {
  const host = new URL(c.req.url).host;
  const canon = new URL(c.env.APP_URL).host;
  if (c.req.method === 'GET' && host !== canon && (host === 'www.' + canon || host.endsWith('.workers.dev')) && !/^\/(webhooks|api|p|dev)\//.test(c.req.path) && !c.req.header('x-lendo-preview')) { // header: headless checks from the build sandbox
    return c.redirect(c.env.APP_URL + c.req.path + (c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : ''), 301);
  }
  await next();
  c.header('x-frame-options', 'DENY');
  c.header('referrer-policy', 'strict-origin-when-cross-origin');
});
app.route('/', webhooks);   // raw-body routes first, no session needed
app.route('/', api);
app.use('*', loadUser);
app.route('/', auth);
app.route('/', browse);
app.route('/', listings);
app.route('/', rentals);
app.route('/', meetup);
app.route('/', admin);

app.notFound((c) => c.html(<Layout title="Not found" user={c.get('user') ?? null}><div style="padding:24px 16px"><b>Nothing here.</b> <a href="/">Back to the map</a>.</div></Layout>, 404));
app.onError((err, c) => { console.error(err); if (c.req.path.startsWith('/api/')) return c.json({ error: String(err?.message || err) }, 500); return c.html(<Layout title="Error" user={null}><div style="padding:24px 16px"><b>Something broke.</b> It's logged. <a href="/">Back to the map</a>.</div></Layout>, 500); });

export default {
  fetch: app.fetch,
  async scheduled(_ev: ScheduledEvent, env: Env) {
    const n = await expireHolds(env);
    if (n) console.log(`expired ${n} held requests`);
    try { const c = await chaseHolds(env); if (c) console.log(`chase: ${c} texts`); } catch (e) { console.warn('chase', e); }
    // backfill custom icons for the wanted catalog, a few per tick (Flux + cutout each)
    try {
      const done = await iconsDone(env);
      const br = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'wanted_bad'`).first<{ value: string }>(); const bad = new Set<string>(br ? JSON.parse(br.value) : []);
      const todo = WANTED_ALL.filter(w => !done.has(w.key) && !bad.has(w.key)).slice(0, 3);
      { const redo = await auditIcons(env, todo.length ? 2 : 6); if (redo.length) console.log('icon audit redo', redo); }
      for (const w of todo) {
        try { await makeWantedIcon(env, w.key); }
        catch (e: any) { await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('wanted_icons_err', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(`${w.key}: ${e?.message || e}`.slice(0, 500)).run(); }
      }
    } catch (e: any) { await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('wanted_icons_err', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(`outer: ${e?.message || e}`.slice(0, 500)).run().catch(() => {}); }
    // ~8am ET: morning bundle of held search alerts
    { const t = new Date(_ev.scheduledTime); if (t.getUTCHours() === 13 && t.getUTCMinutes() < 5) { try { const n = await morningBundle(env); if (n) console.log(`alert bundles ${n}`); } catch (e) { console.warn('bundle', e); } } }
    // heavier jobs every 15 min only (cron runs every 5)
    if (new Date(_ev.scheduledTime).getUTCMinutes() % 15 >= 5) return;
    try { const rows = (await env.DB.prepare(`SELECT id, lat, lng FROM listings WHERE hood_id IS NULL AND lat IS NOT NULL AND demo = 0 LIMIT 200`).all<{ id: string; lat: number; lng: number }>()).results; for (const l of rows) { const h = await hoodAt(env, l.lat, l.lng); if (h) await env.DB.prepare('UPDATE listings SET hood_id = ? WHERE id = ?').bind(h.id, l.id).run(); } } catch (e) { console.warn('hood backfill', e); }
    try { const b = await auditAvatars(env, 4); if (b) console.log(`avatar audit cleared ${b}`); } catch (e) { console.warn('avatar audit', e); }
    try { const a = await backfillAvatars(env, 3); if (a) console.log(`avatars backfilled ${a}`); } catch (e) { console.warn('avatar backfill', e); }
    try { const f = await fixDemoLand(env, 150); if (f.checked) console.log(`demo land: checked ${f.checked}, moved ${f.moved}`); } catch (e) { console.warn('demo land', e); }
  },
};
