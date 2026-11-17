// Flags: people report an item, a profile, a rental (after return) or one message. Each reason maps to a category;
// categories route to admins (and/or "agent" = Claude, which only writes a suggestion). Safety + money text the
// assignees right away; the rest wait in /admin/flags.
import type { Env, User } from './env';
import { logEvent, logErr } from './log';
import { textUser } from './blooio';
import { id, now } from './util';

export type FlagKind = 'item' | 'user' | 'rental' | 'message';
export const REASONS: Record<FlagKind, [string, string, string][]> = { /* [value, label, category] */
  item: [['wrong', 'Wrong photo or info', 'listing'], ['notallowed', 'Not allowed on Lendo', 'notallowed'], ['scam', 'Looks like a scam', 'scam'], ['unsafe', 'Unsafe item', 'safety'], ['other', 'Something else', 'other']],
  user: [['fake', 'Fake profile', 'scam'], ['rude', 'Rude or threatening', 'safety'], ['noshow', 'Didn’t show up', 'noshow'], ['scam', 'Scam or asked to pay off Lendo', 'scam'], ['other', 'Something else', 'other']],
  rental: [['damaged', 'Came back damaged', 'money'], ['missing', 'Missing parts', 'money'], ['late', 'Returned late', 'noshow'], ['notback', 'Not returned', 'money'], ['other', 'Something else', 'other']],
  message: [['offapp', 'Asked to pay off Lendo', 'scam'], ['rude', 'Rude or threatening', 'safety'], ['spam', 'Spam', 'scam'], ['other', 'Something else', 'other']],
};
export const CATEGORIES: [string, string][] = [['safety', 'Safety'], ['money', 'Money (damage, not returned)'], ['scam', 'Scam / fake / off-app pay'], ['listing', 'Listing quality'], ['notallowed', 'Not allowed'], ['noshow', 'No-show / late'], ['other', 'Other']];
const URGENT = new Set(['safety', 'money']);

/* message text worth a flag button: off-app payment, contact swaps, threats/abuse */
export const FLAGGABLE = /\b(venmo|zelle|cash\s?app|paypal|wire|western union|gift ?card|crypto|bitcoin|pay (me )?(in )?cash|outside (of )?lendo|off (of )?lendo|text me at|call me at|whatsapp|telegram|kill|hurt|stupid|idiot|f+u+c+k|shit|bitch|asshole)\b|\d{3}[\s.-]?\d{3}[\s.-]?\d{4}|[\w.+-]+@[\w-]+\.\w+/i;

// routing: settings.flag_routes = { category: ['owner' | userId | 'agent', ...] }; default: everything to the owner admin(s)
export async function routes(env: Env): Promise<Record<string, string[]>> {
  const r = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'flag_routes'`).first<{ value: string }>().catch(() => null);
  try { return r ? JSON.parse(r.value) : {}; } catch { return {}; }
}
export const routeFor = (rt: Record<string, string[]>, cat: string) => (rt[cat]?.length ? rt[cat] : ['owner']);

async function assigneeUsers(env: Env, who: string[]): Promise<User[]> {
  const out: User[] = [];
  const phones = (env.ADMIN_PHONES || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const w of who) {
    if (w === 'agent') continue;
    if (w === 'owner') { for (const p of phones) { const u = await env.DB.prepare('SELECT * FROM users WHERE phone = ?').bind(p).first<User>(); if (u) out.push(u); } }
    else { const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(w).first<User>(); if (u) out.push(u); }
  }
  return out.filter((u, i) => out.findIndex(x => x.id === u.id) === i);
}

export async function createFlag(env: Env, reporter: User, kind: FlagKind, target: string, reason: string, note: string, rentalId: string | null, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<string | null> {
  const r = REASONS[kind]?.find(x => x[0] === reason); if (!r) return null;
  const cat = r[2], fid = id('f'), t = Date.now(), who = routeFor(await routes(env), cat);
  await env.DB.prepare(`INSERT INTO flags (id, kind, target_id, rental_id, reason, category, note, reporter_id, status, assignee, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,'new',?,?,?)`)
    .bind(fid, kind, target, rentalId, reason, cat, note || null, reporter.id, who.join(','), t, t).run();
  await logEvent(env.DB, 'flag.new', { user: reporter.id, rental: rentalId, listing: kind === 'item' ? target : null, data: { id: fid, kind, target, reason, category: cat } });
  ctx.waitUntil((async () => {
    try {
      if (URGENT.has(cat)) for (const a of await assigneeUsers(env, who)) await textUser(env, a, `Lendo flag (${cat}): ${r[1]}${note ? ` — "${note.slice(0, 120)}"` : ''} ${env.APP_URL}/admin/flags. Reply OK to confirm`, 'login');
      if (who.includes('agent')) await agentNote(env, fid, kind, target, r[1], note);
    } catch (e) { await logErr(env.DB, 'flag notify', e, { data: { id: fid } }); }
  })());
  return fid;
}

/* agent = Claude reads what was flagged and suggests a next step; it never acts */
async function agentNote(env: Env, fid: string, kind: FlagKind, target: string, reason: string, note: string) {
  if (!env.ANTHROPIC_API_KEY) return;
  let what = '';
  if (kind === 'item') { const l = await env.DB.prepare('SELECT name, description, price_cents FROM listings WHERE id = ?').bind(target).first<any>(); what = l ? `Listing "${l.name}" ($${l.price_cents / 100}/day): ${l.description || ''}` : ''; }
  if (kind === 'message') { const m = await env.DB.prepare('SELECT body FROM messages WHERE id = ?').bind(target).first<any>(); what = m ? `Message: "${m.body}"` : ''; }
  if (kind === 'user') { const u = await env.DB.prepare('SELECT name, created_at FROM users WHERE id = ?').bind(target).first<any>(); what = u ? `Profile of ${u.name || 'unnamed'}` : ''; }
  if (kind === 'rental') what = `Rental ${target}, flagged after return`;
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 160, system: 'You triage reports on Lendo, a neighbor-to-neighbor rental site. In 1-2 short lines: how serious (low/medium/high) and the next step for a human admin. Never decide; suggest.', messages: [{ role: 'user', content: `Reason: ${reason}\nReporter note: ${note || '(none)'}\n${what}` }] }) });
  if (!r.ok) return;
  const j: any = await r.json(); const txt = String(j.content?.[0]?.text || '').slice(0, 500);
  if (txt) await env.DB.prepare('UPDATE flags SET agent_note = ? WHERE id = ?').bind(txt, fid).run();
}

const FLAG_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* one control everywhere: a small flag that opens reasons inline; guests go to login */
export function Flag(p: { kind: FlagKind; target: string; back: string; user: User | null; label?: string; rental?: string; cls?: string }) {
  if (!p.user) return <a class={'flagd ' + (p.cls || '')} href={'/login?next=' + encodeURIComponent(p.back)} aria-label="Flag"><span class="flagbtn" dangerouslySetInnerHTML={{ __html: FLAG_SVG + (p.label ? '<span>' + p.label + '</span>' : '') }} /></a>;
  return <details class={'flagd ' + (p.cls || '')}>
    <summary class="flagbtn" aria-label={p.label || 'Flag'} dangerouslySetInnerHTML={{ __html: FLAG_SVG + (p.label ? '<span>' + p.label + '</span>' : '') }} />
    <form class="flagf" method="post" action="/flag">
      <input type="hidden" name="kind" value={p.kind} /><input type="hidden" name="id" value={p.target} /><input type="hidden" name="back" value={p.back} />
      {p.rental ? <input type="hidden" name="rental" value={p.rental} /> : null}
      <b>{p.kind === 'rental' ? 'What happened?' : 'Flag this ' + (p.kind === 'user' ? 'person' : p.kind)}</b>
      {REASONS[p.kind].map(([v, l], i) => <label class="flago"><input type="radio" name="reason" value={v} required checked={i === 0} />{l}</label>)}
      <textarea name="note" maxlength={500} rows={2} placeholder="Add a note (optional)" />
      <button class="btn pri sm" type="submit">Send</button>
      <span class="hint" style="font-size:11.5px">A person at Lendo reads every one</span>
    </form>
  </details>;
}
