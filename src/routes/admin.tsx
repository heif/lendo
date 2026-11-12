// Admin (allowlisted phones only): pricing rules + identification test.
import { Hono } from 'hono';
import { stripe } from '../lib/stripe';
import { twilioBasic } from '../lib/auth';
import type { Env, Vars } from '../lib/env';
import { WANTED_ALL } from '../lib/places';
import { iconsDone, makeWantedIcon } from '../lib/wanted-icons';
import { fixDemoLand } from '../lib/demo-land';
import { Layout } from '../pages/layout';
import { requireUser } from '../lib/auth';
import { identifyItem, loadPricing, suggestPrice, lastRaw, lastClaude } from '../lib/identify';
import { money } from '../lib/util';
import { listingById, userById } from '../lib/db';
import { matchListing } from '../lib/alerts';
import { textUser } from '../lib/blooio';

export const admin = new Hono<{ Bindings: Env; Variables: Vars }>();

const isAdmin = (env: Env, phone: string) => (env.ADMIN_PHONES || '').split(',').map(s => s.trim()).includes(phone);
admin.use('/admin/*', requireUser, async (c, next) => { if (!isAdmin(c.env, c.get('user')!.phone)) return c.notFound(); await next(); });
admin.use('/api/identify', requireUser);

// Identify a photo → label, description, category, suggested price. Used by the snap flow.
admin.post('/api/identify', async (c) => {
  const f = await c.req.parseBody();
  const p = f.photo;
  if (!(p instanceof File)) return c.json({ error: 'photo required' }, 400);
  const hint = String(f.hint || '').slice(0, 60) || null;
  const bytes = await p.arrayBuffer();
  // keep the snap so the review/done screens can show it cut out before the listing exists
  const tmp = `tmp/${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  c.executionCtx.waitUntil(c.env.PHOTOS.put(`${tmp}.jpg`, bytes, { httpMetadata: { contentType: p.type || 'image/jpeg' } }).then(() => {}));
  const lf = f.label; const label = lf instanceof File ? await lf.arrayBuffer() : null;
  const id = await identifyItem(c.env, bytes, hint, label);
  c.executionCtx.waitUntil(c.env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('last_identify', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify({ at: new Date().toISOString(), key: !!c.env.ANTHROPIC_API_KEY, name: id.name, brand: id.brand ?? null, via: id.brand !== undefined ? 'claude' : 'fallback', claude: lastClaude.slice(0, 500), raw: lastRaw.slice(0, 400) })).run());
  const { rules, settings } = await loadPricing(c.env);
  const pr = suggestPrice(rules, settings, id.category, id.retail_usd);
  return c.json({ ...id, cut: `/api/cuttmp/${tmp.slice(4)}`, price_cents: pr.day_cents, week_cents: pr.week_cents, basis: pr.basis, category_label: pr.rule.label, ...(c.req.query('raw') && c.get('user')!.admin ? { raw: lastRaw } : {}) });
});

admin.get('/admin', (c) => {
  const u = c.get('user')!;
  const links: [string, string][] = [['/admin/review', 'Photo check'], ['/admin/promo', '$10 promo'], ['/admin/pricing', 'Pricing'], ['/admin/wanted', 'Wanted items'], ['/admin/debug', 'Debug']];
  return c.html(<Layout title="Admin" user={u}><div style="padding:12px 16px 40px;display:grid;gap:8px">{links.map(([h, t]) => <a class="card" href={h} style="font-weight:800;text-decoration:none;color:var(--ink)">{t} →</a>)}</div></Layout>);
});
// what the background pieces last did (identify, inbound texts, icons) + a live Claude ping
admin.get('/admin/debug', async (c) => {
  const rows = (await c.env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('last_identify','last_inbound','last_inbound_err','wanted_icons_err','wanted_bad','login_fails')`).all<{ key: string; value: string }>()).results;
  let ping = 'no ANTHROPIC_API_KEY';
  if (c.env.ANTHROPIC_API_KEY) { try { const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': c.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 5, messages: [{ role: 'user', content: 'Say OK' }] }) }); ping = r.status + ' ' + (await r.text()).slice(0, 300); } catch (e: any) { ping = 'ERR ' + (e?.message || e); } }
  let twilio = 'not set';
  if (twilioBasic(c.env) && c.env.TWILIO_VERIFY_SID) { try { const r = await fetch(`https://verify.twilio.com/v2/Services/${c.env.TWILIO_VERIFY_SID.trim()}`, { headers: { authorization: twilioBasic(c.env)! } }); const j: any = await r.json().catch(() => ({})); twilio = r.status + ' ' + (j.friendly_name || j.message || ''); } catch (e: any) { twilio = 'ERR ' + (e?.message || e); } }
  const tables = (await c.env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all<{ name: string }>()).results.map(r => r.name);
  const mig = await c.env.DB.prepare(`SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1`).first<{ name: string }>().catch(() => null);
  return c.json({ twilio_ping: twilio, last_migration: mig?.name ?? null, has_alerts_tables: tables.includes('saved_searches'), claude_ping: ping, settings: Object.fromEntries(rows.map(r => [r.key, r.value])) });
});

// Wanted ghosts: tick = shown on the map. Saved to settings.wanted_off.
admin.get('/admin/wanted', async (c) => {
  const u = c.get('user')!;
  const row = await c.env.DB.prepare(`SELECT value FROM settings WHERE key = 'wanted_off'`).first<{ value: string }>();
  const off = new Set<string>(row ? JSON.parse(row.value) : []);
  const icons = await iconsDone(c.env); const missing = WANTED_ALL.filter(w => !icons.has(w.key)).length;
  return c.html(
    <Layout title="Admin · wanted items" user={u} back="/admin/pricing">
      <form method="post" action="/admin/wanted" style="padding:12px 16px 40px">
        <div class="row" style="justify-content:space-between;margin-bottom:10px;gap:8px;flex-wrap:wrap"><span class="hint">{WANTED_ALL.length - off.size} of {WANTED_ALL.length} on the map · {icons.size} custom icons{missing ? ` (${missing} missing)` : ''}</span><span class="row" style="gap:6px">{missing ? <button class="btn sm" type="submit" formaction="/admin/wanted/icons" formmethod="post">Make 12 icons</button> : null}<button class="btn sm" type="submit" formaction="/admin/demo/fixland" formmethod="post" title="Move demo items off parks/water (120 per tap)">Demo: off parks</button><button class="btn pri sm" type="submit">Save</button></span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px">
          {WANTED_ALL.map(w => <label class="card" style={'display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer' + (off.has(w.key) ? ';opacity:.45' : '')}><input type="checkbox" name="on" value={w.key} checked={!off.has(w.key)} />{icons.has(w.key) ? <img src={`/p/wanted/${w.key}.png?v=${Date.now()}`} alt="" style="width:40px;height:40px;object-fit:contain" /> : <span style="font-size:24px">{w.emoji}</span>}<span style="font-size:13px;font-weight:700;flex:1">{w.label}</span><button type="submit" formaction={`/admin/wanted/icons/${w.key}`} formmethod="post" class="btn sm" title="Regenerate icon" style="padding:0 8px;height:28px">↻</button></label>)}
        </div>
        <button class="btn pri full" type="submit" style="margin-top:14px">Save</button>
      </form>
    </Layout>
  );
});
admin.post('/admin/wanted/icons', async (c) => {
  const icons = await iconsDone(c.env);
  const todo = WANTED_ALL.filter(w => !icons.has(w.key)).slice(0, 12);
  // sequential in the background: each needs Flux + a cutout; the settings list is re-read per item so parallel runs don't clobber it
  c.executionCtx.waitUntil((async () => { for (const w of todo) { try { await makeWantedIcon(c.env, w.key); } catch (e) { console.warn('wanted icon', w.key, e); } } })());
  return c.redirect('/admin/wanted');
});
admin.post('/admin/demo/fixland', async (c) => { const r = await fixDemoLand(c.env, 120); return c.text(`checked ${r.checked}, moved ${r.moved}${r.done ? ' · done' : ' · tap again'}`); });
admin.post('/admin/wanted/icons/:key', async (c) => {
  const key = c.req.param('key');
  c.executionCtx.waitUntil(makeWantedIcon(c.env, key).catch(e => console.warn('wanted icon', key, e)));
  return c.redirect('/admin/wanted');
});
admin.post('/admin/wanted', async (c) => {
  const f = await c.req.parseBody({ all: true });
  const on = new Set<string>(Array.isArray(f.on) ? f.on.map(String) : f.on ? [String(f.on)] : []);
  const off = WANTED_ALL.map(w => w.key).filter(k => !on.has(k));
  await c.env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('wanted_off', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(off)).run();
  const ck = new Request(new URL('/api/places', c.env.APP_URL).toString()); c.executionCtx.waitUntil(caches.default.delete(ck).then(() => {}));
  return c.redirect('/admin/wanted');
});

admin.get('/admin/pricing', async (c) => {
  const u = c.get('user')!;
  const { rules, settings } = await loadPricing(c.env, true);
  const test = c.req.query('t');
  return c.html(
    <Layout title="Admin · pricing" user={u} back="/">
      <div style="padding:12px 16px 40px">
        <form method="post" action="/admin/pricing/test" enctype="multipart/form-data" class="card" style="margin-bottom:14px">
          <b>Test identification</b>
          <div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap">
            <input type="file" name="photo" accept="image/*" required style="font-size:13px!important" />
            <input name="hint" placeholder="hint (optional)" style="height:38px;border-radius:10px;border:1.5px solid var(--line);padding:0 10px;flex:1;min-width:120px" />
            <button class="btn sm pri" type="submit">Run</button>
          </div>
          {test ? <pre style="margin:10px 0 0;white-space:pre-wrap;font-size:12px;background:var(--cream);padding:10px;border-radius:10px">{decodeURIComponent(test)}</pre> : null}
        </form>
        <form method="post" action="/admin/pricing/settings" class="card" style="margin-bottom:14px">
          <b>Global</b>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px">
            <label class="field" style="margin:0"><span>Min $/day</span><input name="price_min_cents" type="number" value={parseInt(settings.price_min_cents) / 100} /></label>
            <label class="field" style="margin:0"><span>Max $/day</span><input name="price_max_cents" type="number" value={parseInt(settings.price_max_cents) / 100} /></label>
            <label class="field" style="margin:0"><span>Round to $</span><input name="price_round_to" type="number" value={parseInt(settings.price_round_to) / 100} step="0.5" /></label>
          </div>
          <label class="field"><span>Vision model</span><input name="vision_model" value={settings.vision_model} /></label>
          <button class="btn sm" type="submit">Save</button>
        </form>
        <div class="card">
          <b>Rules</b> <span class="hint">day price = retail × rate% (if retail known) else typical; week = 7 × day × week%</span>
          <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px">
            <thead><tr style="text-align:left;color:var(--mute);font-size:11px"><th>Category</th><th>Typical $/day</th><th>Rate %</th><th>Week %</th><th></th></tr></thead>
            <tbody>
              {rules.map(r => (
                <tr style="border-top:1px solid var(--line2)">
                  <form method="post" action={'/admin/pricing/rule/' + r.category}>
                    <td style="padding:6px 4px 6px 0"><b>{r.label}</b><div class="hint" style="font-size:10px">{r.category}</div></td>
                    <td><input name="day" type="number" value={r.day_cents / 100} style="width:64px;height:34px;border-radius:8px;border:1.5px solid var(--line);padding:0 6px" /></td>
                    <td><input name="rate" type="number" step="0.5" value={r.rate_pct} style="width:56px;height:34px;border-radius:8px;border:1.5px solid var(--line);padding:0 6px" /></td>
                    <td><input name="week" type="number" step="5" value={r.week_pct} style="width:56px;height:34px;border-radius:8px;border:1.5px solid var(--line);padding:0 6px" /></td>
                    <td><button class="btn sm" type="submit" style="height:34px">Save</button></td>
                  </form>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
});

admin.post('/admin/pricing/test', async (c) => {
  const f = await c.req.parseBody();
  const p = f.photo;
  if (!(p instanceof File)) return c.redirect('/admin/pricing');
  const id = await identifyItem(c.env, await p.arrayBuffer(), String(f.hint || '') || null);
  const { rules, settings } = await loadPricing(c.env, true);
  const pr = suggestPrice(rules, settings, id.category, id.retail_usd);
  const out = { ...id, suggested: `${money(pr.day_cents)}/day · ${money(pr.week_cents)}/wk`, basis: pr.basis };
  return c.redirect('/admin/pricing?t=' + encodeURIComponent(JSON.stringify(out, null, 2)));
});

admin.post('/admin/pricing/settings', async (c) => {
  const f = await c.req.parseBody();
  const dollars = (k: string) => String(Math.round(parseFloat(String(f[k] || '0')) * 100));
  const vals: Record<string, string> = { price_min_cents: dollars('price_min_cents'), price_max_cents: dollars('price_max_cents'), price_round_to: dollars('price_round_to'), vision_model: String(f.vision_model || '').trim() };
  for (const k of Object.keys(vals)) if (vals[k] && vals[k] !== 'NaN') await c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, vals[k]).run();
  return c.redirect('/admin/pricing');
});

admin.post('/admin/pricing/rule/:cat', async (c) => {
  const f = await c.req.parseBody();
  const day = Math.round(parseFloat(String(f.day || '0')) * 100), rate = parseFloat(String(f.rate || '0')), week = parseFloat(String(f.week || '0'));
  if (day > 0 && rate >= 0 && week > 0) await c.env.DB.prepare('UPDATE price_rules SET day_cents = ?, rate_pct = ?, week_pct = ? WHERE category = ?').bind(day, rate, week, c.req.param('cat')).run();
  return c.redirect('/admin/pricing');
});

// Photo check: listings held by the safety filter. OK → live (+ alerts); Remove → owner texted to add a new photo.
admin.get('/admin/review', async (c) => {
  const u = c.get('user')!;
  const rows = (await c.env.DB.prepare(`SELECT l.id, l.name, l.owner_id, (SELECT r2_key FROM photos p WHERE p.listing_id = l.id ORDER BY pos LIMIT 1) k, (SELECT value FROM settings s WHERE s.key = 'flag_' || l.id) why FROM listings l WHERE l.status = 'review' ORDER BY l.created_at DESC LIMIT 100`).all<{ id: string; name: string; owner_id: string; k: string | null; why: string | null }>()).results;
  return c.html(
    <Layout title="Admin · photo check" user={u} back="/admin/pricing">
      <div style="padding:12px 16px 40px">
        <div class="hint" style="margin-bottom:10px">{rows.length} held</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">
          {rows.map(r => (
            <div class="card" style="padding:8px">
              {r.k ? <img src={'/p/' + r.k} style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px" /> : null}
              <div style="font-weight:800;margin-top:6px">{r.name}</div>
              <div class="hint">{r.why || 'flagged'}</div>
              <form method="post" action={'/admin/review/' + r.id} class="row" style="gap:6px;margin-top:6px">
                <button class="btn pri sm" name="v" value="ok" type="submit">OK</button>
                <button class="btn sm" name="v" value="rm" type="submit" style="color:var(--red)">Remove</button>
              </form>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
});
admin.post('/admin/review/:id', async (c) => {
  const lid = c.req.param('id'), v = String((await c.req.parseBody()).v || '');
  const it = await listingById(c.env.DB, lid);
  if (!it || it.status !== 'review') return c.redirect('/admin/review');
  if (v === 'ok') {
    await c.env.DB.prepare(`UPDATE listings SET status = 'live' WHERE id = ?`).bind(lid).run();
    c.executionCtx.waitUntil(matchListing(c.env, lid).catch(() => {}));
  } else if (v === 'rm') {
    await c.env.DB.prepare(`UPDATE listings SET status = 'removed' WHERE id = ?`).bind(lid).run();
    const owner = await userById(c.env.DB, it.owner_id);
    if (owner) c.executionCtx.waitUntil(textUser(c.env, owner, `Lendo: the photo for your ${it.name} can't be posted. List it again with a photo of just the item ${c.env.APP_URL}/list`, 'rental').catch(() => {}));
  }
  await c.env.DB.prepare(`DELETE FROM settings WHERE key = ?`).bind('flag_' + lid).run();
  return c.redirect('/admin/review');
});

// Promo: owners with 10+ real listings (List 10 things, get $10) → FaceTime check, then pay next day.
admin.get('/admin/promo', async (c) => {
  const u = c.get('user')!;
  const rows = (await c.env.DB.prepare(`SELECT u.id, u.name, u.phone, u.hood, u.stripe_account_id acct, COUNT(l.id) n, (SELECT value FROM settings s WHERE s.key = 'promo10_' || u.id) done FROM users u JOIN listings l ON l.owner_id = u.id WHERE l.status IN ('live','paused') AND l.demo = 0 AND u.demo = 0 GROUP BY u.id HAVING n >= 10 ORDER BY done IS NOT NULL, n DESC`).all<{ id: string; name: string | null; phone: string; hood: string | null; acct: string | null; n: number; done: string | null }>()).results;
  return c.html(
    <Layout title="Admin · $10 promo" user={u} back="/admin">
      <div style="padding:12px 16px 40px">
        <div class="hint" style="margin-bottom:10px">{rows.length} owners with 10+ listed · after the FaceTime check, tap Done: $10 cash goes to their payout account and $10 rental credit to their account</div>
        {rows.map(r => <div class="card" style="padding:10px;margin-bottom:6px">
          <div class="row" style="justify-content:space-between"><a href={'/u/' + r.id} style="font-weight:800">{r.name || 'Neighbor'}</a><span class="hint">{r.hood || ''} · {r.n} listed · <a href={'facetime:' + r.phone}>FaceTime</a></span></div>
          {r.done ? <div class="hint" style="margin-top:6px">✓ {r.done}</div>
            : <form method="post" action={'/admin/promo/' + r.id} style="margin-top:8px" onsubmit="return confirm('Checked on FaceTime? This sends $10 cash and adds a $10 rental credit')"><button class="btn pri sm" type="submit" style="width:auto">Done · send $10 + $10 credit</button>{r.acct ? null : <span class="hint" style="margin-left:8px">no payout account yet: cash waits</span>}</form>}
        </div>)}
      </div>
    </Layout>
  );
});
admin.post('/admin/promo/:uid', async (c) => {
  const uid = c.req.param('uid'), key = 'promo10_' + uid;
  // claim first so a double tap can't pay twice
  const claim = await c.env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, 'working')`).bind(key).run();
  if (!claim.meta.changes) return c.redirect('/admin/promo');
  const who = await userById(c.env.DB, uid);
  if (!who) { await c.env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(key).run(); return c.redirect('/admin/promo'); }
  // $10 rental credit (replaces the $5 phone-bar credit, used once)
  await c.env.DB.prepare('UPDATE users SET promo_cents = MAX(COALESCE(promo_cents, 0), 1000) WHERE id = ?').bind(uid).run();
  // $10 cash to their Stripe payout account, if they have one
  let cash = 'cash waits for a payout account';
  const s = stripe(c.env);
  if (s && who.stripe_account_id) {
    try { await s.transfers.create({ amount: 1000, currency: 'usd', destination: who.stripe_account_id, metadata: { promo: 'list10', user_id: uid } }, { idempotencyKey: 'promo10_' + uid }); cash = '$10 cash sent'; }
    catch (e: any) { cash = 'cash failed: ' + String(e?.message || e).slice(0, 80); }
  }
  await c.env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(`${new Date().toISOString().slice(0, 10)} · ${cash} · $10 credit added`, key).run();
  c.executionCtx.waitUntil(textUser(c.env, who, cash === '$10 cash sent' ? `Lendo: $10 sent for listing 10 things, plus $10 toward your next rental` : `Lendo: $10 toward your next rental is on your account. Set up payouts to get your $10 cash ${c.env.APP_URL}/payout`, 'money').catch(() => {}));
  return c.redirect('/admin/promo');
});
