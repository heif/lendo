// Admin dashboard: KPIs, money, activity log, rentals, users, texts, searches, errors. Admin-only (guarded in admin.tsx).
import type { Hono } from 'hono';
import type { Env, Vars } from '../lib/env';
import { accept, customerCancel, decline, holdDeposit, pickedUp, returned } from '../lib/rentals';
import { placeDeposit, stripe } from '../lib/stripe';
import { rentalById } from '../lib/db';
import { CATEGORIES, REASONS, routeFor, routes } from '../lib/flags';
import { Layout } from '../pages/layout';
import { money } from '../lib/util';
import { logEvent } from '../lib/log';
import { CONFIRM_ASK, textStreak } from '../lib/blooio';
import { id as newId, now as nowMs } from '../lib/util';

type A = Hono<{ Bindings: Env; Variables: Vars }>;
const DAY = 86400000;
const ago = (t: number) => { const s = (Date.now() - t) / 1000; return s < 90 ? Math.round(s) + 's' : s < 5400 ? Math.round(s / 60) + 'm' : s < 129600 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd'; };
const when = (t: number) => new Date(t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const esc = (s: unknown) => String(s ?? '');

const CSS = `.wrap:has(.ad){max-width:1180px}.ad{padding:10px 14px 48px;max-width:1100px;margin:0 auto}.ad h3{font-size:13px;letter-spacing:.06em;text-transform:uppercase;margin:22px 0 8px;opacity:.7}
.ad-k{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.ad-k a{background:#fff;border-radius:12px;padding:10px 12px;text-decoration:none;color:var(--ink);display:block}
.ad-k b{display:block;font-size:24px;font-weight:900;letter-spacing:-.02em}.ad-k span{font-size:12px;opacity:.7}.ad-k a.warn b{color:#FF4F00}
.ad-sub{display:flex;flex-wrap:wrap;gap:4px;margin:2px 0 8px}.ad-sub a{background:#fff;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700;text-decoration:none;color:var(--ink)}.ad-sub a.on{background:var(--ink);color:#fff}
.ad-t{width:100%;border-collapse:collapse;font-size:12.5px;background:#fff;border-radius:12px;overflow:hidden}.ad-t td,.ad-t th{padding:6px 8px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}.ad-t th{font-size:11px;text-transform:uppercase;opacity:.6}
.ad-t td.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.ad-t .d{max-width:420px;word-break:break-word;opacity:.8;font-family:ui-monospace,Menlo,monospace;font-size:11px}
.ad-f{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}.ad-f input,.ad-f select{height:34px;border-radius:8px;border:1px solid #ddd;padding:0 8px;font:inherit;font-size:13px}.ad-f button{height:34px}
.ad-wrap{overflow-x:auto}.ad-kind{font-weight:700;white-space:nowrap}.ad-kind.error,.ad-kind.text\\.failed{color:#c22}.ad-kind.money{color:#0a7}`;

/* one admin nav for every admin page: a single tight row (scrolls sideways on a phone), sticky under the header; red counts = needs attention */
const NAV_CSS = `.adn{position:sticky;top:0;z-index:20;background:var(--cream,#F5F3EE);margin:0 -14px 6px;padding:6px 14px;border-bottom:1px solid rgba(30,58,43,.1)}
.adn div{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;white-space:nowrap}.adn div::-webkit-scrollbar{display:none}
.adn a{padding:5px 9px;border-radius:8px;font-size:12.5px;font-weight:700;text-decoration:none;color:var(--ink);opacity:.7}.adn a:hover{opacity:1;background:rgba(30,58,43,.06)}
.adn a.on{opacity:1;background:var(--ink);color:#fff}.adn i{width:1px;align-self:stretch;margin:4px 5px;background:rgba(30,58,43,.18)}
.adn sup{font-size:10px;font-weight:800;color:#fff;background:#FF4F00;border-radius:999px;padding:0 5px;margin-left:3px;vertical-align:2px}`;
const NAV: ([string, string, ('review' | 'error' | 'flag')?] | null)[] = [['/admin', 'Home'], ['/admin/flags', 'Flags', 'flag'], ['/admin/log', 'Log'], ['/admin/rentals', 'Rentals'], ['/admin/users', 'Users'], ['/admin/texts', 'Texts'], ['/admin/texting', 'Texting check'], ['/admin/searches', 'Searches'], ['/admin/log?kind=error', 'Errors', 'error'], null, ['/admin/review', 'Photos', 'review'], ['/admin/promo', 'Promo'], ['/admin/ab', 'A/B'], ['/admin/paytest', 'Pay test'], ['/admin/pricing', 'Pricing'], ['/admin/wanted', 'Wanted'], ['/admin/demo', 'Demo'], ['/admin/debug', 'System'], ['/admin/access', 'Access']];
export async function AdminNav({ c, path }: { c: any; path: string }) {
  const [rv, er, fl] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) n FROM listings WHERE status = 'review'`).first().catch(() => null),
    c.env.DB.prepare(`SELECT COUNT(*) n FROM events WHERE kind = 'error' AND at > ?`).bind(Date.now() - DAY).first().catch(() => null),
    c.env.DB.prepare(`SELECT COUNT(*) n FROM flags WHERE status != 'done'`).first().catch(() => null),
  ]);
  const badge = { review: (rv as any)?.n || 0, error: (er as any)?.n || 0, flag: (fl as any)?.n || 0 };
  const viewOnly = c.get('user')?.admin_level === 'view';
  return <nav class="adn">{viewOnly ? <p class="hint" style="margin:0 0 4px;font-size:12px">View-only access · buttons won't save</p> : null}<style dangerouslySetInnerHTML={{ __html: NAV_CSS }} /><div>{NAV.filter(n => !n || n[0] !== '/admin/access' || c.get('user')?.admin_level === 'owner').map(n => n ? <a href={n[0]} class={n[0] === path ? 'on' : ''}>{n[1]}{n[2] && badge[n[2]] ? <sup>{badge[n[2]]}</sup> : null}</a> : <i />)}</div><script dangerouslySetInnerHTML={{ __html: `(function(){var a=document.querySelector('.adn a.on');if(a)a.parentNode.scrollLeft=a.offsetLeft-60})()` }} /></nav>;
}
function Shell(p: { c: any; title: string; path: string; children: any }) {
  return <Layout title={'Admin · ' + p.title} user={p.c.get('user')}>
    <style dangerouslySetInnerHTML={{ __html: CSS }} />
    <div class="ad"><AdminNav c={p.c} path={p.path} />{p.children}</div>
  </Layout>;
}
const kindClass = (k: string) => 'ad-kind ' + (k.startsWith('money.') ? 'money' : k);
const linkFor = (r: { user_id?: string | null; rental_id?: string | null; listing_id?: string | null }) => <>
  {r.rental_id ? <a href={'/admin/log?rental=' + r.rental_id}>{r.rental_id}</a> : null}{r.rental_id && r.listing_id ? ' · ' : ''}
  {r.listing_id ? <a href={'/i/' + r.listing_id}>{r.listing_id}</a> : null}{(r.rental_id || r.listing_id) && r.user_id ? ' · ' : ''}
  {r.user_id ? <a href={'/admin/log?user=' + r.user_id}>{r.user_id}</a> : null}</>;

type EvRow = { id: number; at: number; kind: string; user_id: string | null; rental_id: string | null; listing_id: string | null; amount_cents: number | null; data: string | null; uname?: string | null };
function EvTable({ rows }: { rows: EvRow[] }) {
  return <div class="ad-wrap"><table class="ad-t"><tr><th>When</th><th>What</th><th>Who / which</th><th class="n">$</th><th>Details</th></tr>
    {rows.map(r => <tr><td title={new Date(r.at).toISOString()} style="white-space:nowrap">{when(r.at)}</td><td class={kindClass(r.kind)}><a href={'/admin/log?kind=' + encodeURIComponent(r.kind)} style="color:inherit">{r.kind}</a></td><td>{r.uname ? <b>{r.uname} </b> : null}{linkFor(r)}</td><td class="n">{r.amount_cents != null ? money(r.amount_cents) : ''}</td><td class="d">{esc(r.data)}</td></tr>)}
  </table>{rows.length ? null : <p class="hint">Nothing yet</p>}</div>;
}

const one = async <T,>(c: any, sql: string, ...b: unknown[]) => (await c.env.DB.prepare(sql).bind(...b).first().catch(() => null)) as T | null;
const all = async <T,>(c: any, sql: string, ...b: unknown[]) => ((await c.env.DB.prepare(sql).bind(...b).all().catch(() => ({ results: [] }))).results) as T[];

export function registerDash(admin: A) {
  // ---------- Payments test console (Stripe TEST mode only; owner admin): play the owner's side of a rental ----------
  const testMode = (c: any) => (c.env.STRIPE_SECRET_KEY || '').startsWith('sk_test') && c.get('user')?.admin_level === 'owner';
  admin.get('/admin/paytest', async (c) => {
    if (!testMode(c)) return c.html(<Shell c={c} title="Payments test" path="/admin/paytest"><div class="hint">Only in Stripe test mode, for the owner admin</div></Shell>);
    const rows = (await c.env.DB.prepare(`SELECT r.*, l.name item, l.deposit_cents l_dep FROM rentals r JOIN listings l ON l.id = r.listing_id WHERE r.updated_at > ? ORDER BY r.updated_at DESC LIMIT 15`).bind(Date.now() - 3 * DAY).all<any>()).results;
    const s = stripe(c.env);
    const st = async (pi?: string | null) => { if (!s || !pi) return '—'; try { const x = await s.paymentIntents.retrieve(pi); return `${x.status} · ${money(x.amount)}${x.amount_received ? ' · got ' + money(x.amount_received) : ''}`; } catch (e: any) { return 'err ' + String(e?.message || e).slice(0, 40); } };
    const piRows = await Promise.all(rows.map(async r => [await st(r.stripe_payment_intent), await st(r.deposit_pi)]));
    const B = (rid: string, act: string, l: string) => <form method="post" action={`/admin/paytest/${rid}/${act}`} style="display:inline"><button class="btn sm" type="submit">{l}</button></form>;
    return c.html(<Shell c={c} title="Payments test" path="/admin/paytest">
      <div class="hint" style="margin-bottom:10px">Stripe TEST mode. Rent something on your phone with test card 4242 4242 4242 4242 (any future date, any CVC), then play the owner here. Each step runs the real code path; Stripe state is read live</div>
      <form method="post" action="/admin/paytest/item" class="row" style="gap:6px;margin-bottom:12px;align-items:center"><span class="hint">Test item (not yours):</span><input name="lid" placeholder="listing id, e.g. l_…" style="height:34px;border:1.5px solid #e3dfd6;border-radius:8px;padding:0 8px;width:220px" /><select name="dep"><option value="15000">$150 hold ON</option><option value="0">hold off</option></select><button class="btn sm pri" type="submit">Set</button></form>
      <div class="ad-wrap"><table class="ad-t"><tr><th>Rental</th><th>Status</th><th>Rent payment (Stripe)</th><th>$150 hold</th><th>Owner actions</th></tr>
        {rows.map((r, i) => <tr><td><a href={'/r/' + r.id}>{r.item}</a><br /><span class="hint">{r.id} · {r.start_day}→{r.end_day} · {money(r.total_cents)}</span></td><td>{r.status}</td><td>{piRows[i][0]}</td>
          <td>{r.deposit_cents ? `${r.deposit_status || ''} · ${piRows[i][1]}${r.stripe_pm ? ' · card saved' : ' · no card saved'}` : 'off'}</td>
          <td style="white-space:nowrap">{r.status === 'held' ? <>{B(r.id, 'yes', 'YES')} {B(r.id, 'no', 'NO')}</> : null}
            {r.status === 'confirmed' ? <>{r.deposit_cents && r.deposit_status !== 'held' ? B(r.id, 'hold', 'Place $150 hold') : null} {B(r.id, 'pickup', 'Handed over')} {B(r.id, 'cancel', 'Customer cancels')}</> : null}
            {r.status === 'picked_up' ? <>{r.deposit_status === 'held' ? B(r.id, 'renew', 'Renew hold') : null} {B(r.id, 'return', 'Returned')}</> : null}</td></tr>)}
      </table></div>
    </Shell>);
  });
  admin.post('/admin/paytest/item', async (c) => {
    if (!testMode(c)) return c.notFound();
    const f = await c.req.parseBody(); const lid = String(f.lid || '').trim(), dep = f.dep === '15000' ? 15000 : 0;
    await c.env.DB.prepare('UPDATE listings SET deposit_cents = ? WHERE id = ?').bind(dep, lid).run();
    await logEvent(c.env.DB, 'admin.paytest', { user: c.get('user')!.id, listing: lid, cents: dep, data: { act: 'item_hold' } });
    return c.redirect('/admin/paytest');
  });
  admin.post('/admin/paytest/:id/:act', async (c) => {
    if (!testMode(c)) return c.notFound();
    const r = await rentalById(c.env.DB, c.req.param('id')); if (!r) return c.notFound();
    const act = c.req.param('act');
    if (act === 'yes') await accept(c.env, r);
    else if (act === 'no') await decline(c.env, r, 'declined');
    else if (act === 'hold') await holdDeposit(c.env, r);
    else if (act === 'pickup') await pickedUp(c.env, r, null);
    else if (act === 'return') await returned(c.env, r, null);
    else if (act === 'cancel') await customerCancel(c.env, r);
    else if (act === 'renew') await placeDeposit(c.env, r, true);
    await logEvent(c.env.DB, 'admin.paytest', { user: c.get('user')!.id, rental: r.id, data: { act } });
    return c.redirect('/admin/paytest');
  });

  // ---------- A/B: $5 button copy (exp gift5) ----------
  admin.get('/admin/ab', async (c) => {
    const rows = (await c.env.DB.prepare(`SELECT json_extract(data,'$.var') var, json_extract(data,'$.ev') ev, COUNT(*) n, COUNT(DISTINCT COALESCE(json_extract(data,'$.v'), user_id)) u FROM events WHERE kind = 'ab.gift5' GROUP BY 1, 2`).all<{ var: string; ev: string; n: number; u: number }>()).results;
    const rows2 = (await c.env.DB.prepare(`SELECT json_extract(data,'$.var') var, json_extract(data,'$.ev') ev, COUNT(*) n, COUNT(DISTINCT COALESCE(json_extract(data,'$.v'), user_id)) u FROM events WHERE kind = 'ab.list10' GROUP BY 1, 2`).all<{ var: string; ev: string; n: number; u: number }>()).results;
    const g = (v: string, ev: string, uniq = false) => { const r = rows.find(x => x.var === v && x.ev === ev); return r ? (uniq ? r.u : r.n) : 0; };
    const pct = (a: number, b: number) => b ? (100 * a / b).toFixed(1) + '%' : '—';
    const V = [['a', 'Free $5 off rental'], ['b', 'Free $5 gift card']];
    return c.html(<Shell c={c} title="A/B" path="/admin/ab">
      <h3>$5 button copy · 50/50 per browser, logged-out only</h3>
      <table class="ad-t"><tr><th>Variant</th><th>Visitors saw it</th><th>Clicks</th><th>Click rate</th><th>Claimed $5</th><th>Claim rate</th></tr>
        {V.map(([v, l]) => { const seen = g(v, 'view', true), cl = g(v, 'click'), cm = g(v, 'claim'); return <tr><td><b>{v.toUpperCase()}</b> · {l}</td><td>{seen}</td><td>{cl}</td><td>{pct(cl, seen)}</td><td>{cm}</td><td><b>{pct(cm, seen)}</b></td></tr>; })}
      </table>
      <div class="hint" style="margin-top:8px">Claimed = a new $5 by text (phones, QR) or phone # (computers). A few hundred visitors per side before reading much into it</div>
      <h3 style="margin-top:28px">List-10 promo copy · 1/3 each, ribbon + list-flow strip</h3>
      <table class="ad-t"><tr><th>Variant</th><th>Visitors saw it</th><th>Clicked Rent yours out</th><th>Click rate</th><th>Listed 1+</th><th>Rate</th><th>Reached 10</th></tr>
        {[['a', '$10 BONUS TODAY'], ['b', 'GET $10 TODAY'], ['c', 'LIST 10, GET $10']].map(([v, l]) => { const q = (ev: string, uniq = false) => { const r = rows2.find(x => x.var === v && x.ev === ev); return r ? (uniq ? r.u : r.n) : 0; }; const seen = q('view', true), cl = q('click'), li = q('listed'); return <tr><td><b>{v.toUpperCase()}</b> · {l}</td><td>{seen}</td><td>{cl}</td><td>{pct(cl, seen)}</td><td>{li}</td><td><b>{pct(li, seen)}</b></td><td>{q('ten')}</td></tr>; })}
      </table>
    </Shell>);
  });
  // ---------- Flags: queue + routing (category → owner / admins / agent) ----------
  admin.get('/admin/flags', async (c) => {
    const st = c.req.query('status') || 'open';
    const rows = (await c.env.DB.prepare(`SELECT f.*, u.name reporter FROM flags f LEFT JOIN users u ON u.id = f.reporter_id ${st === 'all' ? '' : st === 'done' ? "WHERE f.status = 'done'" : "WHERE f.status != 'done'"} ORDER BY CASE f.category WHEN 'safety' THEN 0 WHEN 'money' THEN 1 ELSE 2 END, f.created_at DESC LIMIT 200`).all<any>().catch(() => ({ results: [] as any[] }))).results;
    const rt = await routes(c.env);
    const admins = (await c.env.DB.prepare(`SELECT id, name FROM users WHERE admin_role = 'full'`).all<{ id: string; name: string }>()).results;
    const who = [['owner', 'Owner (you)'], ...admins.map(a => [a.id, a.name || a.id]), ['agent', 'Agent (Claude suggests)']];
    const nm = (w: string) => (who.find(x => x[0] === w) || [w, w])[1];
    const link = (f: any) => f.kind === 'item' ? '/i/' + f.target_id : f.kind === 'user' ? '/u/' + f.target_id : '/admin/log?rental=' + (f.rental_id || f.target_id);
    const label = (f: any) => (REASONS as any)[f.kind]?.find((x: string[]) => x[0] === f.reason)?.[1] || f.reason;
    return c.html(<Shell c={c} title="Flags" path="/admin/flags">
      <div class="row" style="gap:8px;margin:6px 0 12px">{[['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => <a class={'btn sm' + (st === k ? ' pri' : '')} href={'/admin/flags?status=' + k}>{l}</a>)}</div>
      {rows.length ? rows.map(f => <div class="card" style={'padding:12px;margin-bottom:8px' + (f.category === 'safety' || f.category === 'money' ? ';border:2px solid #FF4F00' : '')}>
        <div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap"><b>{CATEGORIES.find(x => x[0] === f.category)?.[1] || f.category} · {label(f)}</b>
          <span class="hint">{f.kind} · <a href={link(f)}>open</a> · by {f.reporter || f.reporter_id} · {new Date(f.created_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></div>
        {f.note ? <div style="margin-top:6px">“{f.note}”</div> : null}
        {f.agent_note ? <div class="hint" style="margin-top:6px;background:#F5F3EE;border-radius:8px;padding:6px 8px">🤖 {f.agent_note}</div> : null}
        <form method="post" action={'/admin/flags/' + f.id} class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap;align-items:center">
          <select name="status">{['new', 'looking', 'done'].map(x => <option value={x} selected={f.status === x}>{x}</option>)}</select>
          <select name="assignee">{who.filter(w => w[0] !== 'agent').map(([v, l]) => <option value={v} selected={(f.assignee || '').split(',')[0] === v}>{l}</option>)}</select>
          <input name="admin_note" value={f.admin_note || ''} placeholder="Note" style="flex:1;min-width:140px;height:34px;border:1.5px solid #e3dfd6;border-radius:8px;padding:0 8px" />
          <button class="btn sm pri" type="submit">Save</button>
        </form>
      </div>) : <div class="hint">No flags here</div>}
      <h3 style="margin:22px 0 6px">Routing</h3>
      <div class="hint" style="margin-bottom:8px">Who gets each kind. Safety + money text them right away; the rest wait here. Agent = Claude adds a suggestion, never acts</div>
      <form method="post" action="/admin/flags/routes" class="card" style="padding:12px">
        {CATEGORIES.map(([k, l]) => <div class="row" style="gap:10px;padding:6px 0;border-bottom:1px solid #eee;flex-wrap:wrap"><b style="width:200px">{l}</b>
          {who.map(([v, wl]) => <label style="display:inline-flex;gap:4px;align-items:center;font-size:13px"><input type="checkbox" name={'r_' + k} value={v} checked={routeFor(rt, k).includes(v)} />{wl}</label>)}</div>)}
        <button class="btn pri sm" type="submit" style="margin-top:10px">Save routing</button>
      </form>
      <div class="hint" style="margin-top:6px">Now: {CATEGORIES.map(([k, l]) => `${l} → ${routeFor(rt, k).map(nm).join(' + ')}`).join(' · ')}</div>
    </Shell>);
  });
  admin.post('/admin/flags/routes', async (c) => {
    const f = await c.req.parseBody({ all: true }); const out: Record<string, string[]> = {};
    for (const [k] of CATEGORIES) { const v = f['r_' + k]; out[k] = ([] as unknown[]).concat(v || []).map(String).slice(0, 10); }
    await c.env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('flag_routes', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(out)).run();
    await logEvent(c.env.DB, 'admin.flag_routes', { user: c.get('user')!.id, data: out });
    return c.redirect('/admin/flags');
  });
  admin.post('/admin/flags/:id', async (c) => {
    const f = await c.req.parseBody(); const st = ['new', 'looking', 'done'].includes(String(f.status)) ? String(f.status) : 'new';
    await c.env.DB.prepare('UPDATE flags SET status = ?, assignee = ?, admin_note = ?, updated_at = ? WHERE id = ?').bind(st, String(f.assignee || '').slice(0, 64), String(f.admin_note || '').slice(0, 500) || null, Date.now(), c.req.param('id')).run();
    await logEvent(c.env.DB, 'admin.flag', { user: c.get('user')!.id, data: { id: c.req.param('id'), status: st, assignee: f.assignee } });
    return c.redirect('/admin/flags');
  });

  // ---------- Texting check: is Blooio set up, are texts going out, are replies + receipts coming back ----------
  const bloo = async (c: any, path: string, init?: RequestInit) => {
    if (!c.env.BLOOIO_API_KEY) return { ok: false, status: 0, j: { error: 'BLOOIO_API_KEY not set (dev mode: texts only logged)' } };
    const r = await fetch(c.env.BLOOIO_API_BASE.replace(/\/$/, '') + path, { ...init, headers: { Authorization: `Bearer ${c.env.BLOOIO_API_KEY}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } }).catch((e: any) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }), text: async () => String(e) } as any));
    let j: any = null; try { j = await r.json(); } catch { j = null; }
    return { ok: r.ok, status: r.status, j };
  };
  admin.get('/admin/texting', async (c) => {
    const u = c.get('user')!;
    const [me, nums, hooks] = await Promise.all([bloo(c, '/me'), bloo(c, '/me/numbers'), bloo(c, '/webhooks')]);
    const hookList: any[] = Array.isArray(hooks.j) ? hooks.j : hooks.j?.webhooks || hooks.j?.data || hooks.j?.items || hooks.j?.results || [];
    const ours = hookList.filter(h => JSON.stringify(h).includes(new URL(c.env.APP_URL).host));
    const logs = ours[0] ? await bloo(c, `/webhooks/${ours[0].id || ours[0].webhook_id}/logs`) : null;
    const logList: any[] = logs ? (Array.isArray(logs.j) ? logs.j : logs.j?.logs || logs.j?.data || []) : [];
    const t = c.req.query('t');
    const sent = t ? await one<any>(c, `SELECT * FROM outbound_texts WHERE id = ?`, t) : null;
    const st = sent?.provider_id && !String(sent.provider_id).startsWith('dev_') ? await bloo(c, `/chats/${encodeURIComponent(u.phone)}/messages/${encodeURIComponent(sent.provider_id)}/status`) : null;
    const [lastIn, ins, stats, fails, streak] = await Promise.all([
      one<{ value: string }>(c, `SELECT value FROM settings WHERE key = 'last_inbound'`),
      all<any>(c, `SELECT i.created_at, i.body, i.via, u.name FROM inbound_texts i LEFT JOIN users u ON u.id = i.user_id WHERE i.via = 'text' ORDER BY i.created_at DESC LIMIT 8`),
      all<any>(c, `SELECT at, data FROM events WHERE kind = 'text.status' ORDER BY id DESC LIMIT 10`),
      all<any>(c, `SELECT at, kind, data FROM events WHERE kind IN ('text.failed','text.suppressed') ORDER BY id DESC LIMIT 8`),
      textStreak(c.env, u.id),
    ]);
    const evs = (h: any) => (h.events || h.event_types || h.types || h.subscribed_events || h.type || 'all') as any;
    const ok = (b: boolean) => <b style={'color:' + (b ? '#1F8A4C' : '#c22')}>{b ? '✓' : '✕'}</b>;
    const pre = (x: unknown) => <pre style="white-space:pre-wrap;word-break:break-word;font-size:11px;background:#fff;border-radius:10px;padding:8px;margin:6px 0">{JSON.stringify(x, null, 1).slice(0, 1500)}</pre>;
    return c.html(<Shell c={c} title="Texting check" path="/admin/texting">
      <h3>1 · Blooio account</h3>
      <p>{ok(me.ok)} API key works {me.ok ? '' : `· ${me.status}`} · {ok(nums.ok)} numbers</p>
      {pre({ me: { ...(me.j || {}), api_key: undefined }, numbers: nums.j })}
      <h3>2 · Webhook (replies + delivery receipts)</h3>
      <p>{ok(ours.length > 0)} webhook pointing at {new URL(c.env.APP_URL).host} · {ok(!!c.env.BLOOIO_WEBHOOK_SECRET)} signing secret set</p>
      {ours.map(h => <p class="hint">{h.url || h.webhook_url} · events: {JSON.stringify(evs(h))}</p>)}
      {hooks.ok && ours.length ? null : pre(hooks.j)}
      {logList.length ? <><p class="hint">Last deliveries to Lendo:</p>{pre(logList.slice(0, 8).map((l: any) => ({ at: l.created_at || l.timestamp, event: l.event || l.event_type, status: l.status_code || l.response_status || l.status, err: l.error })))}</> : null}
      <h3>3 · Send yourself a test</h3>
      <form method="post" action="/admin/texting/send" class="ad-f"><button class="btn pri sm" type="submit">Text me a test ({u.phone})</button><span class="hint">then reply OK from your phone and reload this page</span></form>
      {sent ? <><p>Sent: “{sent.body}” · Blooio id {sent.provider_id || <b style="color:#c22">none (not sent)</b>}</p>{st ? pre(st.j) : null}</> : null}
      <p class="hint">Your unanswered streak: <b>{streak}</b> of 6 (Blooio pauses at 6)</p>
      <h3>4 · Coming back in</h3>
      <p class="hint">Last webhook hit: {lastIn?.value || 'never'}</p>
      <div class="ad-wrap"><table class="ad-t"><tr><th>When</th><th>From</th><th>Text</th></tr>{ins.map(r => <tr><td style="white-space:nowrap">{when(r.created_at)}</td><td>{r.name}</td><td>{r.body}</td></tr>)}</table></div>
      <p class="hint" style="margin-top:10px">Delivery receipts (latest):</p>
      <div class="ad-wrap"><table class="ad-t"><tr><th>When</th><th>Receipt</th></tr>{stats.map(r => <tr><td style="white-space:nowrap">{when(r.at)}</td><td class="d">{r.data}</td></tr>)}</table>{stats.length ? null : <p class="hint" style="color:#c22">No receipts yet — the webhook may only be subscribed to incoming messages</p>}</div>
      <p class="hint" style="margin-top:10px">Failed / held (latest):</p>
      <div class="ad-wrap"><table class="ad-t"><tr><th>When</th><th></th><th>Detail</th></tr>{fails.map(r => <tr><td style="white-space:nowrap">{when(r.at)}</td><td class="ad-kind">{r.kind}</td><td class="d">{r.data}</td></tr>)}</table></div>
    </Shell>);
  });
  admin.post('/admin/texting/send', async (c) => {
    const u = c.get('user')!;
    const body = `Lendo test ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} · ${CONFIRM_ASK}`; /* ends with the confirm ask, so an OK back is acked silently (never relayed into a rental) */
    const { sendRaw } = await import('../lib/blooio');
    const r = await sendRaw(c.env, u.phone, body);
    const tid = newId('t');
    await c.env.DB.prepare('INSERT INTO outbound_texts (id, user_id, body, category, rental_id, provider_id, created_at) VALUES (?,?,?,?,?,?,?)').bind(tid, u.id, body, 'chat', null, r.ok ? (r.message_id || 'sent') : null, nowMs()).run();
    await logEvent(c.env.DB, r.ok ? 'text.test' : 'text.failed', { user: u.id, data: { body, id: r.message_id, err: r.error || null } });
    return c.redirect('/admin/texting?t=' + tid);
  });

  // ---------- Access: owner grants view / full admin to users ----------
  admin.get('/admin/access', async (c) => {
    const owners = (c.env.ADMIN_PHONES || '').split(',').map(x => x.trim()).filter(Boolean);
    const users = await all<{ id: string; name: string | null; phone: string; admin_role: string | null }>(c, `SELECT id, name, phone, admin_role FROM users WHERE demo = 0 ORDER BY admin_role IS NULL, name`);
    const granted = users.filter(u => u.admin_role), others = users.filter(u => !u.admin_role && !owners.includes(u.phone));
    const ownerRows = users.filter(u => owners.includes(u.phone));
    const ROLE = { view: 'View only — sees everything, changes nothing', full: 'Full — everything except this page' } as Record<string, string>;
    return c.html(<Shell c={c} title="Access" path="/admin/access">
      <h3>Who has admin</h3>
      <div class="ad-wrap"><table class="ad-t"><tr><th>Name</th><th>Phone</th><th>Access</th><th></th></tr>
        {ownerRows.map(u => <tr><td><b>{u.name || '—'}</b></td><td>{u.phone}</td><td>Owner (set in Cloudflare)</td><td></td></tr>)}
        {granted.map(u => <tr><td><b>{u.name || '—'}</b> <a class="hint" href={'/admin/log?user=' + u.id}>log</a></td><td>{u.phone}</td><td>
          <form method="post" action="/admin/access" class="row" style="gap:6px"><input type="hidden" name="uid" value={u.id} />
            <select name="role" onchange="this.form.submit()" style="height:32px;border-radius:8px;border:1px solid #ddd;font:inherit;font-size:13px">{['view', 'full'].map(r => <option value={r} selected={u.admin_role === r}>{ROLE[r]}</option>)}</select></form></td>
          <td><form method="post" action="/admin/access"><input type="hidden" name="uid" value={u.id} /><input type="hidden" name="role" value="" /><button class="btn sm" type="submit">Remove</button></form></td></tr>)}
      </table></div>
      <h3>Add someone</h3>
      <form method="post" action="/admin/access" class="ad-f">
        <select name="uid" required><option value="">Pick a user…</option>{others.map(u => <option value={u.id}>{(u.name || '—') + ' · ' + u.phone}</option>)}</select>
        <select name="role">{['view', 'full'].map(r => <option value={r}>{ROLE[r]}</option>)}</select>
        <button class="btn pri sm" type="submit">Give access</button>
      </form>
      <p class="hint">Admin pages show every user's phone number and texts. View-only can't press buttons that change things (photo check, promo payouts, pricing, wanted). Every change here is in the log</p>
    </Shell>);
  });
  admin.post('/admin/access', async (c) => {
    const f = await c.req.parseBody(), uid = String(f.uid || ''), role = String(f.role || '');
    if (!uid || !['', 'view', 'full'].includes(role)) return c.redirect('/admin/access');
    const was = await one<{ admin_role: string | null; name: string | null }>(c, `SELECT admin_role, name FROM users WHERE id = ?`, uid);
    if (!was) return c.redirect('/admin/access');
    await c.env.DB.prepare('UPDATE users SET admin_role = ? WHERE id = ?').bind(role || null, uid).run();
    await logEvent(c.env.DB, role ? 'admin.access_granted' : 'admin.access_removed', { user: uid, data: { by: c.get('user')!.id, was: was.admin_role, now: role || null } });
    return c.redirect('/admin/access');
  });

  // ---------- Dashboard ----------
  admin.get('/admin', async (c) => {
    const t = Date.now(), d1 = t - DAY, d7 = t - 7 * DAY;
    const PAID = `('confirmed','picked_up','returned','closed')`;
    const [users, users7, live, rs, money7, moneyAll, owed, texts, fails, errs, srch, evs, topQ] = await Promise.all([
      one<{ n: number }>(c, `SELECT COUNT(*) n FROM users WHERE demo = 0`),
      one<{ n: number }>(c, `SELECT COUNT(*) n FROM users WHERE demo = 0 AND created_at > ?`, d7),
      one<{ n: number; d: number }>(c, `SELECT SUM(demo = 0) n, SUM(demo = 1) d FROM listings WHERE status = 'live'`),
      all<{ status: string; n: number }>(c, `SELECT status, COUNT(*) n FROM rentals WHERE listing_id NOT IN (SELECT id FROM listings WHERE demo = 1) GROUP BY status`),
      one<{ gmv: number; fee: number; tax: number; n: number }>(c, `SELECT COALESCE(SUM(total_cents),0) gmv, COALESCE(SUM(fee_cents),0) fee, COALESCE(SUM(tax_cents),0) tax, COUNT(*) n FROM rentals WHERE listing_id NOT IN (SELECT id FROM listings WHERE demo = 1) AND status IN ${PAID} AND updated_at > ?`, d7),
      one<{ gmv: number; fee: number; tax: number; credit: number; n: number }>(c, `SELECT COALESCE(SUM(total_cents),0) gmv, COALESCE(SUM(fee_cents),0) fee, COALESCE(SUM(tax_cents),0) tax, COALESCE(SUM(credit_cents),0) credit, COUNT(*) n FROM rentals WHERE listing_id NOT IN (SELECT id FROM listings WHERE demo = 1) AND (status IN ${PAID} OR (status = 'canceled' AND late_cancel = 1))`),
      one<{ s: number; n: number }>(c, `SELECT COALESCE(SUM(COALESCE(payout_cents, rent_cents)),0) s, COUNT(*) n FROM rentals WHERE listing_id NOT IN (SELECT id FROM listings WHERE demo = 1) AND paid_out = 0 AND (status IN ('picked_up','returned','closed') OR (status = 'canceled' AND late_cancel = 1)) AND rent_cents > 0`),
      one<{ n: number }>(c, `SELECT COUNT(*) n FROM outbound_texts WHERE created_at > ?`, d1),
      one<{ n: number }>(c, `SELECT COUNT(*) n FROM events WHERE kind = 'text.failed' AND at > ?`, d1),
      one<{ n: number }>(c, `SELECT COUNT(*) n FROM events WHERE kind = 'error' AND at > ?`, d1),
      one<{ n: number; z: number }>(c, `SELECT COUNT(*) n, SUM(json_extract(data,'$.n') = 0) z FROM events WHERE kind = 'search' AND at > ?`, d7),
      all<EvRow>(c, `SELECT e.*, u.name uname FROM events e LEFT JOIN users u ON u.id = e.user_id WHERE e.kind NOT IN ('search','view','view.item') ORDER BY e.id DESC LIMIT 25`),
      all<{ q: string; n: number; zero: number }>(c, `SELECT lower(json_extract(data,'$.q')) q, COUNT(*) n, SUM(json_extract(data,'$.n') = 0) zero FROM events WHERE kind = 'search' AND at > ? GROUP BY 1 ORDER BY n DESC LIMIT 12`, t - 30 * DAY),
    ]);
    const st = Object.fromEntries(rs.map(r => [r.status, r.n]));
    const K = (h: string, v: string | number, l: string, warn = false) => <a href={h} class={warn ? 'warn' : ''}><b>{v}</b><span>{l}</span></a>;
    return c.html(<Shell c={c} title="Dashboard" path="/admin">
      <h3>People + items</h3>
      <div class="ad-k">
        {K('/admin/users', users?.n ?? 0, `users · +${users7?.n ?? 0} this week`)}
        {K('/admin/users?sort=items', live?.n ?? 0, 'live listings')}
        {K('/admin/review', (await one<{ n: number }>(c, `SELECT COUNT(*) n FROM listings WHERE status = 'review'`))?.n ?? 0, 'photos to check', !!(await one<{ n: number }>(c, `SELECT COUNT(*) n FROM listings WHERE status = 'review'`))?.n)}
        {K('/admin/searches', srch?.n ?? 0, `searches this week · ${srch?.z ?? 0} found nothing`)}
      </div>
      <h3>Rentals</h3>
      <div class="ad-k">
        {K('/admin/rentals?status=held', st.held ?? 0, 'waiting on owner YES', (st.held ?? 0) > 0)}
        {K('/admin/rentals?status=confirmed', st.confirmed ?? 0, 'confirmed, not picked up')}
        {K('/admin/rentals?status=picked_up', st.picked_up ?? 0, 'out now')}
        {K('/admin/rentals?status=returned', (st.returned ?? 0) + (st.closed ?? 0), 'returned / closed')}
        {K('/admin/rentals?status=inquiry', st.inquiry ?? 0, 'questions (no booking)')}
        {K('/admin/rentals?status=declined', (st.declined ?? 0) + (st.expired ?? 0) + (st.canceled ?? 0), 'declined / expired / canceled')}
      </div>
      <h3>Money</h3>
      <div class="ad-k">
        {K('/admin/log?kind=money.capture', money(money7?.gmv ?? 0), `customers paid · 7 days (${money7?.n ?? 0})`)}
        {K('/admin/log?kind=money.capture', money(moneyAll?.gmv ?? 0), `customers paid · all time (${moneyAll?.n ?? 0})`)}
        {K('/admin/rentals', money(moneyAll?.fee ?? 0), 'Lendo fees · all time')}
        {K('/admin/rentals', money(moneyAll?.tax ?? 0), 'sales tax collected (to remit)')}
        {K('/admin/rentals', money(moneyAll?.credit ?? 0), 'credits given (Lendo cost)')}
        {K('/admin/rentals?owed=1', money(owed?.s ?? 0), `owed to owners · not yet sent (${owed?.n ?? 0})`, (owed?.n ?? 0) > 0)}
      </div>
      <h3>Visits</h3>
      {await visits(c)}
      <h3>Health · last 24h</h3>
      <div class="ad-k">
        {K('/admin/texts', texts?.n ?? 0, 'texts sent')}
        {K('/admin/log?kind=text.failed', fails?.n ?? 0, 'texts failed', (fails?.n ?? 0) > 0)}
        {K('/admin/log?kind=error', errs?.n ?? 0, 'errors', (errs?.n ?? 0) > 0)}
      </div>
      <h3>Top searches · 30 days</h3>
      <div class="ad-wrap"><table class="ad-t"><tr><th>Query</th><th class="n">Times</th><th class="n">Found nothing</th></tr>{topQ.map(q => <tr><td><a href={'/admin/log?kind=search&q=' + encodeURIComponent(q.q)}>{q.q}</a></td><td class="n">{q.n}</td><td class="n">{q.zero || ''}</td></tr>)}</table></div>
      <h3>Latest activity · <a href="/admin/log">all</a></h3>
      <EvTable rows={evs} />
    </Shell>);
  });

  // ---------- Activity log: filter by kind (prefix ok: "money."), user, rental, listing, text; CSV ----------
  /* fake showcase data (users.demo / listings.demo) lives only under the Demo tab */
  const DEMO_EV = `(COALESCE(e.user_id, '') IN (SELECT id FROM users WHERE demo = 1) OR COALESCE(e.listing_id, '') IN (SELECT id FROM listings WHERE demo = 1) OR COALESCE(e.rental_id, '') IN (SELECT r.id FROM rentals r JOIN listings l ON l.id = r.listing_id WHERE l.demo = 1))`;
  const demoNav = (on: string) => <nav class="ad-sub"><b style="margin-right:6px">Fake showcase data:</b>{[['/admin/demo', 'Summary'], ['/admin/users?demo=1', 'Users'], ['/admin/rentals?demo=1', 'Rentals'], ['/admin/log?demo=1', 'Log'], ['/admin/texts?demo=1', 'Texts']].map(([h, t]) => <a href={h} class={on === h ? 'on' : ''}>{t}</a>)}</nav>;
  admin.get('/admin/demo', async (c) => {
    const n = await one<{ u: number; l: number; r: number; e: number }>(c, `SELECT (SELECT COUNT(*) FROM users WHERE demo = 1) u, (SELECT COUNT(*) FROM listings WHERE demo = 1) l, (SELECT COUNT(*) FROM rentals WHERE listing_id IN (SELECT id FROM listings WHERE demo = 1)) r, (SELECT COUNT(*) FROM events e WHERE ${DEMO_EV}) e`);
    return c.html(<Shell c={c} title="Demo" path="/admin/demo">
      {demoNav('/admin/demo')}
      <p class="hint">Fake users, items and rentals (the showcase city). Kept out of every other admin tab and the dashboard numbers</p>
      <div class="ad-wrap"><table class="ad-t"><tr><th>Fake users</th><th>Fake items</th><th>Fake rentals</th><th>Log rows</th></tr><tr><td class="n">{n?.u}</td><td class="n">{n?.l}</td><td class="n">{n?.r}</td><td class="n">{n?.e}</td></tr></table></div>
      <form method="post" action="/admin/demo/fixland" style="margin-top:12px"><button class="btn sm" type="submit">Move fake items off water/parks</button></form>
    </Shell>);
  });
  const logQuery = (q: Record<string, string>) => {
    const w: string[] = [], b: unknown[] = [];
    if (q.kind) { if (q.kind.endsWith('.')) { w.push('e.kind LIKE ?'); b.push(q.kind + '%'); } else { w.push('e.kind = ?'); b.push(q.kind); } }
    if (q.user) { w.push('e.user_id = ?'); b.push(q.user); }
    if (q.rental) { w.push('e.rental_id = ?'); b.push(q.rental); }
    if (q.listing) { w.push('e.listing_id = ?'); b.push(q.listing); }
    if (q.q) { w.push('(e.data LIKE ? OR e.kind LIKE ?)'); b.push('%' + q.q + '%', '%' + q.q + '%'); }
    if (q.days) { w.push('e.at > ?'); b.push(Date.now() - (parseInt(q.days, 10) || 7) * DAY); }
    w.push((q.demo ? '' : 'NOT ') + DEMO_EV);
    return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', b };
  };
  admin.get('/admin/log', async (c) => {
    const q = c.req.query(), { where, b } = logQuery(q), lim = Math.min(1000, parseInt(q.limit || '200', 10) || 200);
    const rows = await all<EvRow>(c, `SELECT e.*, u.name uname FROM events e LEFT JOIN users u ON u.id = e.user_id ${where} ORDER BY e.id DESC LIMIT ${lim}`, ...b);
    const kinds = await all<{ kind: string; n: number }>(c, `SELECT kind, COUNT(*) n FROM events GROUP BY kind ORDER BY kind`);
    const qs = new URLSearchParams(Object.entries(q).filter(([k, v]) => v && k !== 'limit') as [string, string][]).toString();
    return c.html(<Shell c={c} title="Activity log" path={q.demo ? '/admin/demo' : c.req.path + (q.kind === 'error' ? '?kind=error' : '')}>
      {q.demo ? demoNav('/admin/log?demo=1') : null}
      <form class="ad-f" method="get">{q.demo ? <input type="hidden" name="demo" value="1" /> : null}
        <select name="kind"><option value="">all kinds</option>{['rental.', 'money.', 'stripe.', 'text.', 'listing.', 'profile.', 'item.', 'alert.', 'view', 'login', 'admin.', 'ext.'].map(k => <option value={k} selected={q.kind === k}>{k}*</option>)}{kinds.map(k => <option value={k.kind} selected={q.kind === k.kind}>{k.kind} ({k.n})</option>)}</select>
        <input name="q" placeholder="text in details" value={q.q || ''} />
        <input name="user" placeholder="user id" value={q.user || ''} size={14} />
        <input name="rental" placeholder="rental id" value={q.rental || ''} size={14} />
        <select name="days"><option value="">any time</option>{['1', '7', '30', '90'].map(d => <option value={d} selected={q.days === d}>last {d}d</option>)}</select>
        <button class="btn pri sm" type="submit">Filter</button><a class="btn sm" href="/admin/log">Clear</a><a class="btn sm" href={'/admin/log.csv' + (qs ? '?' + qs : '')}>CSV</a>
      </form>
      {q.rental ? await rentalSummary(c, q.rental) : null}
      <p class="hint">{rows.length} shown{rows.length === lim ? ` (newest ${lim})` : ''}</p>
      <EvTable rows={rows} />
    </Shell>);
  });
  admin.get('/admin/log.csv', async (c) => {
    const { where, b } = logQuery(c.req.query());
    const rows = await all<EvRow>(c, `SELECT e.* FROM events e ${where} ORDER BY e.id DESC LIMIT 50000`, ...b);
    const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = ['time,kind,user_id,rental_id,listing_id,amount_cents,data', ...rows.map(r => [new Date(r.at).toISOString(), r.kind, r.user_id, r.rental_id, r.listing_id, r.amount_cents, r.data].map(cell).join(','))].join('\n');
    return c.body(csv, 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="lendo-log-${new Date().toISOString().slice(0, 10)}.csv"` });
  });

  // ---------- Rentals ----------
  admin.get('/admin/rentals', async (c) => {
    const q = c.req.query(), w: string[] = [q.demo ? 'l.demo = 1' : 'l.demo = 0'], b: unknown[] = [];
    if (q.status) { w.push('r.status = ?'); b.push(q.status); }
    if (q.owed) w.push(`r.paid_out = 0 AND r.rent_cents > 0 AND (r.status IN ('picked_up','returned','closed') OR (r.status = 'canceled' AND r.late_cancel = 1))`);
    const rows = await all<any>(c, `SELECT r.*, l.name item, o.name oname, n.name cname FROM rentals r JOIN listings l ON l.id = r.listing_id LEFT JOIN users o ON o.id = r.owner_id LEFT JOIN users n ON n.id = r.renter_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY r.updated_at DESC LIMIT 300`, ...b);
    const statuses = ['inquiry', 'requested', 'held', 'confirmed', 'picked_up', 'returned', 'closed', 'declined', 'expired', 'canceled'];
    return c.html(<Shell c={c} title="Rentals" path={q.demo ? '/admin/demo' : '/admin/rentals'}>
      {q.demo ? demoNav('/admin/rentals?demo=1') : null}
      <nav class="ad-sub"><a href="/admin/rentals" class={!q.status && !q.owed ? 'on' : ''}>all</a>{statuses.map(s => <a href={'/admin/rentals?status=' + s} class={q.status === s ? 'on' : ''}>{s}</a>)}<a href="/admin/rentals?owed=1" class={q.owed ? 'on' : ''}>owed to owner</a></nav>
      <div class="ad-wrap"><table class="ad-t"><tr><th>Updated</th><th>Status</th><th>Item</th><th>Owner → customer</th><th>Days</th><th class="n">Rent</th><th class="n">Credit</th><th class="n">Tax</th><th class="n">Paid</th><th class="n">Fee</th><th class="n">Owner gets</th><th>Sent</th></tr>
        {rows.map(r => <tr><td style="white-space:nowrap">{ago(r.updated_at)}</td><td class="ad-kind">{r.status}{r.late_cancel ? ' (late)' : ''}</td><td><a href={'/r/' + r.id}>{r.item}</a><br /><a href={'/admin/log?rental=' + r.id} class="hint">log</a></td><td>{r.oname || r.owner_id} → {r.cname || r.renter_id}</td><td style="white-space:nowrap">{r.start_day.slice(5)}→{r.end_day.slice(5)}</td>
          <td class="n">{money(r.rent_cents)}</td><td class="n">{r.credit_cents ? '−' + money(r.credit_cents) : ''}</td><td class="n">{r.tax_cents ? money(r.tax_cents) : ''}</td><td class="n">{money(r.total_cents)}</td><td class="n">{money(r.fee_cents)}</td><td class="n">{money(r.payout_cents ?? r.rent_cents)}</td><td>{r.paid_out ? '✓' : ''}</td></tr>)}
      </table></div>
    </Shell>);
  });

  // ---------- Users ----------
  admin.get('/admin/users', async (c) => {
    const sort = c.req.query('sort') === 'items' ? 'items DESC' : 'u.created_at DESC', demo = c.req.query('demo') ? 1 : 0;
    const rows = await all<any>(c, `SELECT u.id, u.name, u.phone, u.hood, u.handle, u.created_at, u.stripe_account_id, u.texts, u.replied, u.promo_cents,
      (SELECT COUNT(*) FROM listings l WHERE l.owner_id = u.id AND l.status = 'live') items,
      (SELECT COUNT(*) FROM rentals r WHERE r.renter_id = u.id AND r.status IN ('confirmed','picked_up','returned','closed')) rented,
      (SELECT COUNT(*) FROM rentals r WHERE r.owner_id = u.id AND r.status IN ('confirmed','picked_up','returned','closed')) lent,
      (SELECT MAX(at) FROM events e WHERE e.user_id = u.id AND e.kind = 'login') last_login
      FROM users u WHERE u.demo = ? ORDER BY ${sort} LIMIT 500`, demo);
    return c.html(<Shell c={c} title="Users" path={demo ? '/admin/demo' : '/admin/users'}>
      {demo ? demoNav('/admin/users?demo=1') : null}
      <nav class="ad-sub"><a href="/admin/users" class={sort.startsWith('u.') ? 'on' : ''}>newest</a><a href="/admin/users?sort=items" class={sort.startsWith('items') ? 'on' : ''}>most items</a></nav>
      <div class="ad-wrap"><table class="ad-t"><tr><th>Joined</th><th>Name</th><th>Phone</th><th>Hood</th><th class="n">Live items</th><th class="n">Rented</th><th class="n">Lent</th><th>Payout acct</th><th>Texts</th><th>Last login</th></tr>
        {rows.map(r => <tr><td style="white-space:nowrap">{ago(r.created_at)}</td><td><a href={r.handle ? '/' + r.handle : '/u/' + r.id}>{r.name || '—'}</a><br /><a class="hint" href={'/admin/log?user=' + r.id}>log</a>{c.get('user')?.admin_level === 'owner' ? <form method="post" action={'/admin/users/' + r.id + '/as'} style="display:inline"> · <button class="linkbtn hint" type="submit">log in as</button></form> : null}{!r.replied ? <form method="post" action={'/admin/users/' + r.id + '/keeplive'} style="display:inline"> · <button class="linkbtn hint" type="submit" title="Never texted back: keep their items live anyway">keep live</button></form> : null}</td><td style="white-space:nowrap">{r.phone}</td><td>{r.hood || ''}</td><td class="n">{r.items}</td><td class="n">{r.rented}</td><td class="n">{r.lent}</td><td>{r.stripe_account_id ? '✓' : ''}</td><td>{r.texts ? (r.replied ? 'on' : 'on · no reply yet') : 'STOP'}</td><td style="white-space:nowrap">{r.last_login ? ago(r.last_login) : ''}</td></tr>)}
      </table></div>
    </Shell>);
  });

  // ---------- Texts: in + out, one timeline ----------
  admin.get('/admin/texts', async (c) => {
    const uid = c.req.query('user') || null, demo = c.req.query('demo') ? 1 : 0;
    const rows = await all<any>(c, `SELECT * FROM (
        SELECT o.created_at at, 'out' dir, o.category || COALESCE(' · ' || (SELECT json_extract(e.data,'$.status') || COALESCE(' ' || json_extract(e.data,'$.err'), '') FROM events e WHERE e.kind = 'text.status' AND json_extract(e.data,'$.id') = o.provider_id ORDER BY e.id DESC LIMIT 1), CASE WHEN o.provider_id IS NULL THEN ' · not sent' ELSE '' END) cat, o.body, o.user_id, o.rental_id FROM outbound_texts o WHERE ?1 IS NULL OR o.user_id = ?1
        UNION ALL SELECT i.created_at, 'in', i.via, i.body, i.user_id, NULL FROM inbound_texts i WHERE ?1 IS NULL OR i.user_id = ?1
        UNION ALL SELECT e.at, 'in?', 'unknown number', json_extract(e.data,'$.from') || ': ' || json_extract(e.data,'$.body'), NULL, NULL FROM events e WHERE e.kind = 'text.in_unknown' AND ?1 IS NULL
        UNION ALL SELECT e.at, 'fail', json_extract(e.data,'$.category'), json_extract(e.data,'$.err') || ' — ' || json_extract(e.data,'$.body'), e.user_id, e.rental_id FROM events e WHERE e.kind IN ('text.failed','text.suppressed') AND (?1 IS NULL OR e.user_id = ?1)
      ) t WHERE (t.user_id IS NULL AND ?2 = 0) OR t.user_id IN (SELECT id FROM users WHERE demo = ?2) ORDER BY at DESC LIMIT 400`, uid, demo);
    const names = Object.fromEntries((await all<{ id: string; name: string | null; phone: string }>(c, `SELECT id, name, phone FROM users`)).map(u => [u.id, u.name || u.phone]));
    return c.html(<Shell c={c} title="Texts" path={demo ? '/admin/demo' : '/admin/texts'}>
      {demo ? demoNav('/admin/texts?demo=1') : null}
      {uid ? <p class="hint">Only {names[uid] || uid} · <a href="/admin/texts">everyone</a></p> : null}
      <div class="ad-wrap"><table class="ad-t"><tr><th>When</th><th></th><th>Who</th><th>Type</th><th>Text</th></tr>
        {rows.map(r => <tr><td style="white-space:nowrap">{when(r.at)}</td><td style={'font-weight:800;' + (r.dir === 'fail' ? 'color:#c22' : r.dir.startsWith('in') ? 'color:#FF4F00' : '')}>{r.dir === 'out' ? '→' : r.dir === 'fail' ? '✕' : '←'}</td><td>{r.user_id ? <a href={'/admin/texts?user=' + r.user_id}>{names[r.user_id] || r.user_id}</a> : '—'}{r.rental_id ? <><br /><a class="hint" href={'/admin/log?rental=' + r.rental_id}>{r.rental_id}</a></> : null}</td><td class="hint">{r.cat}</td><td style="max-width:520px;word-break:break-word">{r.body}</td></tr>)}
      </table></div>
    </Shell>);
  });

  // ---------- Searches: what people want ----------
  admin.get('/admin/searches', async (c) => {
    const days = parseInt(c.req.query('days') || '30', 10) || 30;
    const rows = await all<{ q: string; n: number; zero: number; people: number; last: number }>(c, `SELECT lower(json_extract(data,'$.q')) q, COUNT(*) n, SUM(json_extract(data,'$.n') = 0) zero, COUNT(DISTINCT COALESCE(user_id, json_extract(data,'$.lat') || json_extract(data,'$.lng'))) people, MAX(at) last FROM events WHERE kind = 'search' AND at > ? GROUP BY 1 ORDER BY zero DESC, n DESC LIMIT 300`, Date.now() - days * DAY);
    return c.html(<Shell c={c} title="Searches" path="/admin/searches">
      <nav class="ad-sub">{[7, 30, 90].map(d => <a href={'/admin/searches?days=' + d} class={d === days ? 'on' : ''}>{d} days</a>)}</nav>
      <p class="hint">Most-wanted first: searches that found nothing nearby are items to recruit</p>
      <div class="ad-wrap"><table class="ad-t"><tr><th>Query</th><th class="n">Found nothing</th><th class="n">Times</th><th class="n">People</th><th>Last</th></tr>{rows.map(r => <tr><td><a href={'/admin/log?kind=search&q=' + encodeURIComponent(r.q)}>{r.q}</a></td><td class="n">{r.zero || ''}</td><td class="n">{r.n}</td><td class="n">{r.people}</td><td>{ago(r.last)}</td></tr>)}</table></div>
    </Shell>);
  });
}

async function visits(c: any) {
  const t = Date.now(), d1 = t - DAY, d7 = t - 7 * DAY;
  const [a, top, refs] = await Promise.all([
    one<{ v1: number; u1: number; v7: number; u7: number; i7: number }>(c, `SELECT SUM(at > ?1) v1, COUNT(DISTINCT CASE WHEN at > ?1 THEN json_extract(data,'$.v') END) u1, COUNT(*) v7, COUNT(DISTINCT json_extract(data,'$.v')) u7, SUM(kind = 'view.item') i7 FROM events WHERE kind IN ('view','view.item') AND at > ?2`, d1, d7),
    all<{ listing_id: string; name: string; n: number; u: number; saves: number }>(c, `SELECT e.listing_id, l.name, COUNT(*) n, COUNT(DISTINCT json_extract(e.data,'$.v')) u, (SELECT COUNT(*) FROM events s WHERE s.kind = 'item.saved' AND s.listing_id = e.listing_id AND s.at > ?1) saves FROM events e JOIN listings l ON l.id = e.listing_id WHERE e.kind = 'view.item' AND e.at > ?1 GROUP BY e.listing_id ORDER BY u DESC LIMIT 10`, d7),
    all<{ ref: string; n: number }>(c, `SELECT COALESCE(json_extract(data,'$.utm'), json_extract(data,'$.ref')) ref, COUNT(DISTINCT json_extract(data,'$.v')) n FROM events WHERE kind IN ('view','view.item') AND at > ? AND COALESCE(json_extract(data,'$.utm'), json_extract(data,'$.ref')) IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 8`, d7),
  ]);
  return <>
    <div class="ad-k">
      <a href="/admin/log?kind=view&days=1"><b>{a?.u1 ?? 0}</b><span>visitors today · {a?.v1 ?? 0} pages</span></a>
      <a href="/admin/log?kind=view&days=7"><b>{a?.u7 ?? 0}</b><span>visitors this week · {a?.v7 ?? 0} pages</span></a>
      <a href="/admin/log?kind=view.item&days=7"><b>{a?.i7 ?? 0}</b><span>item page views this week</span></a>
    </div>
    <div class="ad-wrap" style="margin-top:8px"><table class="ad-t"><tr><th>Most-viewed items · 7 days</th><th class="n">Visitors</th><th class="n">Views</th><th class="n">Saves</th></tr>{top.map(r => <tr><td><a href={'/i/' + r.listing_id}>{r.name}</a> <a class="hint" href={'/admin/log?kind=view.item&listing=' + r.listing_id}>log</a></td><td class="n">{r.u}</td><td class="n">{r.n}</td><td class="n">{r.saves || ''}</td></tr>)}</table></div>
    {refs.length ? <div class="ad-wrap" style="margin-top:8px"><table class="ad-t"><tr><th>Came from · 7 days</th><th class="n">Visitors</th></tr>{refs.map(r => <tr><td>{r.ref}</td><td class="n">{r.n}</td></tr>)}</table></div> : null}
  </>;
}

async function rentalSummary(c: any, rid: string) {
  const r = await one<any>(c, `SELECT r.*, l.name item FROM rentals r JOIN listings l ON l.id = r.listing_id WHERE r.id = ?`, rid);
  if (!r) return null;
  return <p class="card" style="font-size:13px"><b><a href={'/r/' + r.id}>{r.item}</a></b> · {r.status} · {r.start_day}→{r.end_day} · rent {money(r.rent_cents)}{r.credit_cents ? ` · credit −${money(r.credit_cents)}` : ''}{r.tax_cents ? ` · tax ${money(r.tax_cents)}` : ''} · customer paid {money(r.total_cents)} · fee {money(r.fee_cents)} · owner gets {money(r.payout_cents ?? r.rent_cents)}{r.paid_out ? ' (sent)' : ''} · <a href={'/admin/texts?user=' + r.owner_id}>owner texts</a> · <a href={'/admin/texts?user=' + r.renter_id}>customer texts</a></p>;
}
