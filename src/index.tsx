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
import { expireHolds } from './lib/rentals';
import { Layout } from './pages/layout';

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.use('*', async (c, next) => {
  const host = new URL(c.req.url).host;
  const canon = new URL(c.env.APP_URL).host;
  if (host !== canon && (host === 'www.' + canon || host.endsWith('.workers.dev')) && !/^\/(webhooks|api|p|dev)\//.test(c.req.path)) {
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

app.notFound((c) => c.html(<Layout title="Not found" user={c.get('user') ?? null}><div style="padding:24px 16px"><b>Nothing here.</b> <a href="/">Back to the map</a>.</div></Layout>, 404));
app.onError((err, c) => { console.error(err); return c.html(<Layout title="Error" user={null}><div style="padding:24px 16px"><b>Something broke.</b> It's logged. <a href="/">Back to the map</a>.</div></Layout>, 500); });

export default {
  fetch: app.fetch,
  async scheduled(_ev: ScheduledEvent, env: Env) {
    const n = await expireHolds(env);
    if (n) console.log(`expired ${n} held requests`);
  },
};
