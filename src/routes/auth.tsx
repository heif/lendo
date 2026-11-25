import { twilioSmsOn } from '../lib/twiliosms';
import { raw } from 'hono/html';
import { Hono } from 'hono';
import { setUserWhere } from '../lib/where';
import { logEvent, logErr } from '../lib/log';
import { PhotoField, saveUserPhoto } from '../lib/userphoto';
import type { Env, Vars } from '../lib/env';
import { Layout } from '../pages/layout';
import { startLogin, finishLogin, logout, smsFallback, useLoginLink } from '../lib/auth';
import { normPhone, prettyPhone, now } from '../lib/util';
import { ensureUser } from '../lib/db';
import { validEmail } from '../lib/email';
import { sendRaw, smsHref } from '../lib/blooio';
import { setCookie, getCookie } from 'hono/cookie';

export const auth = new Hono<{ Bindings: Env; Variables: Vars }>();

const num10 = (env: Env) => (env.LENDO_NUMBER || '').replace(/\D/g, '').slice(-10);
const safeNext = (n: string | undefined) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');

auth.get('/login', (c) => {
  const u = c.get('user');
  const next = safeNext(c.req.query('next'));
  if (u) return c.redirect(next);
  return c.html(
    <Layout title="Log in" user={null}>
      {/* text-first: the person texts Lendo, so Lendo is never an unknown sender; Lendo texts back a login link. The code form stays right below */}
      {num10(c.env) ? <div style="padding:22px 16px 0">
        <h2 style="margin:0 0 10px;font-size:24px;font-weight:900;letter-spacing:-.02em">Join or log in</h2>
        <a class="btn pri full sms-only" href={smsHref(c.env, 'OK')} style="display:grid;place-items:center;text-decoration:none">💬 Text OK to Lendo</a>
        <p class="hint sms-only" style="margin:10px 0 0">Opens Messages · send it · tap the link Lendo texts back</p>
        <p class="hint" style="margin:8px 0 0;font-size:12px">By continuing you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a></p>
        <div class="pc-only" style="text-align:center"><span id="lgQr" data-sms={`SMSTO:+1${num10(c.env)}:OK`} aria-label="Scan to text Lendo" style="display:inline-block;background:#fff;border:2.5px solid var(--ink);border-radius:14px;padding:8px;line-height:0"></span>
          <p class="hint" style="margin:10px 0 0">Scan with your phone’s camera, or text <b>OK</b> to {prettyPhone('+1' + num10(c.env))} · tap the link Lendo texts back</p></div>
        <script src="/qrgen.js"></script>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var q=document.getElementById('lgQr');if(!q||!window.qrcode||!matchMedia('(pointer:fine)').matches)return;var qr=qrcode(0,'M');qr.addData(q.dataset.sms);qr.make();var m=qr.getModuleCount(),s=5,pad=2,c=document.createElement('canvas');c.width=c.height=(m+pad*2)*s;var g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.fillStyle='#1E3A2B';for(var r=0;r<m;r++)for(var k=0;k<m;k++)if(qr.isDark(r,k))g.fillRect((k+pad)*s,(r+pad)*s,s,s);q.appendChild(c)})()` }} />
        <button type="button" class="lg-alt" onclick="var f=document.getElementById('lgCode');f.hidden=false;this.hidden=true;f.querySelector('input[name=phone]').focus()">Another way</button>
      </div> : null}
      {/* text-first: the code form opens from "Another way" (open by default with ?code=1, and whenever there is no Lendo number) */}
      <form method="post" action="/login" id="lgCode" hidden={!!num10(c.env) && c.req.query('code') !== '1'} style="padding:12px 16px 20px">
        <h2 style="margin:0 0 10px;font-size:20px;font-weight:900;letter-spacing:-.02em">Your phone number</h2>
        <input type="hidden" name="next" value={next} />
        <label class="field"><span>Phone</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(646) 555-0199" required /></label>
        {/* rental texts are optional (Twilio 10DLC): unchecked by default; the login code is a one-time text the person asks for */}
        <label class="smsopt"><input type="checkbox" name="sms_ok" value="1" /><span><b>Text me rental updates (optional)</b><small>Requests, YES/NO, pickup and return · msg frequency varies · msg &amp; data rates may apply · reply STOP to opt out, HELP for help</small></span></label>
        <button class="btn full" type="submit">Text me a code</button>
        <p class="hint" style="margin-top:14px;line-height:1.45">Lendo texts your one-time login code. Without rental texts, updates come by email and on lendo.co · numbers never shared or sold · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
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
        <input type="hidden" name="phone" value={phone} /><input type="hidden" name="next" value={next} />{f.sms_ok ? <input type="hidden" name="sms_ok" value="1" /> : null}
        <input class="otp" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength={6} required autofocus aria-label="6-digit code" placeholder="······" />
        <button class="btn pri full" type="submit">Continue</button>
      </form>
      <form method="post" action="/login" style="padding:0 16px 10px"><input type="hidden" name="phone" value={phone} /><input type="hidden" name="next" value={next} />{f.sms_ok ? <input type="hidden" name="sms_ok" value="1" /> : null}<button class="btn full" type="submit">Text me a new code</button></form>
      {smsFallback(c.env) && f.via !== 'sms' ? <form method="post" action="/login" style="padding:0 16px"><input type="hidden" name="phone" value={phone} /><input type="hidden" name="next" value={next} />{f.sms_ok ? <input type="hidden" name="sms_ok" value="1" /> : null}<input type="hidden" name="via" value="sms" /><button class="btn full" type="submit">No text after a minute? Send it by SMS</button></form> : null}
    </Layout>
  );
});

auth.post('/login/verify', async (c) => {
  const f = await c.req.parseBody();
  const phone = normPhone(String(f.phone || ''));
  const next = safeNext(String(f.next || '/'));
  if (!phone) return c.redirect('/login');
  const u = await finishLogin(c, phone, String(f.code || ''));
  if (u) try {
    /* record the rental-text choice: checked → on (logged as consent); unchecked → off only for a brand-new account (older accounts keep what they had) */
    if (f.sms_ok) { if (u.sms_ok !== 1) { await c.env.DB.prepare('UPDATE users SET sms_ok = 1 WHERE id = ?').bind(u.id).run(); await logEvent(c.env.DB, 'sms.optin', { user: u.id, data: { via: 'login checkbox', ip: c.req.header('cf-connecting-ip') || null, ua: (c.req.header('user-agent') || '').slice(0, 160) } }); } }
    else if (u.sms_ok == null && now() - (u.created_at || 0) < 15 * 60e3) { await c.env.DB.prepare('UPDATE users SET sms_ok = 0 WHERE id = ?').bind(u.id).run(); await logEvent(c.env.DB, 'sms.optin_skipped', { user: u.id, data: { via: 'login checkbox' } }); }
  } catch (e) { await logErr(c.env.DB, 'sms_ok save', e); } /* column arrives with the next cron self-migrate; never block login */
  if (!u) return c.html(
    <Layout title="Enter code" user={null} back="/login" flashErr="That code didn't match — check the latest text and try again">
      <form method="post" action="/login/verify" style="padding:20px 16px">
        <input type="hidden" name="phone" value={phone} /><input type="hidden" name="next" value={next} />{f.sms_ok ? <input type="hidden" name="sms_ok" value="1" /> : null}
        <input class="otp" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength={6} required autofocus aria-label="6-digit code" placeholder="······" />
        <button class="btn pri full" type="submit">Continue</button>
      </form>
      <form method="post" action="/login" style="padding:0 16px"><input type="hidden" name="phone" value={phone} /><input type="hidden" name="next" value={next} />{f.sms_ok ? <input type="hidden" name="sms_ok" value="1" /> : null}<button class="btn full" type="submit">Text me a new code</button></form>
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
      <form class="qs" data-mode="steps" method="post" action="/welcome" enctype="multipart/form-data" style="padding:20px 16px">
        <input type="hidden" name="next" value={next} />
        <div class="q"><h2 class="qh">What’s your name?</h2>
          <label class="field"><span>First and last</span><input name="name" placeholder="Fiona Smith" required maxlength={40} autocomplete="name" value={u.name || ''} /></label>
          <p class="hint" style="margin:-6px 0 12px">Others see first name and last initial, like “Fiona S.”</p></div>
        <div class="q" hidden><h2 class="qh">Your email</h2>
          <label class="field"><span>Email</span><input name="email" type="email" inputmode="email" autocomplete="email" placeholder="you@email.com" required maxlength={120} value={u.email || ''} /></label>
          <p class="hint" style="margin:-6px 0 12px">Only for receipts and anything a text misses</p></div>
        <div class="q" data-skip="1" hidden><h2 class="qh">Add a photo</h2>
          <PhotoField name={null} label="People say yes more often to a face" /></div>
        <div class="q" data-skip="1" hidden><h2 class="qh">Where’s home?</h2>
          <label class="field"><span>Cross streets or ZIP</span><input name="home" placeholder="W 22nd & 9th Ave" maxlength={120} autocomplete="off" value={u.cross_streets || ''} /></label>
          <p class="hint" style="margin:-6px 0 12px">Shows what’s near you, and puts your things on the map near home · only the area shows</p></div>
        <div class="qnav"><button class="btn pri full qnext" type="button">Next</button><button type="button" class="lg-alt qskip" hidden>Skip</button></div>
        <script src="/steps.js"></script>
      </form>
    </Layout>
  );
});

auth.post('/welcome', async (c) => {
  const u = c.get('user');
  if (!u) return c.redirect('/login');
  const f = await c.req.parseBody();
  await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(String(f.name || '').trim().slice(0, 40) || 'Neighbor', u.id).run();
  { const home = String(f.home || '').trim(); if (home && home !== (u.cross_streets || '')) await setUserWhere(c.env, u, home, u.id).catch(() => null); } /* home = where their things are kept; sets the map spot + neighborhood */
  { const em = String(f.email || '').trim().toLowerCase(); if (validEmail(em)) await c.env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(em, u.id).run().catch(() => 0); }
  if (f.photo) await saveUserPhoto(c.env, u.id, f.photo).catch(() => null);
  await logEvent(c.env.DB, 'profile.setup', { user: u.id, data: { name: String(f.name || '').trim().slice(0, 40), home: String(f.home || '').trim().slice(0, 60), photo: !!f.photo } });
  const nx = safeNext(String(f.next || '/'));
  return c.redirect(u.replied ? nx : '/texts-on?next=' + encodeURIComponent(nx));
});

/* JSON login for the one-question-at-a-time list flow (phone → code → name → hood, after the item questions) */
auth.post('/api/auth/start', async (c) => {
  const j = await c.req.json().catch(() => ({} as any));
  const phone = normPhone(String(j.phone || ''));
  if (!phone) return c.json({ ok: false, error: "That doesn't look like a phone number" }, 400);
  const r = await startLogin(c.env, phone, j.via === 'sms' ? 'sms' : 'auto');
  if (!r.ok) return c.json({ ok: false, error: 'Could not send the text · ' + (r.error || 'try again') }, 502);
  return c.json({ ok: true, phone, pretty: prettyPhone(phone), dev: r.devCode || null, note: r.note || null, sms: smsFallback(c.env) });
});
auth.post('/api/auth/verify', async (c) => {
  const j = await c.req.json().catch(() => ({} as any));
  const phone = normPhone(String(j.phone || ''));
  if (!phone) return c.json({ ok: false }, 400);
  const u = await finishLogin(c, phone, String(j.code || ''));
  if (!u) return c.json({ ok: false, error: "That code didn't match · check the latest text" }, 400);
  return c.json({ ok: true, user: { name: u.name || '', hood: u.hood || '', replied: !!u.replied } });
});
auth.post('/api/auth/me', async (c) => {
  const u = c.get('user'); if (!u) return c.json({ ok: false }, 401);
  const j = await c.req.json().catch(() => ({} as any));
  const name = String(j.name ?? '').trim().slice(0, 40), hood = String(j.hood ?? '').trim().slice(0, 60);
  { const em = String(j.email ?? '').trim().toLowerCase(); if (em) { if (!validEmail(em)) return c.json({ ok: false, error: 'That email doesn’t look right' }, 400); await c.env.DB.prepare('UPDATE users SET email = ? WHERE id = ?').bind(em, u.id).run().catch(() => 0); } }
  await c.env.DB.prepare('UPDATE users SET name = COALESCE(NULLIF(?, \'\'), name), hood = COALESCE(NULLIF(?, \'\'), hood) WHERE id = ?').bind(name, hood, u.id).run();
  await logEvent(c.env.DB, 'profile.setup', { user: u.id, data: { name, hood, via: 'list' } });
  return c.json({ ok: true });
});

/* signup step: send one real text to Lendo (sms: link with OK typed) + save the contact. Makes iPhone trust the number,
   unlocks links in Lendo texts, and starts Blooio's reply count fresh. Page waits for the OK and moves on by itself */
auth.get('/texts-on', async (c) => {
  const u = c.get('user');
  if (!u) return c.redirect('/login');
  const next = safeNext(c.req.query('next'));
  if (/Android/i.test(c.req.header('user-agent') || '') && !twilioSmsOn(c.env)) return c.redirect(next); /* Android texts don't reach Lendo's number: skip the Text-OK step */
  return c.html(
    <Layout title="Turn on texts" user={u} back={null}>
      <div style="padding:36px 18px 30px;text-align:center">
        <div style="font-size:56px;line-height:1">💬</div>
        <h2 style="margin:10px 0 6px;font-size:26px;font-weight:900;letter-spacing:-.02em">Turn on Lendo texts</h2>
        <p class="hint" style="font-size:15px;margin:0 0 22px">Requests, payments and pickups come by text. Send one OK so your phone trusts Lendo</p>
        <a class="btn pri full" href={smsHref(c.env, 'OK')} style="display:grid;place-items:center;text-decoration:none">Text OK to Lendo</a>
        <a class="btn full" href="/lendo.vcf" style="display:grid;place-items:center;text-decoration:none;margin-top:10px">📇 Save Lendo contact</a>
        <div class="card" style="margin-top:20px;text-align:left;font-size:14px" id="tst">✓ Code sent<br /><span id="tok">⏳ Waiting for your OK…</span></div>
        <a href={next} class="hint" style="display:block;margin-top:16px">Skip for now</a>
      </div>
      {raw(`<script>(function(){var t0=${Date.now()},n=0;function chk(){fetch('/api/texts-on?since='+t0).then(function(r){return r.json()}).then(function(j){if(j.ok){document.getElementById('tok').textContent='✓ Got your OK — texts are on';setTimeout(function(){location.href=${JSON.stringify(next)}},900)}else if(++n<120)setTimeout(chk,3000)}).catch(function(){if(++n<120)setTimeout(chk,3000)})}chk()})()</script>`)}
    </Layout>
  );
});
auth.get('/api/texts-on', async (c) => {
  const u = c.get('user'); if (!u) return c.json({ ok: false });
  const since = Number(c.req.query('since')) || 0;
  const r = await c.env.DB.prepare(`SELECT 1 FROM inbound_texts WHERE user_id = ? AND via = 'text' AND created_at > ? LIMIT 1`).bind(u.id, since - 60000).first().catch(() => null);
  return c.json({ ok: !!r });
});

// $5-off promo bar (prototype): phone → opt-in → credit saved to that number + a text. Idempotent per phone.
auth.post('/promo', async (c) => {
  const f = await c.req.parseBody();
  const phone = normPhone(String(f.phone || ''));
  if (!phone) return c.json({ ok: false, error: 'bad phone' }, 400);
  const user = await ensureUser(c.env.DB, phone);
  const fresh = !user.promo_claimed_at;
  if (fresh) await logEvent(c.env.DB, 'ab.gift5', { user: user.id, data: { ev: 'claim', var: f.var === 'a' ? 'a' : 'b', via: 'phone' } });
  if (fresh) await c.env.DB.prepare('UPDATE users SET promo_cents = 500, promo_claimed_at = ? WHERE id = ?').bind(Date.now(), user.id).run();
  c.executionCtx.waitUntil(sendRaw(c.env, phone, fresh
    ? `$5 off your first rental is saved to this number. Save contact + reply OK so rental texts reach you ${c.env.APP_URL}/lendo.vcf`
    : `$5 off is already saved to this number ${c.env.APP_URL}`).then(() => {}));
  setCookie(c, 'lendo_p', '1', { path: '/', sameSite: 'Lax', secure: c.env.APP_URL.startsWith('https'), maxAge: 365 * 86400 });
  return c.json({ ok: true, fresh });
});

// texted one-time login link (gift card / Text Lendo replies)
auth.get('/in/:t', async (c) => {
  const u = await useLoginLink(c, c.req.param('t'));
  if (!u) return c.redirect('/login');
  const nx = safeNext((u as any)._next) === '/' ? '/?hi=1' : safeNext((u as any)._next);
  /* people who joined by texting in never saw the welcome questions (name, email): ask now, then carry on */
  return c.redirect(!u.name || !u.email ? '/welcome?next=' + encodeURIComponent(nx) : nx);
});

// tap → iPhone/Android "Create contact" sheet for the Lendo number
auth.get('/lendo.vcf', (c) => {
  const n = (c.env.LENDO_NUMBER || '').replace(/[^\d+]/g, '');
  const card = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Lendo', 'N:;Lendo;;;', 'ORG:Lendo', `TEL;TYPE=CELL:${n}`, `URL:${c.env.APP_URL}`, 'END:VCARD'].join('\r\n');
  return c.body(card + '\r\n', 200, { 'content-type': 'text/vcard; charset=utf-8', 'content-disposition': 'inline; filename="Lendo.vcf"' });
});

auth.get('/logout', async (c) => { await logout(c); setCookie(c, 'lendo_p', '', { path: '/', maxAge: 0 }); /* logged out = see the $5-off offer again (server keeps it once per phone) */ return c.redirect('/'); });
