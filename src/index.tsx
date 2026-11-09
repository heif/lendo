import { iconsDone, makeWantedIcon } from './lib/wanted-icons';
import { backfillAvatars } from './lib/avatar';
import { fixDemoLand } from './lib/demo-land';
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
import { expireHolds } from './lib/rentals';
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
    try { const a = await backfillAvatars(env, 3); if (a) console.log(`avatars backfilled ${a}`); } catch (e) { console.warn('avatar backfill', e); }
    try { const f = await fixDemoLand(env, 150); if (f.checked) console.log(`demo land: checked ${f.checked}, moved ${f.moved}`); } catch (e) { console.warn('demo land', e); }
    // backfill custom icons for the wanted catalog, a few per tick (Flux + cutout each)
    try {
      const done = await iconsDone(env);
      for (const w of WANTED_ALL.filter(w => !done.has(w.key)).slice(0, 5)) {
        try { await makeWantedIcon(env, w.key); }
        catch (e: any) { await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('wanted_icons_err', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(`${w.key}: ${e?.message || e}`.slice(0, 500)).run(); }
      }
    } catch (e: any) { await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('wanted_icons_err', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(`outer: ${e?.message || e}`.slice(0, 500)).run().catch(() => {}); }
  },
};
