// Admin dashboard: KPIs, money, activity log, rentals, users, texts, searches, errors. Admin-only (guarded in admin.tsx).
import type { Hono } from 'hono';
import type { Env, Vars } from '../lib/env';
import { Layout } from '../pages/layout';
import { money } from '../lib/util';

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
const NAV: ([string, string, ('review' | 'error')?] | null)[] = [['/admin', 'Home'], ['/admin/log', 'Log'], ['/admin/rentals', 'Rentals'], ['/admin/users', 'Users'], ['/admin/texts', 'Texts'], ['/admin/searches', 'Searches'], ['/admin/log?kind=error', 'Errors', 'error'], null, ['/admin/review', 'Photos', 'review'], ['/admin/promo', 'Promo'], ['/admin/pricing', 'Pricing'], ['/admin/wanted', 'Wanted'], ['/admin/debug', 'System']];
export async function AdminNav({ c, path }: { c: any; path: string }) {
  const [rv, er] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) n FROM listings WHERE status = 'review'`).first().catch(() => null),
    c.env.DB.prepare(`SELECT COUNT(*) n FROM events WHERE kind = 'error' AND at > ?`).bind(Date.now() - DAY).first().catch(() => null),
  ]);
  const badge = { review: (rv as any)?.n || 0, error: (er as any)?.n || 0 };
  return <nav class="adn"><style dangerouslySetInnerHTML={{ __html: NAV_CSS }} /><div>{NAV.map(n => n ? <a href={n[0]} class={n[0] === path ? 'on' : ''}>{n[1]}{n[2] && badge[n[2]] ? <sup>{badge[n[2]]}</sup> : null}</a> : <i />)}</div><script dangerouslySetInnerHTML={{ __html: `(function(){var a=document.querySelector('.adn a.on');if(a)a.parentNode.scrollLeft=a.offsetLeft-60})()` }} /></nav>;
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
  // ---------- Dashboard ----------
  admin.get('/admin', async (c) => {
    const t = Date.now(), d1 = t - DAY, d7 = t - 7 * DAY;
    const PAID = `('confirmed','picked_up','returned','closed')`;
    const [users, users7, live, rs, money7, moneyAll, owed, texts, fails, errs, srch, evs, topQ] = await Promise.all([
      one<{ n: number }>(c, `SELECT COUNT(*) n FROM users`),
      one<{ n: number }>(c, `SELECT COUNT(*) n FROM users WHERE created_at > ?`, d7),
      one<{ n: number; d: number }>(c, `SELECT SUM(demo = 0) n, SUM(demo = 1) d FROM listings WHERE status = 'live'`),
      all<{ status: string; n: number }>(c, `SELECT status, COUNT(*) n FROM rentals GROUP BY status`),
      one<{ gmv: number; fee: number; tax: number; n: number }>(c, `SELECT COALESCE(SUM(total_cents),0) gmv, COALESCE(SUM(fee_cents),0) fee, COALESCE(SUM(tax_cents),0) tax, COUNT(*) n FROM rentals WHERE status IN ${PAID} AND updated_at > ?`, d7),
      one<{ gmv: number; fee: number; tax: number; credit: number; n: number }>(c, `SELECT COALESCE(SUM(total_cents),0) gmv, COALESCE(SUM(fee_cents),0) fee, COALESCE(SUM(tax_cents),0) tax, COALESCE(SUM(credit_cents),0) credit, COUNT(*) n FROM rentals WHERE status IN ${PAID} OR (status = 'canceled' AND late_cancel = 1)`),
      one<{ s: number; n: number }>(c, `SELECT COALESCE(SUM(COALESCE(payout_cents, rent_cents)),0) s, COUNT(*) n FROM rentals WHERE paid_out = 0 AND (status IN ('picked_up','returned','closed') OR (status = 'canceled' AND late_cancel = 1)) AND rent_cents > 0`),
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
        {K('/admin/users?sort=items', live?.n ?? 0, `live listings${live?.d ? ` · +${live.d} demo` : ''}`)}
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
  const logQuery = (q: Record<string, string>) => {
    const w: string[] = [], b: unknown[] = [];
    if (q.kind) { if (q.kind.endsWith('.')) { w.push('e.kind LIKE ?'); b.push(q.kind + '%'); } else { w.push('e.kind = ?'); b.push(q.kind); } }
    if (q.user) { w.push('e.user_id = ?'); b.push(q.user); }
    if (q.rental) { w.push('e.rental_id = ?'); b.push(q.rental); }
    if (q.listing) { w.push('e.listing_id = ?'); b.push(q.listing); }
    if (q.q) { w.push('(e.data LIKE ? OR e.kind LIKE ?)'); b.push('%' + q.q + '%', '%' + q.q + '%'); }
    if (q.days) { w.push('e.at > ?'); b.push(Date.now() - (parseInt(q.days, 10) || 7) * DAY); }
    return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', b };
  };
  admin.get('/admin/log', async (c) => {
    const q = c.req.query(), { where, b } = logQuery(q), lim = Math.min(1000, parseInt(q.limit || '200', 10) || 200);
    const rows = await all<EvRow>(c, `SELECT e.*, u.name uname FROM events e LEFT JOIN users u ON u.id = e.user_id ${where} ORDER BY e.id DESC LIMIT ${lim}`, ...b);
    const kinds = await all<{ kind: string; n: number }>(c, `SELECT kind, COUNT(*) n FROM events GROUP BY kind ORDER BY kind`);
    const qs = new URLSearchParams(Object.entries(q).filter(([k, v]) => v && k !== 'limit') as [string, string][]).toString();
    return c.html(<Shell c={c} title="Activity log" path={c.req.path + (q.kind === 'error' ? '?kind=error' : '')}>
      <form class="ad-f" method="get">
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
    const q = c.req.query(), w: string[] = [], b: unknown[] = [];
    if (q.status) { w.push('r.status = ?'); b.push(q.status); }
    if (q.owed) w.push(`r.paid_out = 0 AND r.rent_cents > 0 AND (r.status IN ('picked_up','returned','closed') OR (r.status = 'canceled' AND r.late_cancel = 1))`);
    const rows = await all<any>(c, `SELECT r.*, l.name item, o.name oname, n.name cname FROM rentals r JOIN listings l ON l.id = r.listing_id LEFT JOIN users o ON o.id = r.owner_id LEFT JOIN users n ON n.id = r.renter_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY r.updated_at DESC LIMIT 300`, ...b);
    const statuses = ['inquiry', 'requested', 'held', 'confirmed', 'picked_up', 'returned', 'closed', 'declined', 'expired', 'canceled'];
    return c.html(<Shell c={c} title="Rentals" path="/admin/rentals">
      <nav class="ad-sub"><a href="/admin/rentals" class={!q.status && !q.owed ? 'on' : ''}>all</a>{statuses.map(s => <a href={'/admin/rentals?status=' + s} class={q.status === s ? 'on' : ''}>{s}</a>)}<a href="/admin/rentals?owed=1" class={q.owed ? 'on' : ''}>owed to owner</a></nav>
      <div class="ad-wrap"><table class="ad-t"><tr><th>Updated</th><th>Status</th><th>Item</th><th>Owner → customer</th><th>Days</th><th class="n">Rent</th><th class="n">Credit</th><th class="n">Tax</th><th class="n">Paid</th><th class="n">Fee</th><th class="n">Owner gets</th><th>Sent</th></tr>
        {rows.map(r => <tr><td style="white-space:nowrap">{ago(r.updated_at)}</td><td class="ad-kind">{r.status}{r.late_cancel ? ' (late)' : ''}</td><td><a href={'/r/' + r.id}>{r.item}</a><br /><a href={'/admin/log?rental=' + r.id} class="hint">log</a></td><td>{r.oname || r.owner_id} → {r.cname || r.renter_id}</td><td style="white-space:nowrap">{r.start_day.slice(5)}→{r.end_day.slice(5)}</td>
          <td class="n">{money(r.rent_cents)}</td><td class="n">{r.credit_cents ? '−' + money(r.credit_cents) : ''}</td><td class="n">{r.tax_cents ? money(r.tax_cents) : ''}</td><td class="n">{money(r.total_cents)}</td><td class="n">{money(r.fee_cents)}</td><td class="n">{money(r.payout_cents ?? r.rent_cents)}</td><td>{r.paid_out ? '✓' : ''}</td></tr>)}
      </table></div>
    </Shell>);
  });

  // ---------- Users ----------
  admin.get('/admin/users', async (c) => {
    const sort = c.req.query('sort') === 'items' ? 'items DESC' : 'u.created_at DESC';
    const rows = await all<any>(c, `SELECT u.id, u.name, u.phone, u.hood, u.handle, u.created_at, u.stripe_account_id, u.texts, u.replied, u.promo_cents,
      (SELECT COUNT(*) FROM listings l WHERE l.owner_id = u.id AND l.status = 'live') items,
      (SELECT COUNT(*) FROM rentals r WHERE r.renter_id = u.id AND r.status IN ('confirmed','picked_up','returned','closed')) rented,
      (SELECT COUNT(*) FROM rentals r WHERE r.owner_id = u.id AND r.status IN ('confirmed','picked_up','returned','closed')) lent,
      (SELECT MAX(at) FROM events e WHERE e.user_id = u.id AND e.kind = 'login') last_login
      FROM users u ORDER BY ${sort} LIMIT 500`);
    return c.html(<Shell c={c} title="Users" path="/admin/users">
      <nav class="ad-sub"><a href="/admin/users" class={sort.startsWith('u.') ? 'on' : ''}>newest</a><a href="/admin/users?sort=items" class={sort.startsWith('items') ? 'on' : ''}>most items</a></nav>
      <div class="ad-wrap"><table class="ad-t"><tr><th>Joined</th><th>Name</th><th>Phone</th><th>Hood</th><th class="n">Live items</th><th class="n">Rented</th><th class="n">Lent</th><th>Payout acct</th><th>Texts</th><th>Last login</th></tr>
        {rows.map(r => <tr><td style="white-space:nowrap">{ago(r.created_at)}</td><td><a href={r.handle ? '/' + r.handle : '/u/' + r.id}>{r.name || '—'}</a><br /><a class="hint" href={'/admin/log?user=' + r.id}>log</a></td><td style="white-space:nowrap">{r.phone}</td><td>{r.hood || ''}</td><td class="n">{r.items}</td><td class="n">{r.rented}</td><td class="n">{r.lent}</td><td>{r.stripe_account_id ? '✓' : ''}</td><td>{r.texts ? (r.replied ? 'on' : 'on · no reply yet') : 'STOP'}</td><td style="white-space:nowrap">{r.last_login ? ago(r.last_login) : ''}</td></tr>)}
      </table></div>
    </Shell>);
  });

  // ---------- Texts: in + out, one timeline ----------
  admin.get('/admin/texts', async (c) => {
    const uid = c.req.query('user') || null;
    const rows = await all<any>(c, `SELECT * FROM (
        SELECT o.created_at at, 'out' dir, o.category cat, o.body, o.user_id, o.rental_id FROM outbound_texts o WHERE ?1 IS NULL OR o.user_id = ?1
        UNION ALL SELECT i.created_at, 'in', i.via, i.body, i.user_id, NULL FROM inbound_texts i WHERE ?1 IS NULL OR i.user_id = ?1
        UNION ALL SELECT e.at, 'in?', 'unknown number', json_extract(e.data,'$.from') || ': ' || json_extract(e.data,'$.body'), NULL, NULL FROM events e WHERE e.kind = 'text.in_unknown' AND ?1 IS NULL
        UNION ALL SELECT e.at, 'fail', json_extract(e.data,'$.category'), json_extract(e.data,'$.err') || ' — ' || json_extract(e.data,'$.body'), e.user_id, e.rental_id FROM events e WHERE e.kind IN ('text.failed','text.suppressed') AND (?1 IS NULL OR e.user_id = ?1)
      ) t ORDER BY at DESC LIMIT 400`, uid);
    const names = Object.fromEntries((await all<{ id: string; name: string | null; phone: string }>(c, `SELECT id, name, phone FROM users`)).map(u => [u.id, u.name || u.phone]));
    return c.html(<Shell c={c} title="Texts" path="/admin/texts">
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
