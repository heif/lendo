import { ensureShort } from '../lib/shortname';
import { minPriceCents } from '../lib/identify';
import { getCookie } from 'hono/cookie';
import { bonusOpen, nycLeft, NYC_CAP } from '../lib/db';
import { hereOf } from '../lib/places';
import { appealValue, ensureValue, HIGH_CENTS, photosOk } from '../lib/value';
import { Hono } from 'hono';
import { cutoutUrl } from '../lib/cutout';
import { smsHref } from '../lib/blooio';
import { logErr, logEvent } from '../lib/log';
import { setUserWhere, tidyCross } from '../lib/where';
import { localToday } from '../lib/util';
import { checkListingPhoto } from '../lib/photo-check';
import { Grade, GRADES, GRADE_WORD, isGrade, shownGrade } from '../lib/grade';
import { assignHandle, assignSlug, itemLink } from '../lib/urls';
import { recordCorrection } from '../lib/identify';
import { makeCutout } from '../lib/avatar';
import { raw } from 'hono/html';
import type { Env, Listing, Vars } from '../lib/env';
import { Layout } from '../pages/layout';
import { requireUser } from '../lib/auth';
import { avatarUrl } from '../lib/cutout';
import { firstPhotos, listingById, photosFor, busyDays } from '../lib/db';
import { id, money, now, fuzz, weekDefault, dayStr, addDays, fmtDay } from '../lib/util';
import { hoodFor, geocodePlace } from '../lib/geo';
import { emojiFor } from '../lib/emoji';
import { buildAvatars, autoIcon } from '../lib/avatar';
import { createListing } from '../lib/create-listing';
import { assignHood } from '../lib/hoods';

export const listings = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- List fast ----------
const listPage = async (c: any) => {
  const u = c.get('user'); /* guests can snap + answer; phone/code come after the item questions */
  const cfg = JSON.stringify({ stock: !!c.env.BRAVE_API_KEY, minPrice: (await minPriceCents(c.env)) / 100, hood: u?.hood || '', user: u ? { name: u.name || '', hood: u.hood || '', email: u.email || '', replied: !!u.replied } : null, home: u && u.lat != null && u.lng != null ? { lat: u.lat, lng: u.lng, label: [u.cross_streets, u.hood].filter(Boolean).join(' · ') } : null, hasLoc: !!(u && (u.lat != null || u.address || u.cross_streets)), sms: smsHref(c.env, 'OK'), shareUrl: u ? c.env.APP_URL + ((u as any).handle ? '/' + (u as any).handle : '/u/' + u.id) : c.env.APP_URL });
  return c.html(
    <Layout title="Rent out your stuff" user={u} promo={false} htmlClass="mappage" head={<link rel="stylesheet" href="/list.css" />}>
      {await bonusOpen(c.env.DB, u, hereOf(c, u)) ? await (async () => { const left = await nycLeft(c.env.DB), f = left / NYC_CAP, C = 2 * Math.PI * 9;
        return <details class="lbonus"><summary><span class="lb-t">$10 FOR 10 ITEMS<small>first 10K items NYC</small></span>
          <span class="lb-ring" title={`${left.toLocaleString('en-US')} of 10,000 left`}><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="3.5" /><circle cx="12" cy="12" r="9" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-dasharray={`${(C * f).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 12 12)" /></svg><b>{left >= 1000 ? (Math.floor(left / 100) / 10).toFixed(1).replace(/\.0$/, '') + 'K' : left}</b><small>left</small></span><i aria-label="How it works">i</i></summary>
          <ol><li>List 10 things you own</li><li>Quick 2-min video check</li><li>$10 to you — plus a $10 rental gift card</li></ol></details>; })() : null}
      {/* ideas */}
      <section id="st-ideas" class="lf">
        <div class="lf-scroll">
          <div class="lf-h" style="display:flex;align-items:center">What could you rent out?<button type="button" class="aiico" id="aiOpen" aria-label="Ask your AI what you could list" title="Ask your AI what you could list">✨</button></div>
          <div class="iblank-row"><form class="iblank" id="ideaForm" action="#" autocomplete="off"><span class="mk">+</span><input id="ideaType" placeholder="Type anything" autocomplete="off" autocapitalize="words" enterkeyhint="done" /><div class="stk1-ac" id="ideaAc" hidden></div></form><span class="iblank-or">OR</span><button type="button" class="iblank-cam" id="ideaCam" aria-label="Open camera"><i dangerouslySetInnerHTML={{ __html: '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h1.5a2 2 0 0 0 1.8-1.1l.4-.8A2 2 0 0 1 10.5 4h3a2 2 0 0 1 1.8 1.1l.4.8A2 2 0 0 0 17.5 7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" /><circle cx="12" cy="13" r="3.4" /></svg>' }} /></button></div>
          <div id="ideas" class="ideas"></div>
          <button type="button" class="morelnk" id="moreIdeas">More ideas →</button>
        </div>
        <div class="lf-foot"><div class="pick2" id="pick2" hidden><button type="button" class="cta pk-cam" id="toSnap"><i dangerouslySetInnerHTML={{ __html: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h1.5a2 2 0 0 0 1.8-1.1l.4-.8A2 2 0 0 1 10.5 4h3a2 2 0 0 1 1.8 1.1l.4.8A2 2 0 0 0 17.5 7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" /><circle cx="12" cy="13" r="3.4" /></svg>' }} /><span><b>Snap</b><small>real photos</small></span></button><button type="button" class="cta pk-type" id="toType"><i dangerouslySetInnerHTML={{ __html: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></svg>' }} /><span><b>Find it</b><small>stock photo</small></span></button></div><button type="button" class="cta" id="toCam">OPEN CAMERA</button></div>
      </section>
      {/* no-photo path (default when stock photos are on): one item at a time → brand (optional) → stock photo → ✓ mine; then prices → post */}
      <section id="st-stk" class="lf" hidden>
        <div class="lf-scroll">
          <div class="rv-top"><button type="button" class="lnk" id="stkBack">← back</button><span class="m rv-count" id="stkN"></span></div>
          <div id="stkOne">
            <div class="stk1-dots" id="stkDots"></div>
            <div class="lf-h stk1-h" id="stkH"></div>
            <div id="stkFind">
            <label class="stk1-lbl" for="stkBrand" style="margin-top:0">Which one exactly? · brand / model</label>
            <div class="stk1-acw"><i class="stk1-pen" dangerouslySetInnerHTML={{ __html: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></svg>' }} /><input id="stkBrand" class="stk1-in" placeholder="Brand / model · e.g. DeWalt 20V" autocomplete="off" autocapitalize="words" enterkeyhint="done" /><div class="stk1-ac" id="stkAc" hidden></div></div>
            <div class="stk1-pic" id="stkPic"></div>
            <div class="stk1-tbs" id="stkTbs"></div>
            <div class="stk1-note" id="stkNote">Tap the closest one</div>
            <form class="stk1-ref" id="stkRef"><b>Not it?</b><input id="stkRefIn" placeholder="Add brand / model" autocomplete="off" autocapitalize="words" enterkeyhint="search" /><button type="submit" aria-label="Search" dangerouslySetInnerHTML={{ __html: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/></svg>' }} /></form>
            <div class="stk1-chips" id="stkChips"></div>
            <button type="button" class="stk1-snap" id="stkSnap"><i dangerouslySetInnerHTML={{ __html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h1.5a2 2 0 0 0 1.8-1.1l.4-.8A2 2 0 0 1 10.5 4h3a2 2 0 0 1 1.8 1.1l.4.8A2 2 0 0 0 17.5 7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" /><circle cx="12" cy="13" r="3.4" /></svg>' }} />Take a photo of mine instead</button>
            <div class="stk1-pr" id="stkPr"><button type="button" class="stk1-pm" data-d="-1" aria-label="Lower price">−</button><span class="stk1-tag"><b id="stkPv">$8</b><small>/day</small></span><button type="button" class="stk1-pm" data-d="1" aria-label="Raise price">+</button></div>
            <div class="stk1-note" id="stkRange"></div>
            </div>
            <div id="stkAbout" hidden>
              <div class="stk1-about"><span id="stkAbT"></span><div><div class="stk1-lbl" style="margin:0">About yours</div><b id="stkAbN"></b></div></div>
              <div class="stk1-q"><div class="stk1-lbl">Condition</div>
              <div class="stk1-gr" id="stkGr">{['A', 'B', 'C', 'D', 'E'].map(g => <button type="button" data-g={g} class={'g' + g}><b>{g}</b><small>{({ A: 'Great', B: 'Good', C: 'OK', D: 'Poor', E: 'Junk' } as any)[g]}</small></button>)}</div></div>
              <div class="stk1-q"><div class="stk1-lbl">Details · optional</div>
              <input id="stkDet" class="stk1-in stk1-det" placeholder="e.g. 2 batteries + charger" autocomplete="off" enterkeyhint="done" maxlength={300} /></div>
            </div>
          </div>
          <div id="stkAll" hidden>
            <div class="lf-h" style="margin-bottom:2px">Ready to post</div>
            <p class="hint" style="margin:0 0 6px">Prices are a start · change anytime</p>
            <div id="stkRows"></div>
          </div>
        </div>
        <div class="lf-foot"><div class="stk1-btns"><button type="button" class="cta stk1-skipb" id="stkSkip">Skip</button><button type="button" class="cta" id="stkGo">✓ LOOKS LIKE MINE</button></div></div>
      </section>
      {/* ask your AI: copy a prompt → their own AI searches their email → paste the answer back */}
      <section id="st-ai" class="lf" hidden>
        <div class="lf-scroll">
          <div class="lf-h">Ask your AI</div>
          <div id="aiA">
            <div class="aistep"><i>1</i><b>Ask your AI this</b><small>Tap one · it copies the ask and opens it (paste if it's not filled in) · use one that can see your email</small></div>
            <div class="aiprompt" id="aiPrompt">Search my email for receipts of things I bought in the last 5 years that neighbors might rent — tools, cameras, camping, party/audio, sports, baby gear, kitchen appliances, luggage, outdoor gear. Skip food, clothes, gifts, subscriptions and consumables. One per line: item · brand/model · year · price</div>
            <div class="aiapps">{[['ChatGPT', 'https://chatgpt.com/?q='], ['Claude', 'https://claude.ai/new?q='], ['Gemini', 'https://gemini.google.com/app'], ['Muse', ''], ['Instinct', ''], ['Other', '']].map(([n, u]) => <button type="button" class="aiapp" data-u={u}>{n}</button>)}</div>
            <div class="aistep"><i>2</i><b>Paste its answer here</b></div>
            <textarea id="aiPaste" class="aipaste" rows={7} placeholder="DeWalt drill · DCD771 · 2022 · $99&#10;REI tent · 2021 · $229&#10;…"></textarea>
            <p class="hint" style="margin-top:6px">Lendo never sees your email · nothing is saved until you pick</p>
          </div>
          <div id="aiB" hidden><div class="lf-h" id="aiN" style="font-size:19px"></div><div id="aiList" class="ailist"></div>
            <button type="button" class="btn full" id="aiStock" hidden style="margin-top:12px">No photos? Post with standard photos →</button></div>
          <div id="aiC" hidden><div class="lf-h" style="font-size:19px">Does yours look like this?</div><p class="hint" style="margin:-4px 0 10px">Standard photo from the web · customers see it's a standard photo · take a real one anytime</p><div id="aiStockList" class="ailist"></div></div>
        </div>
        <div class="lf-foot"><button type="button" class="cta" id="aiGo">FIND MY STUFF</button></div>
      </section>
      {/* camera */}
      <section id="st-cam" class="cam" hidden>
        <video id="cam" playsinline muted autoplay></video>
        <input type="file" id="file" accept="image/*" capture="environment" hidden /><input type="file" id="moreFile" accept="image/*" multiple hidden /><input type="file" id="labelFile" accept="image/*" capture="environment" hidden /><input type="file" id="pickFile" accept="image/*,.heic,.heif" hidden />
        <div class="cam-top">
          <button type="button" class="cam-x" id="camClose" aria-label="Close"><svg width="14" height="14" viewBox="0 0 12 12"><path d="M2 2L10 10M10 2L2 10" stroke="#fff" stroke-width="2" stroke-linecap="round" /></svg></button>
          <div class="cam-hints"><span class="hint-big" id="hintBig"></span><span class="hint-sm" id="hint"></span></div>
        </div>
        <div class="cam-br"><i></i><i></i><i></i><i></i></div>
        <div class="tap" id="tapHint">Tap to take a picture <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 4V19M6 13L12 19L18 13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></svg></div>
        <button type="button" class="cam-fallback" id="camFallback" hidden>Open camera</button>
        <div class="dropzone" aria-hidden="true"><span>Drop photo</span></div>
        {/* computers: a plain upload panel instead of a webcam */}
        <div class="uppanel"><button type="button" class="upbox" id="upPick"><i dangerouslySetInnerHTML={{ __html: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="9.5" r="1.8" /><path d="M21 16l-5.5-5.5L6 20" /></svg>' }} /><b>Drop a photo here</b><small>or click to choose one · JPG, PNG, HEIC</small></button><button type="button" class="lnk uselnk" id="useCam">Use webcam instead</button></div>
        <div class="upbusy" id="upBusy" hidden>Opening photo…</div>
        <div class="flash" id="flash"></div>
        <div class="toast-ok" id="toast"><span>✓</span>Got it</div>
        <div class="minilist" id="miniList" hidden></div>
        <div class="cam-bar">
          <button type="button" class="thumbwrap" id="thumbWrap" hidden><img id="thumb" alt="" /><span id="count">0</span></button>
          <button type="button" class="libbtn" id="libBtn" aria-label="Choose a photo"><i dangerouslySetInnerHTML={{ __html: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="9.5" r="1.8" /><path d="M21 16l-5.5-5.5L6 20" /></svg>' }} /></button>
          <button type="button" class="shutter" id="shutter" aria-label="Take photo"><span></span></button>
          <button type="button" class="donebtn" id="doneBtn" hidden>Done →</button>
        </div>
      </section>
      {/* review */}
      <section id="st-review" class="lf" hidden>
        <div class="lf-scroll">
          <div class="rv-top"><button type="button" class="lnk" id="backCam">← snap more</button><span class="m rv-count" id="rvCount"></span></div>
          <div class="lf-h">Check names and prices</div>
          <div class="lf-tip"><b>✦ Guessed from your photo</b> — fix anything off</div>
          <div id="rows"></div>
        </div>
        <div class="lf-foot"><button type="button" class="cta" id="listBtn">LIST</button></div>
      </section>
      {/* one question at a time (card stack): small photo always on top, answered questions shrink to lines, current one is a card */}
      <section id="st-q" class="lf" hidden>
        <div class="lf-scroll">
          <div class="q-top"><button type="button" class="q-ph" id="qPh" aria-label="Retake photo"><img id="qImg" alt="" /><i class="q-id" id="qId" hidden aria-label="Identifying"><span class="dots"><i>.</i><i>.</i><i>.</i></span></i><span>↻</span></button><div class="q-done" id="qDone"></div></div>
          <div class="q-card" id="qCard"></div>
        </div>
      </section>
      {/* done */}
      <section id="st-done" class="lf" hidden>
        {/* posted: the item big on cream, one Share button, three small ways to send, then list another */}
        <div class="lf-scroll dn2">
          <div class="dn2-ok"><span class="dn2-tick" aria-hidden="true">✓</span><span id="dnHead">Posted</span><span id="dnSub" hidden></span></div>
          <div id="tray" class="dn2-tray"></div>
          {/* three big choices */}
          <div class="dn3">
            <button type="button" class="dn3-b hot dn3-soc" id="stShare" aria-label="Share to Instagram, TikTok or X"><span class="soc" dangerouslySetInnerHTML={{ __html: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="3.8" /><circle cx="17.2" cy="6.8" r=".6" fill="currentColor" /></svg><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3.5v11.5a3.5 3.5 0 1 1-3.5-3.5" /><path d="M13 3.5c.4 2.6 2.4 4.5 5 4.6" /></svg><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M4.5 4.5l15 15M19.5 4.5L4.5 19.5" /></svg>' }} /></button>
            <button type="button" class="dn3-b hot" id="stSend"><svg class="ic" width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20l1.3-3.9C1.976 12.66 2.874 8.202 6.4 5.7c3.526-2.501 8.59-2.296 11.845.48c3.255 2.777 3.695 7.266 1.029 10.501C16.608 19.917 11.659 20.989 7.7 19z" /></svg>Send</button>
            <button type="button" class="dn3-b dn3-more" id="again"><span class="plus"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg></span>List more stuff</button>
          </div>
          <a class="dn3-map" href="/">See it on the map</a>
          <div id="shBtns" hidden></div>
          <canvas class="story" id="story" width="1080" height="1920" hidden></canvas><button type="button" id="stSave" hidden></button>
        </div>
        <div class="toast" id="shToast" style="display:none"></div>
      </section>
      {raw(`<script>window.LENDO_LIST=${cfg};</script>`)}
      <script src="/qrgen.js"></script>
      <script src="/details.js"></script>
      <script src="/ac.js" defer></script>
      <script src="/list.js"></script>
    </Layout>
  );
};
listings.get('/list', listPage);
listings.get('/list/ai', listPage); /* opens straight to "Ask your AI" */

listings.post('/list', async (c) => {
  const u = c.get('user');
  if (!u) return c.redirect('/login?next=/list');
  const f = await c.req.parseBody({ all: true });
  const name = String(f.name || '').trim().slice(0, 80);
  const minP = (await minPriceCents(c.env));
  const price = Math.round(parseFloat(String(f.price || '0')) * 100);
  if (!name || isNaN(price) || (price !== 0 && price < minP)) return c.text(`Price must be at least ${money(minP)}/day and the item needs a name.`, 400);
  const weekIn = parseFloat(String(f.week || ''));
  const lat = parseFloat(String(f.lat || '')), lng = parseFloat(String(f.lng || ''));
  const files = ([] as unknown[]).concat(f.photo || []).filter((p): p is File => p instanceof File);
  const photos = await Promise.all(files.slice(0, 6).map(async p => ({ bytes: await p.arrayBuffer(), type: p.type })));
  const lid = await createListing(c.env, c.executionCtx, u, { name, priceCents: price, weekCents: !isNaN(weekIn) && weekIn > 0 ? Math.round(weekIn * 100) : null, description: String(f.description || ''), lat: isNaN(lat) ? null : lat, lng: isNaN(lng) ? null : lng, photos });
  return c.redirect('/listings?just=' + lid);
});

// Batch create from the snap-flow: multipart with items[i][name|price|week|note] + photo_i
// real photo of the item on a transparent background (for the share story card); cached in R2
listings.get('/api/cut/:id', async (c) => {
  const lid = c.req.param('id'), key = `${lid}/cut.png`;
  let o = await c.env.PHOTOS.get(key);
  if (!o) {
    const ph = await c.env.DB.prepare('SELECT r2_key FROM photos WHERE listing_id = ? ORDER BY pos LIMIT 1').bind(lid).first<{ r2_key: string }>();
    if (!ph) return c.json({ error: 'none' }, 404);
    try { const cut = await makeCutout(c.env, ph.r2_key, 900); if (!cut) return c.json({ error: 'cut' }, 502); await c.env.PHOTOS.put(key, cut, { httpMetadata: { contentType: 'image/png' } }); return c.body(cut, 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }); }
    catch { return c.json({ error: 'cut' }, 502); }
  }
  return c.body(o.body, 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
});

/* fast cut-out for the snap flow: starts the moment the photo is taken, in parallel with identify (which used to come first) */
/* photos the browser can't open (HEIC on Chrome/Firefox): store briefly, return a JPEG made by Cloudflare Images */
listings.post('/api/to-jpeg', async (c) => {
  if (!c.get('user')) {
    const ip = c.req.header('cf-connecting-ip') || 'x';
    const n = await c.env.DB.prepare(`SELECT COUNT(*) n FROM events WHERE kind = 'tojpeg.guest' AND at > ? AND data = ?`).bind(Date.now() - 3600000, ip).first<{ n: number }>().catch(() => null);
    if ((n?.n || 0) >= 30) return c.json({ error: 'slow down' }, 429);
    await logEvent(c.env.DB, 'tojpeg.guest', { data: ip });
  }
  const f = await c.req.parseBody(); const p = f.photo;
  if (!(p instanceof File) || p.size > 25e6) return c.json({ error: 'photo required' }, 400);
  const key = `tmp/${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}.heic`;
  await c.env.PHOTOS.put(key, await p.arrayBuffer(), { httpMetadata: { contentType: p.type || 'image/heic' } });
  try {
    const src = `${c.env.APP_URL}/p/${key}`;
    let r = await fetch(src, { cf: { image: { fit: 'scale-down', width: 1600, height: 1600, format: 'jpeg', quality: 86 } } } as any).catch(() => null as any);
    if (!r || !r.ok || !(r.headers.get('content-type') || '').includes('jpeg')) r = await fetch(`${c.env.APP_URL}/cdn-cgi/image/fit=scale-down,width=1600,height=1600,format=jpeg,quality=86/${src}`);
    if (!r.ok || !(r.headers.get('content-type') || '').includes('jpeg')) throw new Error('to-jpeg ' + r.status);
    return c.body(await r.arrayBuffer(), 200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
  } catch (e) { await logErr(c.env.DB, 'api/to-jpeg', e); return c.json({ error: 'convert' }, 502); }
});
listings.post('/api/cut', async (c) => {
  if (!c.get('user')) { /* guests: capped per IP, like identify */
    const ip = c.req.header('cf-connecting-ip') || 'x';
    const n = await c.env.DB.prepare(`SELECT COUNT(*) n FROM events WHERE kind = 'cut.guest' AND at > ? AND data = ?`).bind(Date.now() - 3600000, ip).first<{ n: number }>().catch(() => null);
    if ((n?.n || 0) >= 30) return c.json({ error: 'slow down' }, 429);
    await logEvent(c.env.DB, 'cut.guest', { data: ip });
  }
  const f = await c.req.parseBody(); const p = f.photo;
  if (!(p instanceof File)) return c.json({ error: 'photo required' }, 400);
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16), base = `tmp/${id}`;
  await c.env.PHOTOS.put(`${base}.jpg`, await p.arrayBuffer(), { httpMetadata: { contentType: p.type || 'image/jpeg' } });
  try {
    const cut = await makeCutout(c.env, `${base}.jpg`, 600); if (!cut) return c.json({ error: 'cut' }, 502);
    c.executionCtx.waitUntil(c.env.PHOTOS.put(`${base}-cut.png`, cut, { httpMetadata: { contentType: 'image/png' } }).then(() => {}));
    return c.body(cut, 200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
  } catch (e) { await logErr(c.env.DB, 'api/cut', e); return c.json({ error: 'cut', why: String(e).slice(0, 200) }, 502); }
});
listings.get('/api/cuttmp/:id{[a-f0-9]{16}}', async (c) => {
  const base = `tmp/${c.req.param('id')}`, key = `${base}-cut.png`;
  const o = await c.env.PHOTOS.get(key);
  if (o) return c.body(o.body, 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
  if (!(await c.env.PHOTOS.head(`${base}.jpg`))) return c.json({ error: 'none' }, 404);
  try { const cut = await makeCutout(c.env, `${base}.jpg`, 900); if (!cut) return c.json({ error: 'cut' }, 502); await c.env.PHOTOS.put(key, cut, { httpMetadata: { contentType: 'image/png' } }); return c.body(cut, 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }); }
  catch { return c.json({ error: 'cut' }, 502); }
});

/* standard product photo for an item (Brave image search); the owner confirms theirs looks like it */
listings.get('/api/stock', async (c) => {
  if (!c.get('user') || !c.env.BRAVE_API_KEY) return c.json({ imgs: [] });
  /* the device itself, not the bundle: drop kit/set/combo words and piece counts so "Dremel 4000 rotary tool kit" finds the tool */
  const q = String(c.req.query('q') || '').replace(/\b\d+\s*-?\s*(pc|pcs|piece|pieces|pack)\b/gi, ' ').replace(/\b(kit|combo|bundle|with accessories|accessories|fly more)\b/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 100); if (!q) return c.json({ imgs: [] });
  /* name the maker when people leave it off ("AirPods max" → Apple AirPods max): the search finds the real product */
  const MAKER: [RegExp, string][] = [[/\b(airpods|macbook|imac|ipad|iphone|apple watch|homepod|magic keyboard)\b/i, 'Apple'], [/\b(kindle|echo dot|fire tv)\b/i, 'Amazon'], [/\b(switch oled|joy-?con)\b/i, 'Nintendo'], [/\b(ps5|playstation)\b/i, 'Sony'], [/\bgalaxy\b/i, 'Samsung'], [/\b(quest 3|quest 2)\b/i, 'Meta'], [/\b(pixel \d)\b/i, 'Google'], [/\bthinkpad\b/i, 'Lenovo'], [/\bvitamix\b/i, '']];
  /* "fly rod fishing rod" → "fly rod fishing": drop repeated words (brand box + item name often overlap) */
  const seen = new Set<string>(); let q2 = q.split(' ').filter(w => { const k = w.toLowerCase().replace(/s$/, ''); if (seen.has(k)) return false; seen.add(k); return true; }).join(' ');
  for (const [re, mk] of MAKER) if (mk && re.test(q2) && !new RegExp('\\b' + mk + '\\b', 'i').test(q2)) { q2 = mk + ' ' + q2; break; }
  /* same model, same photos: cache a week so repeat searches ("Milwaukee M18 drill") come back instantly */
  const ck = new Request('https://lendo.co/__stock?v=2&q=' + encodeURIComponent(q2.toLowerCase()));
  try { const hit = await caches.default.match(ck); if (hit) return c.json(await hit.json()); } catch (e) {}
  try {
    /* Brave allows ~1 search/sec: wait + retry here once, then let the page retry. Try the clean-product query first, then the plain name */
    const brave = async (qq: string) => { for (let t = 0; t < 2; t++) { const r = await fetch('https://api.search.brave.com/res/v1/images/search?safesearch=strict&count=12&q=' + encodeURIComponent(qq), { headers: { accept: 'application/json', 'X-Subscription-Token': c.env.BRAVE_API_KEY! } }); if (r.status === 429) { await new Promise(res => setTimeout(res, 1200)); continue; } if (!r.ok) { await logErr(c.env.DB, 'stock search', new Error('brave ' + r.status)); return { results: [] }; } return await r.json() as any; } return null; };
    let j: any = await brave(q2 + ' product photo white background');
    if (!j) return c.json({ imgs: [], retry: true });
    if (!(j.results || []).length) { await new Promise(res => setTimeout(res, 1100)); j = await brave(q2) || { results: [] }; }
    if (!(j.results || []).length) await logEvent(c.env.DB, 'stock.none', { user: c.get('user')!.id, data: { q: q2 } });
    /* best first: store / maker product shots (clean, square-ish), never social or stock-art sites */
    const GOOD = /(apple|amazon|bestbuy|target|walmart|bhphotovideo|adorama|homedepot|lowes|rei|dickssportinggoods|costco|crutchfield|sony|bose|samsung|dewalt|milwaukeetool|makitatools|ryobitools|kitchenaid|breville|delonghi|ninjakitchen|uppababy|bugaboo|nintendo|playstation|xbox|canon|nikon|fujifilm|jbl|logitech|dell|lenovo|hp|microsoft|garmin|dyson|sharkclean|wayfair|ikea|patagonia|thenorthface|backcountry|evo|zappos|staples|officedepot|newegg|ebayimg|shopify|cdn\.shopify)\./i;
    const BAD = /(pinterest|pinimg|reddit|redd\.it|etsy|facebook|instagram|tiktok|shutterstock|istockphoto|gettyimages|alamy|dreamstime|depositphotos|freepik|vecteezy|youtube|ytimg|wikipedia)/i;
    const score = (x: any) => { const host = String(x.url || x.properties?.url || ''); const w = Number(x.properties?.width || x.thumbnail?.width || 0), h = Number(x.properties?.height || x.thumbnail?.height || 0);
      let sc = 0; if (GOOD.test(host)) sc += 3; if (BAD.test(host)) sc -= 5; if (w && h) { const r = w / h; if (r > 0.7 && r < 1.45) sc += 1.5; else if (r > 2 || r < 0.5) sc -= 1; if (Math.min(w, h) >= 500) sc += 0.5; } return sc; };
    const imgs = (j.results || []).map((x: any, i: number) => ({ src: x.properties?.url, thumb: x.thumbnail?.src, s: score(x) - i * 0.15 })).filter((x: any) => /^https:\/\//.test(x.src || '') && x.thumb && x.s > -3).sort((a: any, b: any) => b.s - a.s).slice(0, 4).map((x: any) => ({ src: x.src, thumb: x.thumb }));
    if (imgs.length) c.executionCtx.waitUntil(caches.default.put(ck, new Response(JSON.stringify({ imgs }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=604800' } })).catch(() => {}));
    return c.json({ imgs });
  } catch (e) { await logErr(c.env.DB, 'stock search', e); return c.json({ imgs: [] }); }
});
/* where your things are (asked before posting when there's no GPS and no saved spot) */
listings.post('/api/me/where', async (c) => {
  const u = c.get('user'); if (!u) return c.json({ error: 'login' }, 401);
  const b = await c.req.json<{ place?: string; lat?: number; lng?: number; cross?: string }>().catch(() => ({} as any));
  if (typeof b.cross === 'string') { /* the person fixes the public cross streets by hand: same uniform style, never a street address */
    const x = tidyCross(b.cross); if (!x) return c.json({ error: 'cross' }, 400);
    await c.env.DB.prepare('UPDATE users SET cross_streets = ? WHERE id = ?').bind(x, u.id).run(); await logEvent(c.env.DB, 'profile.cross', { user: u.id, data: { cross: x } });
    return c.json({ ok: true, cross: x, hood: u.hood || null });
  }
  const pt = typeof b.lat === 'number' && typeof b.lng === 'number' && Math.abs(b.lat) <= 90 && Math.abs(b.lng) <= 180 ? { lat: b.lat, lng: b.lng } : undefined;
  const r = await setUserWhere(c.env, u, String(b.place || ''), pt ? 'gps' : u.id, pt);
  return r ? c.json({ ok: true, hood: r.hood, cross: r.cross, lat: r.lat, lng: r.lng }) : c.json({ error: 'notfound' }, 404);
});
/* learned brand/model suggestions for one idea (merged client-side with public/ac.js) */
listings.get('/api/ac', async (c) => {
  const idea = String(c.req.query('idea') || '').trim().slice(0, 40); if (!idea) return c.json({ terms: [] });
  const r = await c.env.DB.prepare('SELECT term FROM ac_terms WHERE idea = ? AND n >= 2 ORDER BY n DESC LIMIT 40').bind(idea).all<{ term: string }>().catch(() => ({ results: [] as { term: string }[] }));
  c.header('cache-control', 'public, max-age=600');
  return c.json({ terms: r.results.map(x => x.term) });
});
/* post items with the standard photo the owner confirmed (no camera); the photo is copied into R2 like any other */
listings.post('/api/list-stock', async (c) => {
  const u = c.get('user'); if (!u) return c.json({ error: 'login' }, 401);
  const b = await c.req.json<{ items?: { name?: string; price?: number; img?: string; thumb?: string; idea?: string; brand?: string; details?: string; grade?: string }[]; lat?: number; lng?: number }>().catch(() => ({} as any));
  /* every reply row carries its input index `i` so the posted screen matches photos by item, never by position; skipped items come back in `failed` */
  const minP = (await minPriceCents(c.env)), out: any[] = [], failed: { i: number; name: string; why: string }[] = [];
  for (const [i, it] of (b.items || []).slice(0, 30).entries()) {
    const name = String(it.name || '').trim().slice(0, 80), price = Math.round(Number(it.price || 0) * 100) <= 0 ? 0 : Math.max(minP, Math.round(Number(it.price || 0) * 100));
    if (!name) { failed.push({ i, name, why: 'name' }); continue; }
    let bytes: ArrayBuffer | null = null, type = 'image/jpeg';
    for (const u0 of [it.img, it.thumb]) {
      if (bytes || !/^https:\/\//.test(String(u0 || ''))) continue;
      try { const r = await fetch(String(u0), { headers: { 'user-agent': 'Lendo/1.0' }, cf: { cacheTtl: 0 } } as any); const ct = r.headers.get('content-type') || ''; if (r.ok && /^image\/(jpeg|png|webp)/.test(ct)) { const a = await r.arrayBuffer(); if (a.byteLength > 2000 && a.byteLength < 8e6) { bytes = a; type = ct.split(';')[0]; } } } catch {}
    }
    if (!bytes) { failed.push({ i, name, why: 'photo' }); await logErr(c.env.DB, 'list-stock photo', new Error(String(it.img || '').slice(0, 200))); continue; }
    const lid = await createListing(c.env, c.executionCtx, u, { name, priceCents: price, description: String(it.details || '').trim().slice(0, 300) || null, grade: it.grade || null, lat: typeof b.lat === 'number' ? b.lat : null, lng: typeof b.lng === 'number' ? b.lng : null, photos: [{ bytes, type }] });
    await c.env.DB.prepare('UPDATE listings SET stock_photo = 1 WHERE id = ?').bind(lid).run();
    await logEvent(c.env.DB, 'listing.stock_photo', { user: u.id, listing: lid, data: { src: String(it.img || '').slice(0, 300) } });
    /* autocomplete learns: the brand/model this owner typed for this idea (plain text only; shown once 2+ owners used it) */
    const idea = String(it.idea || '').trim().slice(0, 40), term = String(it.brand || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (idea && term.length >= 2 && /^[\p{L}\p{N} .,'’+&()\/-]+$/u.test(term) && !/https?:|www\.|\d{7,}/i.test(term))
      await c.env.DB.prepare('INSERT INTO ac_terms (idea, term, n, last_at) VALUES (?, ?, 1, ?) ON CONFLICT(idea, term) DO UPDATE SET n = n + 1, last_at = excluded.last_at').bind(idea, term, Date.now()).run().catch(() => null);
    const ph0 = await c.env.DB.prepare('SELECT r2_key FROM photos WHERE listing_id = ? ORDER BY pos LIMIT 1').bind(lid).first<{ r2_key: string }>().catch(() => null);
    out.push({ i, id: lid, name, price: price / 100, url: await itemLink(c.env, lid), cut: ph0 ? cutoutUrl(c.env, ph0.r2_key, 600, 600) : null, photo: ph0 ? '/p/' + ph0.r2_key : null });
  }
  return c.json({ listed: out, count: out.length, failed });
});
listings.post('/api/list', async (c) => {
  const u = c.get('user');
  if (!u) return c.json({ error: 'login' }, 401);
  const f = await c.req.parseBody({ all: true });
  const lat = parseFloat(String(f.lat || '')), lng = parseFloat(String(f.lng || ''));
  const minP = (await minPriceCents(c.env));
  const out: { id: string; name: string; url?: string; cut?: string | null }[] = [];
  for (let i = 0; i < 30; i++) {
    const name = String(f[`name_${i}`] || '').trim(); if (!name) continue;
    const aiName = String(f[`ai_${i}`] || '').trim(); if (aiName) c.executionCtx.waitUntil(recordCorrection(c.env, aiName, name).catch(() => {}));
    const price = Math.round(parseFloat(String(f[`price_${i}`] || '0')) * 100); if (isNaN(price) || (price !== 0 && price < minP)) continue;
    const files = [f[`photo_${i}`], ...Array.from({ length: 5 }, (_, j) => f[`photo_${i}_${j + 1}`])].filter((x): x is File => x instanceof File);
    const photos = await Promise.all(files.slice(0, 6).map(async p => ({ bytes: await p.arrayBuffer(), type: p.type })));
    const wk = Math.round(parseFloat(String(f[`week_${i}`] || '0')) * 100);
    const lid = await createListing(c.env, c.executionCtx, u, { name, priceCents: price, weekCents: wk > 0 ? wk : null, description: String(f[`note_${i}`] || ''), lat: isNaN(lat) ? null : lat, lng: isNaN(lng) ? null : lng, photos, grade: String(f[`grade_${i}`] || 'A') });
    await assignHandle(c.env, u.id, u.name).catch(() => null); await assignSlug(c.env, lid, u.id, name).catch(() => null);
    const ph0 = await c.env.DB.prepare('SELECT r2_key FROM photos WHERE listing_id = ? ORDER BY pos LIMIT 1').bind(lid).first<{ r2_key: string }>().catch(() => null);
    out.push({ id: lid, name, url: await itemLink(c.env, lid), cut: ph0 ? cutoutUrl(c.env, ph0.r2_key, 600, 600) : null } as any); /* posted screen shows the cut-out even if the in-flow one didn't land */
  }
  /* A/B list10: first item listed, and reaching 10, per variant (cookie set on the page) */
  const abv = getCookie(c, 'lendo_ab_l10');
  if (out.length && abv && /^[abc]$/.test(abv)) {
    const n = (await c.env.DB.prepare(`SELECT COUNT(*) n FROM listings WHERE owner_id = ? AND demo = 0`).bind(u.id).first<{ n: number }>())?.n ?? 0;
    if (n - out.length === 0) await logEvent(c.env.DB, 'ab.list10', { user: u.id, data: { ev: 'listed', var: abv } });
    if (n >= 10 && n - out.length < 10) await logEvent(c.env.DB, 'ab.list10', { user: u.id, data: { ev: 'ten', var: abv } });
  }
  return c.json({ listed: out, count: out.length });
});
listings.get('/listings', requireUser, async (c) => {
  // listings live on your profile now (one page to manage your stuff)
  const u = c.get('user')!; const just = c.req.query('just'), saved = c.req.query('saved');
  const h = (u as any).handle;
  return c.redirect((h ? '/' + h : '/u/' + u.id) + (just ? '?just=' + encodeURIComponent(just) : saved ? '?saved=' + encodeURIComponent(saved) : ''));
});

listings.post('/listings/:id/price', requireUser, async (c) => {
  const u = c.get('user')!;
  const d = parseInt(String((await c.req.parseBody()).delta || '0'), 10) || 0;
  const minP = (await minPriceCents(c.env));
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  const np = Math.max(minP, it.price_cents + d);
  const week = weekDefault(np); /* weekly is always automatic */
  await c.env.DB.prepare('UPDATE listings SET price_cents = ?, week_cents = ? WHERE id = ?').bind(np, week, it.id).run();
  await logEvent(c.env.DB, 'listing.price', { user: u.id, listing: it.id, cents: np, data: { was: it.price_cents } });
  return c.redirect('/listings?saved=' + it.id);
});

listings.post('/listings/:id/toggle', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  if (it.status === 'review') return c.redirect('/listings');
  await c.env.DB.prepare('UPDATE listings SET status = ? WHERE id = ?').bind(it.status === 'live' ? 'paused' : 'live', it.id).run();
  await logEvent(c.env.DB, it.status === 'live' ? 'listing.paused' : 'listing.unpaused', { user: u.id, listing: it.id });
  return c.redirect('/listings');
});

listings.post('/listings/:id/remove', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  await c.env.DB.prepare(`UPDATE listings SET status = 'removed' WHERE id = ?`).bind(it.id).run();
  await logEvent(c.env.DB, 'listing.removed', { user: u.id, listing: it.id, data: { name: it.name } });
  return c.redirect('/listings');
});

listings.get('/listings/:id/edit', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  const photos = await photosFor(c.env.DB, it.id);
  const today = localToday(it.lng);
  const busy = await busyDays(c.env.DB, it.id, today, addDays(today, 27));
  const blocked = new Set((await c.env.DB.prepare('SELECT day FROM blocked_days WHERE listing_id = ? AND day >= ?').bind(it.id, today).all<{ day: string }>()).results.map(r => r.day));
  const days = Array.from({ length: 28 }, (_, i) => addDays(today, i));
  const gr = await shownGrade(c.env, it.id, (it as any).grade);
  return c.html(
    <Layout title="Edit listing" user={u} back="/listings">
      <form method="post" action={'/listings/' + it.id + '/edit'} style="padding:12px 16px 40px">
        <div class="phm">
          {photos.map((p, i) => <div class="phm-it">
            {/* cover shows the cut-out, like the item page and map */}
            <img src={cutoutUrl(c.env, p.r2_key, 400, 400)} alt="" style="object-fit:contain;background:#fff" />
            {i === 0 ? <span class="phm-cover">cover</span> : <button type="submit" formaction={`/listings/${it.id}/photos/${p.id}/cover`} formnovalidate class="phm-mk">make cover</button>}
            <button type="submit" formaction={`/listings/${it.id}/photos/${p.id}/delete`} formnovalidate class="phm-x" aria-label="Remove photo">×</button>
          </div>)}
          {/* one "+ Add photo" (Scott, 11/27) → Take a photo · Upload · Stock photo */}
          {photos.length < 6 ? <button type="button" class="phm-add" id="phAdd" onclick="var m=document.getElementById('phMenu');m.hidden=!m.hidden"><b>+</b><small>Add photo</small></button> : null}
        </div>
        {photos.length < 6 ? <div class="phmenu" id="phMenu" hidden>
          <label class="phmenu-b">Take a photo<input type="file" accept="image/*" capture="environment" hidden onchange="this.form.action=this.dataset.u;this.form.enctype='multipart/form-data';this.form.submit()" data-u={`/listings/${it.id}/photos`} name="photos" /></label>
          <label class="phmenu-b">Upload<input type="file" accept="image/*" multiple hidden onchange="this.form.action=this.dataset.u;this.form.enctype='multipart/form-data';this.form.submit()" data-u={`/listings/${it.id}/photos`} name="photos" /></label>
          {c.env.BRAVE_API_KEY ? <button type="button" class="phmenu-b" id="stkOpen" data-q={it.name}>Stock photo</button> : null}
        </div> : null}
        <div class="stkpick" id="stkPick" hidden><p class="hint" id="stkMsg">Finding photos…</p><div class="stkpick-g" id="stkGrid"></div>
          <input type="hidden" name="stock_img" id="stkImg" /></div>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var b=document.getElementById('stkOpen');if(!b)return;b.onclick=function(){var w=document.getElementById('stkPick'),g=document.getElementById('stkGrid'),m=document.getElementById('stkMsg');w.hidden=false;g.innerHTML='';m.textContent='Finding photos…';
fetch('/api/stock?q='+encodeURIComponent(b.dataset.q)).then(function(r){return r.json()}).then(function(j){var a=(j.imgs||[]).slice(0,9);if(!a.length){m.textContent='No stock photos found';return}m.textContent='Tap the one that looks like yours';
a.forEach(function(x){var i=document.createElement('img');i.src=x.thumb||x.src;i.alt='';i.onclick=function(){var f=b.form;document.getElementById('stkImg').value=JSON.stringify({img:x.src,thumb:x.thumb||''});f.action='/listings/${it.id}/stock';f.submit()};g.appendChild(i)})}).catch(function(){m.textContent='Couldn’t load photos · try again'})}})()` }} />
        <div style="display:flex;gap:10px;align-items:flex-end">
          <label class="field" style="flex:1"><span>Name</span><input name="name" value={it.name} required maxlength={80} /></label>
        </div>
        <div style="display:flex;gap:10px">
          <div class="field" style="flex:1"><span>Price</span>
            {/* same −/+ price tag as the listing flow (Scott, 11/27); $0 = free lend, else at least the minimum */}
            <div class="prset" data-min={String((await minPriceCents(c.env)) / 100)}><button type="button" data-d="-1" aria-label="Lower price">−</button><span class="prset-tag"><b>${it.price_cents / 100}</b><small>/day</small></span><button type="button" data-d="1" aria-label="Raise price">+</button>
              <input type="hidden" name="price" value={String(it.price_cents / 100)} /></div>
            {/* weekly is automatic (weekDefault: 30% off 7 days, whole dollars); shown so the owner sees it (Scott, 11/28) */}
            <p class="prweek" id="prWeek" hidden={it.price_cents === 0}><b>{money(weekDefault(it.price_cents))}</b>/week · set automatically, 30% off 7 days</p>
            <script dangerouslySetInnerHTML={{ __html: `(function(){var w=document.querySelector('.prset');if(!w)return;var MIN=+w.dataset.min||1,i=w.querySelector('input'),b=w.querySelector('b'),t;
function set(v){v=Math.max(0,Math.round(v));if(v>0&&v<MIN)v=v<+i.value?0:MIN;i.value=v;b.textContent='$'+v;var z=document.getElementById('zeroNote');if(z)z.hidden=v!==0;var wk=document.getElementById('prWeek');if(wk){wk.hidden=v===0;wk.firstChild.textContent='$'+Math.round(v*100*7*.7/100)}}
function step(d){set(+i.value+d*(+i.value>=50?5:1))}
w.addEventListener('click',function(e){var x=e.target.closest('button');if(x)step(+x.dataset.d)});
w.addEventListener('pointerdown',function(e){var x=e.target.closest('button');if(!x)return;t=setTimeout(function r(){step(+x.dataset.d);t=setTimeout(r,90)},450)});
['pointerup','pointerleave','pointercancel'].forEach(function(k){w.addEventListener(k,function(){clearTimeout(t)})});})()` }} /></div>
        </div>
        <p class="hint zero-note" id="zeroNote" hidden={it.price_cents !== 0}><b>Free to borrow</b> · no fee · no card hold, so no cover if it comes back damaged</p>
        <div class="field"><span>Condition</span>
          {gr.customers ? <div class="row" style="gap:10px;margin-top:4px"><Grade g={gr.letter} /><span class="hint">{GRADE_WORD[gr.letter]} · set by customers now (average of yours + {gr.customers} customer grade{gr.customers === 1 ? '' : 's'})</span></div>
            : <div class="grdpick" style="margin-top:4px">{GRADES.map(g => <label><input type="radio" name="grade" value={g} checked={g === gr.letter} /><Grade g={g} /></label>)}</div>}
        </div>
        {/* item value = the deposit hold on every rental. Set by Lendo's AI in the background about an hour after listing; the owner can ask for it now. The one appeal is tucked away on purpose */}
        <div class="field"><span>Value</span>
          {it.value_cents && it.value_src !== 'est' ? <div><b>{money(it.value_cents)}</b> <span class="hint">· set by Lendo · customers get a hold for this at pickup, like a hotel check-in, not a charge{it.value_why ? ' · ' + it.value_why : ''}</span>
              {it.value_cents > HIGH_CENTS && !(await photosOk(c.env, it)) ? <div class="hint" style="margin-top:4px;color:#b3261e;font-weight:700">Holds stop at {money(HIGH_CENTS)} until this has 2 or more photos of yours{it.stock_photo ? ' (it has a standard web photo now)' : ''}</div> : null}
              {!it.value_appeal ? <div class="hint" style="margin-top:4px"><a href={`/listings/${it.id}/value`} style="color:inherit">Looks wrong?</a></div> : null}</div>
            : <div class="hint">Lendo sets it right after listing · customers get a hold for it at pickup, like a hotel check-in, not a charge · <button type="submit" formaction={`/listings/${it.id}/value/now`} formnovalidate style="background:none;border:0;padding:0;font:inherit;color:inherit;text-decoration:underline">get it now</button></div>}
        </div>
        {/* asked when the grade isn't A: customers see it, the value accounts for it, and it's on file if there's a problem later */}
        {(gr.letter !== 'A' || it.issues) ? <label class="field" id="issues"><span>Known issues</span><textarea name="issues" maxlength={600} placeholder="What’s wrong with it: scratches, a missing part, a weak battery" style="min-height:60px">{it.issues || ''}</textarea></label> : null}
        <label class="field"><span>Description</span><textarea name="description" id="desc" maxlength={600} placeholder="Model · what’s included · condition · good for">{it.description || ''}</textarea></label>
        <div class="dmeter" id="dmeter"></div>
        <script src="/details.js"></script>
        <script dangerouslySetInnerHTML={{ __html: `lendoDetailsBind(document.getElementById('desc'), document.getElementById('dmeter'))` }} />
        {/* availability: Mon–Sun grid, 4 weeks, tap a day to turn it off (grey, struck through) · rented days locked */}
        <div class="field" style="margin-top:14px"><span>Availability</span></div>
        <div class="hint" style="margin:-4px 0 6px">Tap the days it’s not available</div>
        <div class="days-hd">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(w => <span>{w}</span>)}</div>
        <div class="days av">
          {Array.from({ length: (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7 }, () => <span />)}
          {days.map((d, i) => {
            const rented = busy.has(d) && !blocked.has(d);
            const dt = new Date(d + 'T12:00:00Z'), n = dt.getUTCDate();
            const top = i === 0 ? 'Today' : n === 1 ? dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) : '';
            return <label><input type="checkbox" name="block" value={d} checked={blocked.has(d)} disabled={rented} style="display:none" /><button type="button" class={(rented ? 'busy' : blocked.has(d) ? 'off' : '') + (i === 0 ? ' today' : '')} disabled={rented} onclick="var i=this.previousElementSibling;i.checked=!i.checked;this.classList.toggle('off',i.checked)" aria-label={fmtDay(d) + (rented ? ' rented' : '')} style="width:100%">{top ? <small>{top}</small> : null}<b>{n}</b>{rented ? <i>rented</i> : null}</button></label>;
          })}
        </div>
        
        {/* pinned to the bottom (Scott, 11/25): Save + Pause + Remove always in reach */}
        <div class="rentbar editbar">
          <button class="btn pri" type="submit" style="flex:1">Save</button>
          {it.status === 'review' ? <span class="pill">Posted · checking the photo</span> : <button class="btn sm" type="submit" formaction={'/listings/' + it.id + '/toggle'} formnovalidate>{it.status === 'live' ? 'Pause it' : 'Make it live'}</button>}
          <button class="btn sm" type="submit" formaction={'/listings/' + it.id + '/remove'} formnovalidate style="color:var(--red)" onclick="return confirm('Remove this listing?')">Remove</button>
        </div>
      </form>
    </Layout>
  );
});

// photos: add (up to 6), remove, make cover — owner only
async function ownListing(c: any) { const u = c.get('user')!; const it = await listingById(c.env.DB, c.req.param('id')); return it && it.owner_id === u.id ? it : null; }
async function renumber(env: any, lid: string) { const rows = (await env.DB.prepare('SELECT id FROM photos WHERE listing_id = ? ORDER BY pos, id').bind(lid).all()).results as { id: string }[]; for (let i = 0; i < rows.length; i++) await env.DB.prepare('UPDATE photos SET pos = ? WHERE id = ?').bind(i, rows[i].id).run(); }
// cover photo changed → redo the map icon from the new cover
async function recoverIcon(c: any, lid: string, before: string | null) {
  const ph = await photosFor(c.env.DB, lid); const k = ph[0]?.r2_key || null;
  if (k && k !== before) c.executionCtx.waitUntil(autoIcon(c.env, lid, k));
}
/* owner picks a stock photo on the edit page: allowed only while the item has no photo of their own; it becomes the only photo */
listings.post('/listings/:id/stock', requireUser, async (c) => {
  const it = await ownListing(c); if (!it) return c.notFound();
  const have = await photosFor(c.env.DB, it.id);
  const alongside = have.length > 0 && !it.stock_photo; /* the owner already has real photos: add this one at the end */
  if (have.length >= 6) return c.redirect(`/listings/${it.id}/edit`);
  let pick: any = {}; try { pick = JSON.parse(String((await c.req.parseBody()).stock_img || '{}')); } catch {}
  let bytes: ArrayBuffer | null = null, type = 'image/jpeg';
  for (const u0 of [pick.img, pick.thumb]) {
    if (bytes || !/^https:\/\//.test(String(u0 || ''))) continue;
    try { const r = await fetch(String(u0), { headers: { 'user-agent': 'Lendo/1.0' } }); const ct = r.headers.get('content-type') || ''; if (r.ok && /^image\/(jpeg|png|webp)/.test(ct)) { bytes = await r.arrayBuffer(); type = ct.split(';')[0]; } } catch {}
  }
  if (!bytes) return c.redirect(`/listings/${it.id}/edit`);
  if (!alongside) for (const p of have) await c.env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(p.id).run();
  const key = `${it.id}/${id('ph')}.${type.split('/')[1].replace('jpeg', 'jpg')}`, pos = alongside ? have.length : 0, pid = id('ph');
  await c.env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } });
  await c.env.DB.prepare('INSERT INTO photos (id, listing_id, r2_key, pos, stock) VALUES (?,?,?,?,1)').bind(pid, it.id, key, pos).run()
    .catch(() => c.env.DB.prepare('INSERT INTO photos (id, listing_id, r2_key, pos) VALUES (?,?,?,?)').bind(pid, it.id, key, pos).run());
  if (!alongside) await c.env.DB.prepare('UPDATE listings SET stock_photo = 1, avatar_key = NULL WHERE id = ?').bind(it.id).run();
  await logEvent(c.env.DB, 'listing.stock_photo', { user: it.owner_id, listing: it.id, data: { src: String(pick.img || '').slice(0, 300), via: 'edit' } });
  if (!alongside) await recoverIcon(c, it.id, null);
  return c.redirect(`/listings/${it.id}/edit`);
});
listings.post('/listings/:id/photos', requireUser, async (c) => {
  const it = await ownListing(c); if (!it) return c.notFound();
  const f = await c.req.parseBody({ all: true });
  const files = (Array.isArray(f.photos) ? f.photos : [f.photos]).filter((x): x is File => x instanceof File && x.size > 0);
  const have = (await photosFor(c.env.DB, it.id)).length;
  let pos = have;
  for (const p of files.slice(0, Math.max(0, 6 - have))) {
    const key = `${it.id}/${id('ph')}.${(p.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`;
    await c.env.PHOTOS.put(key, await p.arrayBuffer(), { httpMetadata: { contentType: p.type || 'image/jpeg' } });
    await c.env.DB.prepare('INSERT INTO photos (id, listing_id, r2_key, pos) VALUES (?,?,?,?)').bind(id('ph'), it.id, key, pos++).run();
  }
  if (!have) await recoverIcon(c, it.id, null);
  /* first real photo replaces the standard one: it becomes the cover and the map icon */
  if (it.stock_photo && pos > have) {
    const ph = await photosFor(c.env.DB, it.id), real = ph.slice(have);
    for (const p of ph.slice(0, have)) await c.env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(p.id).run();
    for (let i = 0; i < real.length; i++) await c.env.DB.prepare('UPDATE photos SET pos = ? WHERE id = ?').bind(i, real[i].id).run();
    await c.env.DB.prepare('UPDATE listings SET stock_photo = 0, avatar_key = NULL WHERE id = ?').bind(it.id).run();
    await logEvent(c.env.DB, 'listing.real_photo', { user: it.owner_id, listing: it.id });
    await recoverIcon(c, it.id, null);
  }
  // new photos get the same safety check as at listing time
  const added = (await photosFor(c.env.DB, it.id)).slice(have).map(p => p.r2_key);
  if (added.length && it.status === 'live') c.executionCtx.waitUntil((async () => { for (const k of added) if (!(await checkListingPhoto(c.env, it.id, k))) break; })().catch(() => {}));
  return c.redirect(`/listings/${it.id}/edit`);
});
listings.post('/listings/:id/photos/:pid/delete', requireUser, async (c) => {
  const it = await ownListing(c); if (!it) return c.notFound();
  const cover0 = (await photosFor(c.env.DB, it.id))[0]?.r2_key || null;
  const ph = await c.env.DB.prepare('SELECT r2_key FROM photos WHERE id = ? AND listing_id = ?').bind(c.req.param('pid'), it.id).first<{ r2_key: string }>();
  if (ph) { await logEvent(c.env.DB, 'listing.photo_deleted', { user: it.owner_id, listing: it.id, data: { key: ph.r2_key } }); await c.env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(c.req.param('pid')).run(); await c.env.PHOTOS.delete(ph.r2_key); await renumber(c.env, it.id); await recoverIcon(c, it.id, cover0); }
  return c.redirect(`/listings/${it.id}/edit`);
});
listings.post('/listings/:id/photos/:pid/cover', requireUser, async (c) => {
  const it = await ownListing(c); if (!it) return c.notFound();
  const cover0 = (await photosFor(c.env.DB, it.id))[0]?.r2_key || null;
  await c.env.DB.prepare('UPDATE photos SET pos = -1 WHERE id = ? AND listing_id = ?').bind(c.req.param('pid'), it.id).run();
  await renumber(c.env, it.id); await recoverIcon(c, it.id, cover0);
  return c.redirect(`/listings/${it.id}/edit`);
});

// Item value (deposit hold): owner asks for it now; one appeal, then it's final
listings.post('/listings/:id/value/now', requireUser, async (c) => {
  const u = c.get('user')!; const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  await ensureValue(c.env, it);
  return c.redirect(`/listings/${it.id}/edit`);
});
listings.get('/listings/:id/value', requireUser, async (c) => {
  const u = c.get('user')!; const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  if (!it.value_cents || it.value_appeal) return c.redirect(`/listings/${it.id}/edit`);
  return c.html(<Layout title="Item value" user={u} back={`/listings/${it.id}/edit`}>
    <form method="post" action={`/listings/${it.id}/value`} enctype="multipart/form-data" style="padding:4px 12px 40px">
      <div class="card"><b>{it.name} · {money(it.value_cents)}</b><div class="hint">{it.value_why}</div></div>
      <label class="field"><span>Why it’s wrong</span><textarea name="body" maxlength={800} required placeholder="Exact model, what’s included, what one like it sells for used"></textarea></label>
      <label class="field"><span>Receipt or label photo (optional)</span><input type="file" name="photos" accept="image/*" multiple style="height:auto;padding:10px 12px" /></label>
      <button class="btn pri full" type="submit">Look again</button>
      <div class="hint" style="margin-top:8px">One time per item · Lendo looks again and that value is final · it can go up or down · rentals already requested keep their hold</div>
      {c.req.query('err') ? <div class="flash err" style="margin:12px 0 0">Couldn’t look again just now · try in a minute</div> : null}
    </form>
  </Layout>);
});
listings.post('/listings/:id/value', requireUser, async (c) => {
  const u = c.get('user')!; const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  const f = await c.req.parseBody({ all: true }); const body = String(f.body || '').trim().slice(0, 800);
  if (!body || !it.value_cents || it.value_appeal) return c.redirect(`/listings/${it.id}/edit`);
  const files = ([] as unknown[]).concat(f.photos || []).filter((x): x is File => x instanceof File && x.size > 0 && x.size < 8_000_000).slice(0, 3);
  const keys: string[] = [];
  for (const p of files) { const key = `${it.id}/value-${Date.now()}-${keys.length}.jpg`; await c.env.PHOTOS.put(key, await p.arrayBuffer(), { httpMetadata: { contentType: p.type || 'image/jpeg' } }); keys.push(key); }
  const res = await appealValue(c.env, it, body, keys);
  return c.redirect(res === 'failed' ? `/listings/${it.id}/value?err=1` : `/listings/${it.id}/edit`);
});

listings.post('/listings/:id/edit', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  const f = await c.req.parseBody({ all: true });
  const minP = (await minPriceCents(c.env));
  const pIn = Math.round(parseFloat(String(f.price ?? '')) * 100);
  const price = isNaN(pIn) ? it.price_cents : pIn <= 0 ? 0 : Math.max(minP, pIn); /* $0 = free lend (Scott, 11/27) */
  const week = weekDefault(price); /* weekly is always automatic */
  const nm = String(f.name || it.name).trim().slice(0, 80), ds = String(f.description || '').trim().slice(0, 600) || null;
  const em = nm === it.name && it.emoji ? it.emoji : emojiFor(nm, ds); // map icon is automatic, not owner-edited
  await c.env.DB.prepare('UPDATE listings SET name = ?, description = ?, price_cents = ?, week_cents = ?, emoji = ? WHERE id = ?')
    .bind(nm, ds, price, week, em, it.id).run();
  if (nm !== it.name) { await c.env.DB.prepare('UPDATE listings SET short_name = NULL WHERE id = ?').bind(it.id).run().catch(() => {}); c.executionCtx.waitUntil(ensureShort(c.env, { id: it.id, name: nm }).catch(() => '')); }
  if (f.issues !== undefined) { const iss = String(f.issues || '').trim().slice(0, 600) || null; if (iss !== (it.issues || null)) {
    /* what's wrong with it changes what it's worth: the cron values it again (an appealed value stays) */
    await c.env.DB.prepare('UPDATE listings SET issues = ?' + (it.value_appeal ? '' : `, value_src = CASE WHEN value_cents IS NULL THEN value_src ELSE 'est' END, value_at = NULL`) + ' WHERE id = ?').bind(iss, it.id).run();
    await logEvent(c.env.DB, 'listing.issues', { user: u.id, listing: it.id, data: { now: iss, was: it.issues || null } }); } }
  await logEvent(c.env.DB, 'listing.edited', { user: u.id, listing: it.id, cents: price, data: { was: { name: it.name, price: it.price_cents, desc: it.description }, now: { name: nm, price, desc: ds } } });
  if (isGrade(f.grade)) { const gr = await shownGrade(c.env, it.id, (it as any).grade); if (!gr.customers) await c.env.DB.prepare('UPDATE listings SET grade = ? WHERE id = ?').bind(f.grade, it.id).run().catch(() => {}); }
  const today = localToday(it.lng);
  await c.env.DB.prepare('DELETE FROM blocked_days WHERE listing_id = ? AND day >= ?').bind(it.id, today).run();
  const blocks = ([] as unknown[]).concat(f.block || []).map(String).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  for (const d of blocks) await c.env.DB.prepare('INSERT OR IGNORE INTO blocked_days (listing_id, day) VALUES (?,?)').bind(it.id, d).run();
  return c.redirect('/listings?saved=' + it.id);
});

// ---------- Avatar lab (owner only): build both styles from the first photo and compare ----------
listings.get('/dev/avatar/:id', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  const photos = await photosFor(c.env.DB, it.id);
  if (!photos[0]) return c.text('no photo', 400);
  const t0 = Date.now();
  const errors: string[] = [];
  const keys = c.req.query('build') === '0' ? {} : await buildAvatars(c.env, it.id, photos[0].r2_key, (c.req.query('only') ? [c.req.query('only') as 'ai'] : ['cutout', 'ai']), errors, c.req.query('model') || undefined, it.name);
  const ms = Date.now() - t0;
  const have = { cutout: keys.cutout || `${it.id}/avatar-cutout.png`, ai: keys.ai || `${it.id}/avatar-ai.png` };
  const pin = (src: string, label: string, style: string) => (
    <div style="text-align:center">
      <div style="height:170px;background:#EAE6DC;border-radius:14px;position:relative;overflow:hidden"><div class="epin" style={'position:absolute;left:50%;top:120px'}><span class="glow"></span>{src ? <img src={'/p/' + src + '?v=' + t0} alt="" class="emo" style="object-fit:contain;filter:drop-shadow(2px 0 0 #fff) drop-shadow(-2px 0 0 #fff) drop-shadow(0 2px 0 #fff) drop-shadow(0 -2px 0 #fff) drop-shadow(0 3px 3px rgba(30,58,43,.35))" /> : <span class="emo">{it.emoji || '📦'}</span>}<span class="tag">{money(it.price_cents)}<small>/day</small></span></div></div>
      <div style="margin-top:8px;font-weight:800">{label}</div>
      <form method="post" action={'/dev/avatar/' + it.id + '/use'}><input type="hidden" name="style" value={style} /><button class="btn sm" type="submit">Use this</button></form>
    </div>
  );
  return c.html(
    <Layout title="Avatar lab" user={u} back="/listings">
      <div style="padding:12px 16px">
        <div class="hint">Built in {ms} ms · {Object.keys(keys).join(', ') || 'nothing new'} </div>
        {errors.map(e => <div class="flash err" style="margin:8px 0 0;font-size:12px;word-break:break-all">{e}</div>)}
        <img src={'/p/' + photos[0].r2_key} alt="" style="width:120px;height:120px;object-fit:cover;border-radius:12px;margin:10px 0" />
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
          {pin('', 'Emoji (current)', 'emoji')}
          {pin(keys.cutout ? have.cutout : '', 'A · Cut-out sticker', 'cutout')}
          {pin(keys.ai ? have.ai : '', 'B · AI emoji redraw', 'ai')}
        </div>
        <form method="get" style="margin-top:14px"><button class="btn full" type="submit">Regenerate</button></form>
      </div>
    </Layout>
  );
});
listings.post('/dev/avatar/:id/use', requireUser, async (c) => {
  const u = c.get('user')!;
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  const style = String((await c.req.parseBody()).style || '');
  if (style === 'emoji') await c.env.DB.prepare('UPDATE listings SET avatar_key = NULL, avatar_style = NULL WHERE id = ?').bind(it.id).run();
  else if (style === 'cutout' || style === 'ai') await c.env.DB.prepare('UPDATE listings SET avatar_key = ?, avatar_style = ? WHERE id = ?').bind(`${it.id}/avatar-${style}.png`, style, it.id).run();
  return c.redirect('/');
});

// Re-run the sticker cutout for one listing (owner only) and report what happened — used to debug Images transforms.
listings.get('/dev/avatar/:id/retry', requireUser, async (c) => {
  const u = c.get('user')!; const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.owner_id !== u.id) return c.notFound();
  const aiKey = `${it.id}/avatar-ai.png`;
  const has = await c.env.PHOTOS.head(aiKey);
  if (!has) { const ph = await photosFor(c.env.DB, it.id); if (!ph[0]) return c.text('no photo'); await autoIcon(c.env, it.id, ph[0].r2_key, it.name, it.description); const after = await listingById(c.env.DB, it.id); return c.text('ran autoIcon → avatar_key=' + after?.avatar_key); }
  try {
    const { makeCutout } = await import('../lib/avatar');
    const cut = await makeCutout(c.env, aiKey);
    if (!cut) return c.text('cutout returned null (not transparent?)');
    await c.env.PHOTOS.put(`${it.id}/avatar.png`, cut, { httpMetadata: { contentType: 'image/png' } });
    await c.env.DB.prepare('UPDATE listings SET avatar_key = ?, avatar_style = ? WHERE id = ?').bind(`${it.id}/avatar.png`, 'ai', it.id).run();
    return c.redirect('/i/' + it.id);
  } catch (e: any) { return c.text('cutout failed: ' + (e?.message || e), 500); }
});

listings.post('/dev/avatar/backfill', requireUser, async (c) => {
  const u = c.get('user')!;
  const rows = await c.env.DB.prepare(`SELECT l.id, l.name, l.description, (SELECT r2_key FROM photos p WHERE p.listing_id = l.id ORDER BY pos LIMIT 1) k FROM listings l WHERE l.owner_id = ? AND l.status != 'removed'`).bind(u.id).all<{ id: string; name: string; description: string | null; k: string | null }>();
  for (const r of rows.results) if (r.k) c.executionCtx.waitUntil(autoIcon(c.env, r.id, r.k, r.name, r.description));
  return c.text(`queued ${rows.results.length} icon jobs`);
});
