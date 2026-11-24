// Claim page: /r/:id/claim. Owner reports a problem; both sides add statements and photos; the AI decides; one second look.
// State machine and money live in src/lib/claims.ts.
import { Hono } from 'hono';
import type { Claim, ClaimEntry, Env, Rental, User, Vars } from '../lib/env';
import { Layout } from '../pages/layout';
import { requireUser } from '../lib/auth';
import { listingById, rentalById, userById } from '../lib/db';
import { askReview, canOpen, claimById, claimFor, entriesFor, judge, KINDS, okRuling, openClaim, passReview, review, say, turn, withdraw } from '../lib/claims';
import { jsonIn } from '../lib/value';
import { firstName, id, money, tzFor } from '../lib/util';

export const claims = new Hono<{ Bindings: Env; Variables: Vars }>();

const STEP: Record<string, string> = { claim: 'Problem reported', response: 'Response', rebuttal: 'Reply', reply: 'Last word', review: 'Second look', ruling: 'Decision', final: 'Final decision' };

/* up to 4 photos from a form → R2 (rentals/<rentalId>/claim-…) */
async function savePhotos(c: any, r: Rental, f: Record<string, unknown>): Promise<string[]> {
  const files = ([] as unknown[]).concat(f.photos || []).filter((x): x is File => x instanceof File && x.size > 0 && x.size < 8_000_000 && /^image\//.test(x.type || 'image/jpeg')).slice(0, 4);
  const keys: string[] = [];
  for (const p of files) { const key = `rentals/${r.id}/claim-${id()}.jpg`; await c.env.PHOTOS.put(key, await p.arrayBuffer(), { httpMetadata: { contentType: p.type || 'image/jpeg' } }); keys.push(key); }
  return keys;
}
async function load(c: any): Promise<{ u: User; r: Rental; cl: Claim | null; role: 'owner' | 'customer' | 'admin' } | null> {
  const u = c.get('user')! as User; const r = await rentalById(c.env.DB, c.req.param('id'));
  if (!r) return null;
  const role = r.owner_id === u.id ? 'owner' : r.renter_id === u.id ? 'customer' : u.admin ? 'admin' : null;
  if (!role) return null;
  return { u, r, cl: await claimFor(c.env, r.id), role };
}
const text = (f: Record<string, unknown>) => String(f.body || '').trim().slice(0, 2000);

function Say(p: { action: string; label: string; go: string; hint?: string; required?: boolean }) {
  return <form method="post" action={p.action} enctype="multipart/form-data" class="card" style="border:2px solid var(--ink)">
    <label class="field" style="margin-top:0"><span>{p.label}</span><textarea name="body" maxlength={2000} required={p.required !== false} placeholder="What happened, in plain words"></textarea></label>
    <label class="field"><span>Photos (up to 4)</span><input type="file" name="photos" accept="image/*" multiple style="height:auto;padding:10px 12px" /></label>
    <button class="btn pri full" type="submit">{p.go}</button>
    {p.hint ? <div class="hint" style="margin-top:8px">{p.hint}</div> : null}
  </form>;
}

claims.get('/r/:id/claim', requireUser, async (c) => {
  const x = await load(c); if (!x) return c.notFound();
  const { u, r, cl, role } = x;
  const it = (await listingById(c.env.DB, r.listing_id))!;
  const owner = (await userById(c.env.DB, r.owner_id))!, customer = (await userById(c.env.DB, r.renter_id))!;
  const o = firstName(owner.name), cu = firstName(customer.name), dep = money(r.deposit_cents || 0), base = '/r/' + r.id + '/claim';
  const when = (ms: number) => new Date(ms).toLocaleString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tzFor(it.lng) });
  const Head = <div class="card"><b>{it.name}</b><div class="hint">{o} (owner) · {cu} (customer) · {dep} hold</div></div>;

  if (!cl) {
    const can = role === 'owner' ? canOpen(r, it) : null;
    if (!can) return c.redirect('/r/' + r.id);
    return c.html(<Layout title="Report a problem" user={u} back={'/r/' + r.id}>
      <div style="padding:4px 12px 40px;display:flex;flex-direction:column;gap:10px">
        {Head}
        <form method="post" action={base} enctype="multipart/form-data" class="card" style="border:2px solid var(--ink)">
          <div class="field" style="margin-top:0"><span>Problem</span>
            <div style="display:flex;flex-direction:column;gap:8px">{(Object.keys(KINDS) as Claim['kind'][]).filter(k => can === 'not_returned' ? k === 'not_returned' : k !== 'not_returned').map((k, i) => <label style="display:flex;gap:8px;align-items:center;font-weight:800"><input type="radio" name="kind" value={k} required checked={i === 0} />{KINDS[k]}</label>)}</div>
          </div>
          <label class="field"><span>What happened</span><textarea name="body" maxlength={2000} required placeholder="What’s wrong, and what it costs to fix or replace if you know"></textarea></label>
          <label class="field"><span>Photos (up to 4)</span><input type="file" name="photos" accept="image/*" multiple style="height:auto;padding:10px 12px" /></label>
          <button class="btn pri full" type="submit">Report it</button>
          <div class="hint" style="margin-top:8px">{cu} gets 24h to answer, then you each get one reply · Lendo’s AI decides from the photos and what you each say, up to the {dep} hold · its decision is final for you both</div>
        </form>
      </div>
    </Layout>);
  }

  const es = await entriesFor(c.env, cl.id);
  const t = turn(cl), mine = role !== 'admin' && t?.who === role;
  const rul = cl.ruling ? jsonIn(cl.ruling) : null, fin = cl.final ? jsonIn(cl.final) : null;
  const asked = es.filter(e => e.step === 'review'), iAsked = asked.some(e => e.who === role), otherAsked = asked.some(e => e.who !== role);
  const iOk = role === 'owner' ? cl.owner_ok : role === 'customer' ? cl.customer_ok : 0;
  const amt = (n: number | null) => (n || 0) > 0 ? `${cu} owes ${money(n!)}` : 'No charge';
  const name = (e: ClaimEntry) => e.who === 'ai' ? 'Lendo AI' : e.who === 'owner' ? o : cu;
  const status = cl.status === 'withdrawn' ? 'Withdrawn' : cl.status === 'final' ? `Final · ${amt(cl.final_cents)}` : cl.status === 'ruled' ? `Decision · ${amt(cl.award_cents)}` : cl.status === 'judging' || cl.status === 'reviewing' ? 'Being decided · a few minutes' : `${t!.who === 'owner' ? o : cu}’s turn · by ${when(cl.step_due || Date.now())}`;

  return c.html(<Layout title="Problem with a rental" user={u} back={'/r/' + r.id}>
    <div style="padding:4px 12px 60px;display:flex;flex-direction:column;gap:10px">
      {Head}
      <div class="card"><b>{KINDS[cl.kind]}</b><div class="hint">{status}</div></div>

      {es.map(e => { const ph: string[] = e.photos ? JSON.parse(e.photos) : [];
        return <div class="card" style={e.who === 'ai' ? 'border:2px solid var(--ink)' : ''}>
          <div class="hint">{name(e)} · {STEP[e.step] || e.step} · {when(e.at)}</div>
          <div style="margin-top:4px;white-space:pre-wrap;font-size:14.5px">{e.body}</div>
          {ph.length ? <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">{ph.map(k => <a href={'/p/' + k} target="_blank"><img src={'/p/' + k} alt="" style="width:84px;height:84px;object-fit:cover;border-radius:10px;border:1.5px solid var(--line)" /></a>)}</div> : null}
        </div>; })}

      {/* statements: whose turn */}
      {t && mine ? <>
        <Say action={base + '/say'} label={t.step === 'response' ? `Your side` : t.step === 'rebuttal' ? `Your reply to ${cu}` : `Your last word`} go="Send" hint={`By ${when(cl.step_due || Date.now())} · after that it moves on without it`} />
        <form method="post" action={base + '/skip'} onsubmit="return confirm('Send nothing and move on?')"><button class="btn full" type="submit">Nothing to add</button></form>
      </> : t && role !== 'admin' ? <div class="hint" style="text-align:center">Waiting for {t.who === 'owner' ? o : cu} · until {when(cl.step_due || Date.now())}</div> : null}
      {t && role === 'owner' ? <form method="post" action={base + '/withdraw'} onsubmit="return confirm('Withdraw the claim? It can’t be reopened')" style="text-align:center"><button type="submit" style="background:none;border:0;color:var(--mute);text-decoration:underline;font:inherit;font-size:13px">Withdraw claim</button></form> : null}

      {/* ruling: OK it, or one second look */}
      {cl.status === 'ruled' && rul?.decisive?.length ? <div class="card"><div class="hint">What decided it</div><ul style="margin:4px 0 0;padding-left:18px;font-size:14px">{(rul.decisive as string[]).map(d => <li>{d}</li>)}</ul></div> : null}
      {cl.status === 'ruled' && role !== 'admin' ? <>
        {!asked.length ? (iOk ? <div class="hint" style="text-align:center">You OK’d it · final {when(cl.review_due || Date.now())}, sooner if {role === 'owner' ? cu : o} OKs it too</div>
          : <form method="post" action={base + '/ok'}><button class="btn pri full" type="submit">OK · {amt(cl.award_cents)}</button></form>) : null}
        {!iAsked && !otherAsked ? <details class="disc"><summary>Ask for a second look</summary>
          <div style="margin-top:8px"><Say action={base + '/review'} label="Why the decision is wrong" go="Ask for a second look" hint={`One second look per claim · a separate AI pass decides again from everything, and that one is final · it can go up or down`} /></div>
        </details> : null}
        {otherAsked && !iAsked ? <>
          <Say action={base + '/review'} label={`${role === 'owner' ? cu : o} asked for a second look · your side`} go="Send" hint={`By ${when(cl.review_due || Date.now())} · then it’s decided for good`} />
          <form method="post" action={base + '/pass'}><button class="btn full" type="submit">Nothing to add · decide now</button></form>
        </> : null}
        {iAsked && !otherAsked ? <div class="hint" style="text-align:center">Second look asked · {role === 'owner' ? cu : o} can add their side until {when(cl.review_due || Date.now())}</div> : null}
        {!asked.length ? <div class="hint" style="text-align:center">Final {when(cl.review_due || Date.now())} if no one asks for a second look</div> : null}
      </> : null}

      {cl.status === 'final' ? <div class="card" style="border:2px solid var(--ink)">
        <b>Final · {amt(cl.final_cents)}</b>
        <div class="hint" style="margin-top:4px">{(cl.final_cents || 0) < 50 ? `${dep} hold released`
          : cl.collected_cents >= (cl.final_cents || 0) ? (cl.collect_how === 'hold' ? `Charged from the ${dep} hold${(cl.final_cents || 0) < cl.deposit_cents ? ' · the rest released' : ''}` : 'Charged to the card')
          : cl.settled_at ? 'The card didn’t take the charge · Lendo is on it' : 'Settling'}
          {role === 'owner' && cl.owner_due_cents > 0 ? ` · ${money(cl.owner_due_cents)} ${cl.paid_out ? 'sent to your account' : 'waiting for your payout details'}` : ''}</div>
        {role === 'owner' && cl.owner_due_cents > 0 && !cl.paid_out ? <a class="btn pri full" href="/payout" style="display:grid;place-items:center;text-decoration:none;margin-top:8px">Add payout details</a> : null}
      </div> : null}

      {role === 'admin' ? <div class="card"><div class="hint">Admin</div><pre style="white-space:pre-wrap;word-break:break-word;font-size:11px;margin:4px 0 0">{JSON.stringify({ id: cl.id, status: cl.status, deposit: cl.deposit_cents, award: cl.award_cents, final: cl.final_cents, collected: cl.collected_cents, how: cl.collect_how, owner_due: cl.owner_due_cents, paid_out: cl.paid_out, lendo_loss: cl.lendo_loss_cents, owner_excess: cl.owner_excess_cents, bank_file: (fin || rul)?.bank_file, chargeback: cl.cb_id ? { id: cl.cb_id, status: cl.cb_status, cents: cl.cb_cents, evidence_at: cl.cb_evidence_at } : null, tries: cl.tries }, null, 1)}</pre></div> : null}
    </div>
    {cl.status === 'judging' || cl.status === 'reviewing' ? <script dangerouslySetInnerHTML={{ __html: 'setTimeout(function(){location.reload()},8000)' }} /> : null}
  </Layout>);
});

// owner opens the claim
claims.post('/r/:id/claim', requireUser, async (c) => {
  const x = await load(c); if (!x || x.role !== 'owner') return c.notFound();
  const f = await c.req.parseBody({ all: true }) as Record<string, unknown>;
  const kind = String(f.kind || '') as Claim['kind'], body = text(f);
  if (x.cl || !body || !(kind in KINDS)) return c.redirect('/r/' + x.r.id + '/claim');
  await openClaim(c.env, x.r, kind, body, await savePhotos(c, x.r, f));
  return c.redirect('/r/' + x.r.id + '/claim');
});
// a side's statement for the current step (or nothing to add)
claims.post('/r/:id/claim/:act{say|skip}', requireUser, async (c) => {
  const x = await load(c); if (!x || !x.cl || x.role === 'admin') return c.notFound();
  const back = '/r/' + x.r.id + '/claim';
  let body: string | null = null, photos: string[] = [];
  if (c.req.param('act') === 'say') { const f = await c.req.parseBody({ all: true }) as Record<string, unknown>; body = text(f); if (!body) return c.redirect(back); if (turn(x.cl)?.who === x.role) photos = await savePhotos(c, x.r, f); }
  const next = await say(c.env, x.cl, x.role, body, photos);
  if (next === 'judging') { const cid = x.cl.id; c.executionCtx.waitUntil((async () => { const cl = await claimById(c.env, cid); if (cl) await judge(c.env, cl); })()); }
  return c.redirect(back);
});
claims.post('/r/:id/claim/withdraw', requireUser, async (c) => {
  const x = await load(c); if (!x || !x.cl || x.role !== 'owner') return c.notFound();
  await withdraw(c.env, x.cl);
  return c.redirect('/r/' + x.r.id);
});
claims.post('/r/:id/claim/ok', requireUser, async (c) => {
  const x = await load(c); if (!x || !x.cl || x.role === 'admin') return c.notFound();
  await okRuling(c.env, x.cl, x.role);
  return c.redirect('/r/' + x.r.id + '/claim');
});
// ask for the one second look, or (other side) add to it / pass
claims.post('/r/:id/claim/:act{review|pass}', requireUser, async (c) => {
  const x = await load(c); if (!x || !x.cl || x.role === 'admin') return c.notFound();
  const back = '/r/' + x.r.id + '/claim', cid = x.cl.id;
  let go = false;
  if (c.req.param('act') === 'pass') go = await passReview(c.env, x.cl, x.role);
  else { const f = await c.req.parseBody({ all: true }) as Record<string, unknown>; const body = text(f); if (!body || x.cl.status !== 'ruled') return c.redirect(back); go = (await askReview(c.env, x.cl, x.role, body, await savePhotos(c, x.r, f))) === 'reviewing'; }
  if (go) c.executionCtx.waitUntil((async () => { const cl = await claimById(c.env, cid); if (cl) await review(c.env, cl); })());
  return c.redirect(back);
});
