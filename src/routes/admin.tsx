// Admin (allowlisted phones only): pricing rules + identification test.
import { Hono } from 'hono';
import type { Env, Vars } from '../lib/env';
import { WANTED_ALL } from '../lib/places';
import { iconsDone, makeWantedIcon } from '../lib/wanted-icons';
import { fixDemoLand } from '../lib/demo-land';
import { Layout } from '../pages/layout';
import { requireUser } from '../lib/auth';
import { identifyItem, loadPricing, suggestPrice, lastRaw } from '../lib/identify';
import { money } from '../lib/util';

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
  const id = await identifyItem(c.env, bytes, hint);
  c.executionCtx.waitUntil(c.env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('last_identify', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify({ at: new Date().toISOString(), key: !!c.env.ANTHROPIC_API_KEY, name: id.name, brand: id.brand ?? null, raw: lastRaw.slice(0, 600) })).run());
  const { rules, settings } = await loadPricing(c.env);
  const pr = suggestPrice(rules, settings, id.category, id.retail_usd);
  return c.json({ ...id, cut: `/api/cuttmp/${tmp.slice(4)}`, price_cents: pr.day_cents, week_cents: pr.week_cents, basis: pr.basis, category_label: pr.rule.label, ...(c.req.query('raw') && c.get('user')!.admin ? { raw: lastRaw } : {}) });
});

admin.get('/admin', (c) => c.redirect('/admin/pricing'));
// what the background pieces last did (identify, inbound texts, icons) + a live Claude ping
admin.get('/admin/debug', async (c) => {
  const rows = (await c.env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('last_identify','last_inbound','last_inbound_err','wanted_icons_err','wanted_bad')`).all<{ key: string; value: string }>()).results;
  let ping = 'no ANTHROPIC_API_KEY';
  if (c.env.ANTHROPIC_API_KEY) { try { const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': c.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 5, messages: [{ role: 'user', content: 'Say OK' }] }) }); ping = r.status + ' ' + (await r.text()).slice(0, 300); } catch (e: any) { ping = 'ERR ' + (e?.message || e); } }
  return c.json({ claude_ping: ping, settings: Object.fromEntries(rows.map(r => [r.key, r.value])) });
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
