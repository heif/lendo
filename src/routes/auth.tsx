import { Hono } from 'hono';
import { logEvent } from '../lib/log';
import { PhotoField, saveUserPhoto } from '../lib/userphoto';
import type { Env, Vars } from '../lib/env';
import { Layout } from '../pages/layout';
import { startLogin, finishLogin, logout, smsFallback } from '../lib/auth';
import { normPhone, prettyPhone } from '../lib/util';
import { ensureUser } from '../lib/db';
import { sendRaw } from '../lib/blooio';
import { setCookie, getCookie } from 'hono/cookie';

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
  const r = await startLogin(c.env, phone, f.via === 'sms' ? 'sms' : 'auto');
  if (!r.ok) return c.html(<Layout title="Log in" user={null} flashErr={'Could not send the text. ' + (r.error || '')}><div style="padding:16px"><a class="btn" href="/login">Try again</a></div></Layout>, 502);
  return c.html(
    <Layout title="Enter code" user={null} back="/login">
      <form method="post" action="/login/verify" style="padding:20px 16px">
        <h2 style="margin:0 0 6px;font-size:24px;font-weight:900;letter-spacing:-.02em">Check your texts</h2>
        <p class="hint" style="margin:0 0 10px">Sent to {prettyPhone(phone)}{r.devCode ? <b> DEV MODE — code is {r.devCode}</b> : null}</p>
        {r.note ? <p class="hint" style="margin:-4px 0 10px;color:#B33A00">{r.note}</p> : null}
        <input type="hidden" name="phone" value={phone} /><input type="hidden" name="next" value={next} />
        <label class="field"><span>6-digit code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength={6} required autofocus style="letter-spacing:.3em;font-size:22px!important;height:56px" /></label>
        <button class="btn pri full" type="submit">Continue</button>
      </form>
      <form method="post" action="/login" style="padding:0 16px 10px"><input type="hidden" name="phone" value={phone} /><input type="hidden" name="next" value={next} /><button class="btn full" type="submit">Text me a new code</button></form>
      {smsFallback(c.env) && f.via !== 'sms' ? <form method="post" action="/login" style="padding:0 16px"><input type="hidden" name="phone" value={phone} /><input type="hidden" name="next" value={next} /><input type="hidden" name="via" value="sms" /><button class="btn full" type="submit">No text after a minute? Send it by SMS</button></form> : null}
    </Layout>
  );
});

auth.post('/login/verify', async (c) => {
  const f = await c.req.parseBody();
  const phone = normPhone(String(f.phone || ''));
  const next = safeNext(String(f.next || '/'));
  if (!phone) return c.redirect('/login');
  const u = await finishLogin(c, phone, String(f.code || ''));
  if (!u) return c.html(
    <Layout title="Enter code" user={null} back="/login" flashErr="That code didn't match — check the latest text and try again">
      <form method="post" action="/login/verify" style="padding:20px 16px">
        <input type="hidden" name="phone" value={phone} /><input type="hidden" name="next" value={next} />
        <label class="field"><span>6-digit code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength={6} required autofocus style="letter-spacing:.3em;font-size:22px!important;height:56px" /></label>
        <button class="btn pri full" type="submit">Continue</button>
      </form>
      <form method="post" action="/login" style="padding:0 16px"><input type="hidden" name="phone" value={phone} /><input type="hidden" name="next" value={next} /><button class="btn full" type="submit">Text me a new code</button></form>
    </Layout>, 400);
  if (!u.name) return c.redirect('/welcome?next=' + encodeURIComponent(next));
  return c.redirect(next);
});

auth.get('/welcome', async (c) => {
  const u = c.get('user');
  if (!u) return c.redirect('/login');
  const next = safeNext(c.req.query('next'));
  return c.html(
    <Layout title="Welcome" user={u} back={null}>
      <form method="post" action="/welcome" enctype="multipart/form-data" style="padding:20px 16px">
        <div class="flash" style="margin:0 0 14px;display:flex;align-items:center;gap:10px"><span style="flex:1">📱 Reply <b>OK</b> to the text so rental texts reach you</span><a class="btn sm" href="/lendo.vcf" style="width:auto;white-space:nowrap">Save contact</a></div>
        <h2 style="margin:0 0 6px;font-size:24px;font-weight:900;letter-spacing:-.02em">What should neighbors call you?</h2>
        <input type="hidden" name="next" value={next} />
        <label class="field"><span>Your name</span><input name="name" placeholder="Fiona Smith" required maxlength={40} autofocus /></label>
        <PhotoField name={null} label="Your photo (optional)" />
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
  if (f.photo) await saveUserPhoto(c.env, u.id, f.photo).catch(() => null);
  await logEvent(c.env.DB, 'profile.setup', { user: u.id, data: { name: String(f.name || '').trim().slice(0, 40), hood: String(f.hood || '').trim().slice(0, 60), photo: !!f.photo } });
  return c.redirect(safeNext(String(f.next || '/')));
});

// $5-off promo bar (prototype): phone → opt-in → credit saved to that number + a text. Idempotent per phone.
auth.post('/promo', async (c) => {
  const f = await c.req.parseBody();
  const phone = normPhone(String(f.phone || ''));
  if (!phone) return c.json({ ok: false, error: 'bad phone' }, 400);
  const user = await ensureUser(c.env.DB, phone);
  const fresh = !user.promo_claimed_at;
  if (fresh) await c.env.DB.prepare('UPDATE users SET promo_cents = 500, promo_claimed_at = ? WHERE id = ?').bind(Date.now(), user.id).run();
  c.executionCtx.waitUntil(sendRaw(c.env, phone, fresh
    ? `$5 off your first rental is saved to this number. Save contact + reply OK so rental texts reach you ${c.env.APP_URL}/lendo.vcf`
    : `$5 off is already saved to this number ${c.env.APP_URL}`).then(() => {}));
  setCookie(c, 'lendo_p', '1', { path: '/', sameSite: 'Lax', secure: c.env.APP_URL.startsWith('https'), maxAge: 365 * 86400 });
  return c.json({ ok: true, fresh });
});

// tap → iPhone/Android "Create contact" sheet for the Lendo number
auth.get('/lendo.vcf', (c) => {
  const n = (c.env.LENDO_NUMBER || '').replace(/[^\d+]/g, '');
  const card = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Lendo', 'N:;Lendo;;;', 'ORG:Lendo', `TEL;TYPE=CELL:${n}`, `URL:${c.env.APP_URL}`, 'END:VCARD'].join('\r\n');
  return c.body(card + '\r\n', 200, { 'content-type': 'text/vcard; charset=utf-8', 'content-disposition': 'inline; filename="Lendo.vcf"' });
});

auth.get('/logout', async (c) => { await logout(c); return c.redirect('/'); });
