// Admin (allowlisted phones only): pricing rules + identification test.
import { Hono } from 'hono';
import type { Env, Vars } from '../lib/env';
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
  const id = await identifyItem(c.env, await p.arrayBuffer(), hint);
  const { rules, settings } = await loadPricing(c.env);
  const pr = suggestPrice(rules, settings, id.category, id.retail_usd);
  return c.json({ ...id, price_cents: pr.day_cents, week_cents: pr.week_cents, basis: pr.basis, category_label: pr.rule.label, ...(c.req.query('raw') && c.get('user')!.admin ? { raw: lastRaw } : {}) });
});

admin.get('/admin', (c) => c.redirect('/admin/pricing'));

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
