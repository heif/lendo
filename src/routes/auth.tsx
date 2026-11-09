import { Hono } from 'hono';
import type { Env, Vars } from '../lib/env';
import { Layout } from '../pages/layout';
import { startLogin, finishLogin, logout } from '../lib/auth';
import { normPhone, prettyPhone } from '../lib/util';

export const auth = new Hono<{ Bindings: Env; Variables: Vars }>();

const safeNext = (n: string | undefined) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');

auth.get('/login', (c) => {
  const u = c.get('user');
  const next = safeNext(c.req.query('next'));
  if (u) return c.redirect(next);
  return c.html(
    <Layout title="Log in" user={null}>
      <form method="post" action="/login" style="padding:20px 16px">
        <h2 style="margin:0 0 10px;font-size:24px;font-weight:900;letter-spacing:-.02em">Your phone number</h2>
        <input type="hidden" name="next" value={next} />
        <label class="field"><span>Phone</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(646) 555-0199" required autofocus /></label>
        <button class="btn pri full" type="submit">Text me a code</button>
        <p class="hint" style="margin-top:14px">We'll text you. Reply STOP anytime.</p>
      </form>
    </Layout>
  );
});

auth.post('/login', async (c) => {
  const f = await c.req.parseBody();
  const phone = normPhone(String(f.phone || ''));
  const next = safeNext(String(f.next || '/'));
  if (!phone) return c.html(<Layout title="Log in" user={null} flashErr="That doesn't look like a phone number."><div style="padding:16px"><a class="btn" href={'/login?next=' + encodeURIComponent(next)}>Try again</a></div></Layout>, 400);
  const r = await startLogin(c.env, phone);
  if (!r.ok) return c.html(<Layout title="Log in" user={null} flashErr={'Could not send the text. ' + (r.error || '')}><div style="padding:16px"><a class="btn" href="/login">Try again</a></div></Layout>, 502);
  return c.html(
    <Layout title="Enter code" user={null} back="/login">
      <form method="post" action="/login/verify" style="padding:20px 16px">
        <h2 style="margin:0 0 6px;font-size:24px;font-weight:900;letter-spacing:-.02em">Check your texts</h2>
        <p class="hint" style="margin:0 0 10px">Sent to {prettyPhone(phone)}.{r.devCode ? <b> DEV MODE — code is {r.devCode}</b> : null}</p>
        <input type="hidden" name="phone" value={phone} /><input type="hidden" name="next" value={next} />
        <label class="field"><span>6-digit code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength={6} required autofocus style="letter-spacing:.3em;font-size:22px!important;height:56px" /></label>
        <button class="btn pri full" type="submit">Continue</button>
      </form>
    </Layout>
  );
});

auth.post('/login/verify', async (c) => {
  const f = await c.req.parseBody();
  const phone = normPhone(String(f.phone || ''));
  const next = safeNext(String(f.next || '/'));
  if (!phone) return c.redirect('/login');
  const u = await finishLogin(c, phone, String(f.code || ''));
  if (!u) return c.html(<Layout title="Enter code" user={null} flashErr="Wrong or expired code."><div style="padding:16px"><a class="btn" href={'/login?next=' + encodeURIComponent(next)}>Send a new code</a></div></Layout>, 400);
  if (!u.name) return c.redirect('/welcome?next=' + encodeURIComponent(next));
  return c.redirect(next);
});

auth.get('/welcome', async (c) => {
  const u = c.get('user');
  if (!u) return c.redirect('/login');
  const next = safeNext(c.req.query('next'));
  return c.html(
    <Layout title="Welcome" user={u} back={null}>
      <form method="post" action="/welcome" style="padding:20px 16px">
        <div class="flash" style="margin:0 0 14px">📱 Save <b>{c.env.LENDO_NUMBER}</b> as "Lendo" · reply <b>OK</b> to the text.</div>
        <h2 style="margin:0 0 6px;font-size:24px;font-weight:900;letter-spacing:-.02em">What should neighbors call you?</h2>
        <input type="hidden" name="next" value={next} />
        <label class="field"><span>First name + last initial</span><input name="name" placeholder="Fiona S." required maxlength={40} autofocus /></label>
        <label class="field"><span>Neighborhood (optional)</span><input name="hood" placeholder="Chelsea" maxlength={60} /></label>
        <button class="btn pri full" type="submit">Done</button>
      </form>
    </Layout>
  );
});

auth.post('/welcome', async (c) => {
  const u = c.get('user');
  if (!u) return c.redirect('/login');
  const f = await c.req.parseBody();
  await c.env.DB.prepare('UPDATE users SET name = ?, hood = COALESCE(NULLIF(?, \'\'), hood) WHERE id = ?')
    .bind(String(f.name || '').trim().slice(0, 40) || 'Neighbor', String(f.hood || '').trim().slice(0, 60), u.id).run();
  return c.redirect(safeNext(String(f.next || '/')));
});

auth.get('/logout', async (c) => { await logout(c); return c.redirect('/'); });
