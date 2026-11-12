import { Hono, type Context } from 'hono';
import { Avatar, PhotoField, saveUserPhoto } from '../lib/userphoto';
import { shortName } from '../lib/util';
import { Grade, GRADE_WORD, shownGrade, shownGrades } from '../lib/grade';
type Ctx = Context<{ Bindings: Env; Variables: Vars }>;
import { raw } from 'hono/html';
import type { Env, Listing, Vars } from '../lib/env';
import { Layout } from '../pages/layout';
import { cutoutUrl } from '../lib/cutout';
import { CITIES } from '../lib/places';
import { counts, firstPhotos, listingById, photosFor, reputation, userById, busyDays } from '../lib/db';
import { money, fmtDay, dayStr, addDays, firstName, fuzz , starStr } from '../lib/util';
import { feeFor } from '../lib/stripe';
import { geocodePlace } from '../lib/geo';
import { assignHood, loadHoods } from '../lib/hoods';
import { handleOk } from '../lib/urls';

const TICKER = ['MAKE MONEY', 'SAVE MONEY', 'SAVE SPACE', 'MEET NEIGHBORS', 'BUY LESS', 'WASTE LESS'];

export const browse = new Hono<{ Bindings: Env; Variables: Vars }>();

const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const MAPBOX_VER = 'v3.8.0';
const MAPBOX_CSS = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VER}/mapbox-gl.css`;
const MAPBOX_JS = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VER}/mapbox-gl.js`;

// Static map for the item page (Mapbox Static Images API). Returns null without a public token.
export function staticMapUrl(env: Env, lat: number, lng: number, w = 600, h = 220, markerImg?: string | null): string | null {
  if (!env.MAPBOX_PUBLIC_TOKEN) return null;
  const style = (env.MAPBOX_STYLE_URL || 'mapbox://styles/mapbox/light-v11').replace('mapbox://styles/', '');
  const marker = markerImg ? `url-${encodeURIComponent(markerImg)}` : 'pin-l+FF4F00';
  return `https://api.mapbox.com/styles/v1/${style}/static/${marker}(${lng.toFixed(5)},${lat.toFixed(5)})/${lng.toFixed(5)},${lat.toFixed(5)},14.2,0/${w}x${h}@2x?access_token=${encodeURIComponent(env.MAPBOX_PUBLIC_TOKEN)}&logo=true&attribution=true`;
}

// ---------- Map (home) ----------
export const homePage = async (c: Ctx, opt: { center?: number[]; zoom?: number; q?: string; title?: string } = {}) => {
  const u = c.get('user');
  const k = await counts(c.env.DB, u?.hood ?? null);
  let center = u?.lat && u?.lng ? [u.lng, u.lat] : [-73.997, 40.7465]; // [lng, lat]; Chelsea default
  const cq = (c.req.query('c') || '').split(',').map(parseFloat); // ?c=lng,lat deep link (shares, debugging)
  if (cq.length === 2 && cq.every(n => !isNaN(n)) && Math.abs(cq[1]) <= 90) center = cq;
  if (opt.center) center = opt.center;
  const badge = u?.unread || 0;
  // Visitors outside a live city (by Cloudflare geo) start in NYC, the most active city, with a nudge to switch.
  const cf: any = (c.req.raw as any).cf || {};
  const vLat = parseFloat(cf.latitude), vLng = parseFloat(cf.longitude);
  const inLive = !isNaN(vLat) && !isNaN(vLng) && CITIES.some(ct => ct.id === 'nyc' && vLng >= ct.bbox[0] && vLng <= ct.bbox[2] && vLat >= ct.bbox[1] && vLat <= ct.bbox[3]);
  const away = !u?.lat && !isNaN(vLat) && !inLive;
  const mapbox = !!c.env.MAPBOX_PUBLIC_TOKEN;
  const cfg = JSON.stringify({ user: !!u, ipLoc: !isNaN(vLat) && !isNaN(vLng) ? [vLng, vLat] : null, away, visitorCity: away ? (cf.city || '') : '', wantedPromo: c.env.WANTED_PROMO === 'true', token: c.env.MAPBOX_PUBLIC_TOKEN || '', style: c.env.MAPBOX_STYLE_URL || 'mapbox://styles/mapbox/light-v11', center, zoom: opt.zoom || 14.5, q: opt.q || "", pinned: !!opt.center, hasHome: !!(u?.lat) || cq.length === 2 && cq.every(n => !isNaN(n)) });
  return c.html(
    <Layout title={u?.hood || 'Near you'} user={u} back={null} badge={badge} htmlClass="mappage"
      top={<a class="ticker" href="/about" aria-label="Why Lendo"><div class="tk" aria-hidden="true">{[0, 1].map(() => TICKER.map(t => <span>{t}<i>•</i></span>))}</div></a>}
      headerCenter={
        <div class="scope" role="group" aria-label="Where you're looking">
          <button class="scope-hood crumb" id="scHood" type="button" aria-label="Pick a neighborhood or city"><b id="scHoodN">{u?.hood || 'Near you'}</b><span class="cr-city" id="scCityS"></span><span class="cr-n" id="scHoodC">{k.hood || '…'}</span><svg width="12" height="8" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5L6 6.5L11 1.5" fill="none" stroke="#1E3A2B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
          <button class="scope-city" id="scCity" type="button" hidden><b>NYC</b><small id="scCityC">…</small></button>
          <button class="scope-globe" id="scGlobe" type="button" aria-label="Pick a city" hidden><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6F6A60" stroke-width="2"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></svg></button>
        </div>
      }
      head={mapbox ? <><link rel="stylesheet" href={MAPBOX_CSS} /><script src={MAPBOX_JS}></script></> : <><link rel="stylesheet" href={LEAFLET_CSS} /><script src={LEAFLET_JS}></script></>}>
      <div class="mapwrap">
        <div id="map" role="application" aria-label="Map of things to rent"></div>
        <div class="mapctl">
          <button class="btn sm listtoggle" id="toggle" type="button"><svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true"><path d="M1 1.5h1M4 1.5h9M1 6h1M4 6h9M1 10.5h1M4 10.5h9" stroke="#1E3A2B" stroke-width="2" stroke-linecap="round" /></svg> List</button>
          <span class="qwrap"><input id="q" type="search" placeholder="Rent a…" aria-label="Search" autocomplete="off" /><button type="button" class="qclr" id="qClr" aria-label="Clear search" hidden>×</button></span>
          <div class="alertchip" id="alertChip" hidden></div>
          <a class="rent-out" href="/list"><span class="ro-l">RENT OUT YOUR STUFF</span><span class="ro-s">RENT YOURS OUT</span></a>
        </div>
        <div class="kpi" id="kpi" hidden><b id="kpiN">{k.global}</b><span id="kpiL">things to rent</span></div>
        <button type="button" class="locbtn" id="locate" aria-label="Go to my location"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.6" fill="#1A73E8" /><circle cx="12" cy="12" r="7.2" fill="none" stroke="#1E3A2B" stroke-width="2" /><path d="M12 1.8v3.4M12 18.8v3.4M1.8 12h3.4M18.8 12h3.4" stroke="#1E3A2B" stroke-width="2" stroke-linecap="round" /></svg></button>
        <div class="wsheet" id="wsheet" role="dialog" aria-label="Wanted item" hidden>
          <button class="pcard-x" id="wsClose" aria-label="Close"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2L10 10M10 2L2 10" stroke="#fff" stroke-width="2.2" stroke-linecap="round" /></svg></button>
          <div class="wsheet-head">WANTED<small>to rent</small></div>
          <div class="wsheet-em" id="wsEm"></div>
          <div class="wsheet-name" id="wsName"></div>
          <a class="wsheet-go" id="wsGo" href="/list">List yours →</a>
        </div>
        <div class="places-dim" id="plDim" hidden></div>
        <div class="places" id="places" role="dialog" aria-label="Neighborhoods and cities" hidden>
          <div class="places-h"><b id="plTitle" hidden>Neighborhoods</b><div class="places-cities" id="plCities"></div><button type="button" class="places-x" id="plClose" aria-label="Close">×</button></div>
          <div class="places-seg" id="plSeg"><button type="button" data-s="az" class="on">A–Z</button><button type="button" data-s="rank">🏆 Most things</button><button type="button" data-s="own">Top owners</button></div>
          <div class="places-hoods" id="plHoods"></div>
        </div>
        <div class="pcard" id="sheet" role="dialog" aria-label="Selected item">
          <div class="pcard-strip">FOR RENT</div>
          <button class="pcard-x" id="shClose" aria-label="Close"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2L10 10M10 2L2 10" stroke="#fff" stroke-width="2.2" stroke-linecap="round" /></svg></button>
          <a class="pcard-body" id="shLink" href="#">
            <span class="pcard-img"><img id="shImg" alt="" /><span class="pcard-price" id="shPr"></span></span>
            <span class="pcard-txt">
              <span class="pcard-name" id="shNm"></span>
              <span class="pcard-owner" id="shOwner"></span>
              <span class="pcard-where" id="shSub"><svg width="10" height="12" viewBox="0 0 24 26" aria-hidden="true"><path d="M12 25C12 25 3 16 3 10A9 9 0 0 1 21 10C21 16 12 25 12 25Z" fill="#1E3A2B" /><circle cx="12" cy="10" r="3.4" fill="#F5F3EE" /></svg><span id="shWhere"></span></span>
            </span>
            <svg class="pcard-chev" width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><path d="M2 2L8 8L2 14" fill="none" stroke="#1E3A2B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </a>
          {!u ? <form class="promo incard" data-promo autocomplete="on" aria-label="Get $5 off this rental" hidden>
            <label class="sr">Phone number</label>
            <input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Phone #" maxlength={14} />
            <button type="submit" disabled>$5 OFF</button>
          </form> : null}
        </div>
        <div id="grid" class="aisles" style="display:none"></div>
      </div>
      {raw(`<script>window.LENDO_MAP=${cfg};</script>`)}
      {mapbox ? <><script src="/pinball.js"></script><script src="/map-style.js"></script><script src="/map.js"></script></> : <script src="/map-leaflet.js"></script>}
    </Layout>
  );
};
browse.get('/', (c) => homePage(c));

// ---------- Item ----------
export const itemPage = async (c: Ctx, lid: string, pretty = false) => {
  const u = c.get('user');
  const it = await listingById(c.env.DB, lid);
  if (!it || it.status === 'removed' || (it.status === 'review' && u?.id !== it.owner_id)) return c.notFound();
  const owner = (await userById(c.env.DB, it.owner_id))!;
  const photos = await photosFor(c.env.DB, it.id);
  const rep = await reputation(c.env.DB, owner.id);
  const today = dayStr(new Date());
  const to = addDays(today, 13);
  const busy = await busyDays(c.env.DB, it.id, today, to);
  const credit = u && (u.promo_cents || 0) > 0 && !((await c.env.DB.prepare(`SELECT COUNT(*) n FROM rentals WHERE renter_id = ? AND status IN ('held','confirmed','picked_up','returned','closed')`).bind(u.id).first<{ n: number }>())?.n) ? u.promo_cents : 0;
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const isOwner = u?.id === it.owner_id;
  const feePct = c.env.FEE_PCT;
  const review = await c.env.DB.prepare(`SELECT r.renter_review rv, u.name nm FROM rentals r JOIN users u ON u.id = r.renter_id WHERE r.owner_id = ? AND r.renter_review IS NOT NULL ORDER BY r.updated_at DESC LIMIT 1`).bind(owner.id).first<{ rv: string; nm: string }>();
  const saved = u ? !!(await c.env.DB.prepare('SELECT 1 FROM saved WHERE user_id = ? AND listing_id = ?').bind(u.id, it.id).first()) : false;
  const gr = await shownGrade(c.env, it.id, it.grade);
  const ir = await c.env.DB.prepare('SELECT COUNT(*) n, SUM(item_rating >= 3) up FROM rentals WHERE listing_id = ? AND item_rating IS NOT NULL').bind(it.id).first<{ n: number; up: number }>().catch(() => null);
  return c.html(
    <Layout title={it.name} headerCenter={<span />} user={u} flash={c.req.query('canceled') ? 'Checkout canceled — nothing was charged.' : null}>
      <div class={photos.length > 1 ? 'hero gal' : 'hero'}>
        <Grade g={gr.letter} cls="onphoto" />
        {photos[0] ? <img id="heroImg" src={cutoutUrl(c.env, photos[0].r2_key)} alt={it.name} onerror={`this.onerror=null;this.src='/p/${photos[0].r2_key}'`} /> : it.avatar_key ? <img id="heroImg" class="trimme" crossorigin="anonymous" src={'/p/' + it.avatar_key} alt={it.name} /> : <div class="hint">no photo yet</div>}
        {photos.length > 1 ? <>
          <button type="button" class="gal-nav prev" id="galPrev" aria-label="Previous photo"><svg width="12" height="18" viewBox="0 0 12 18"><path d="M9 2L3 9l6 7" fill="none" stroke="#1E3A2B" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
          <button type="button" class="gal-nav next" id="galNext" aria-label="Next photo"><svg width="12" height="18" viewBox="0 0 12 18"><path d="M3 2l6 7-6 7" fill="none" stroke="#1E3A2B" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
          <div class="gal-dots" id="galDots">{photos.map((_, i) => <i class={i ? '' : 'on'} />)}</div>
          {raw(`<script>(function(){var S=${JSON.stringify(photos.map(p => ({ c: cutoutUrl(c.env, p.r2_key), o: '/p/' + p.r2_key })))},i=0,im=document.getElementById('heroImg'),d=document.getElementById('galDots').children;
S.forEach(function(p){var x=new Image();x.src=p.c;});
function go(n){i=(n+S.length)%S.length;im.onerror=function(){this.onerror=null;this.src=S[i].o;};im.src=S[i].c;for(var k=0;k<d.length;k++)d[k].className=k===i?'on':'';}
document.getElementById('galPrev').onclick=function(){go(i-1)};document.getElementById('galNext').onclick=function(){go(i+1)};
var h=im.closest('.hero'),x0=null,y0=0;h.addEventListener('touchstart',function(e){x0=e.touches[0].clientX;y0=e.touches[0].clientY},{passive:true});
h.addEventListener('touchend',function(e){if(x0===null)return;var dx=e.changedTouches[0].clientX-x0,dy=e.changedTouches[0].clientY-y0;if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy))go(i+(dx<0?1:-1));x0=null},{passive:true});})();</script>`)}
        </> : null}
        <div class="pr"><b class="price">{money(it.price_cents)}</b><span style="font-size:15px">/day</span>
        </div>
      </div>
      <section class="sec" style="padding:12px 16px 14px">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <h2 style="margin:0;font-size:20px;font-weight:800;line-height:1.25">{(() => { const f = (owner.name || 'Neighbor').split(' ')[0]; const nm = it.name.charAt(0).toUpperCase() + it.name.slice(1); return <><span style="font-weight:500">{f + (/s$/i.test(f) ? '’ ' : '’s ')}</span>{nm}</>; })()}</h2>
          {it.status === 'paused' ? <span class="pill">paused</span> : it.status === 'review' ? <span class="pill">Posted · checking the photo</span> : null}
          {isOwner ? <a class="btn sm" href={'/listings/' + it.id + '/edit'} style="flex-shrink:0;margin-left:8px">✎ Edit</a> : null}
        </div>
        <div class="hint" style="margin-top:2px">Condition {gr.letter} · {GRADE_WORD[gr.letter]} · {gr.customers ? `owner + ${gr.customers} customer${gr.customers === 1 ? '' : 's'}` : 'set by the owner'}{ir?.n ? ` · 👍 ${ir.up || 0} of ${ir.n}` : ''}</div>
        {it.description ? <p style="margin:4px 0 0;font-size:14px;line-height:1.4;color:var(--ink2);white-space:pre-wrap">{it.description}</p> : null}
        {!isOwner && it.status === 'live' ? <a class="askbtn" href={it.demo ? '#' : '/i/' + it.id + '/ask'} onclick={it.demo ? "event.preventDefault();toast('Demo item — messaging is off')" : undefined}>💬 Ask {(owner.name || 'the owner').split(' ')[0]} a question</a> : null}
        <div class="row" style="gap:8px;align-items:center"><a href={'/u/' + owner.id} class="owner-row owner-tight" style="flex:1;min-width:0">
          <Avatar name={owner.name} photo={owner.photo_key} size={32} />
          <span class="owner-txt"><b>{shortName(owner.name)}</b><small>{rep.as_owner_avg ? `${starStr(rep.as_owner_avg)} · ${rep.rentals} rentals` : 'new'} · {rep.listed} listed{owner.hood ? ' · ' + owner.hood : ''}</small></span>
          <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><path d="M2 2L8 8L2 14" fill="none" stroke="#1E3A2B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </a>{!isOwner && !it.demo && it.status === 'live' ? <a class="chatbtn" href={'/i/' + it.id + '/ask'} aria-label={'Message ' + firstName(owner.name)}><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="#1E3A2B" stroke-width="2.2" stroke-linejoin="round" /></svg></a> : null}</div>
        {!isOwner && it.status === 'live' ? (
          <form method="post" action={'/i/' + it.id + '/rent'} id="rentForm">
            <div class="quick" id="quick" style="display:flex;gap:8px;margin-top:14px">
              <button type="button" class="btn" data-q="1" style="flex:1;height:48px;flex-direction:column;line-height:1.1"><b style="font-size:16px">1 day</b><small style="font-size:12px;font-weight:700">{money(it.price_cents)}</small></button>
              {it.week_cents && it.week_cents < it.price_cents * 7 ? <button type="button" class="btn" data-q="7" style="flex:1.3;height:48px;flex-direction:column;line-height:1.1;position:relative"><b style="font-size:16px">1 week</b><small style="font-size:12px;font-weight:700">{money(it.week_cents)} <s style="color:var(--mute);font-weight:600">{money(it.price_cents * 7)}</s></small><span style="position:absolute;right:-6px;top:-9px;background:var(--orange);color:#fff;border:1.5px solid var(--ink);border-radius:8px;font-size:10px;font-weight:900;padding:2px 6px">{Math.round(100 - it.week_cents / (it.price_cents * 7) * 100)}% OFF</span></button> : null}
            </div>
            <div class="days-hd">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <span>{w}</span>)}</div>
            <div class="days" id="days" style={`--lead:${new Date(days[0] + 'T12:00:00Z').getUTCDay()}`}>
              {days.map((d, i) => {
                const b = busy.has(d);
                const dt = new Date(d + 'T12:00:00Z');
                const first = i === 0 || dt.getUTCDate() === 1;
                return <button type="button" class={(b ? 'busy' : '') + (i === 0 ? ' today' : '')} data-day={d} disabled={b} aria-label={fmtDay(d) + (b ? ' booked' : '')} style={i === 0 ? `grid-column-start:${dt.getUTCDay() + 1}` : ''}>
                  {i === 0 ? <small>TODAY</small> : first ? <small>{dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</small> : null}<b>{dt.getUTCDate()}</b>
                </button>;
              })}
            </div>
            
            <input type="hidden" name="start" id="start" /><input type="hidden" name="end" id="end" /><input type="hidden" name="from" id="meetFromVal" />
          </form>
        ) : null}
        {(() => { const first = (owner.name || 'Neighbor').split(' ')[0]; const spots: string[] = owner.pickup_spots ? JSON.parse(owner.pickup_spots) : []; const away = owner.lat != null && owner.lng != null && it.lat != null && it.lng != null && Math.hypot(owner.lat - it.lat, (owner.lng - it.lng) * 0.76) > 0.03; const spot = away ? `Near ${it.hood || 'the item'}` : spots[0] || `${first}’s block`; const line = away ? 'exact spot by text' : [owner.cross_streets, it.hood].filter(Boolean).join(' · ') || 'near you'; return (
          <div class="meet" id="meet">
            <div class="meet-top"><span class="meet-lbl">{first.toUpperCase()}’S MEETUP SPOT</span><span class="meet-note"><svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="#8A857B" stroke-width="2" /><path d="M12 10.5V17" stroke="#8A857B" stroke-width="2.4" stroke-linecap="round" /><circle cx="12" cy="7.2" r="1.4" fill="#8A857B" /></svg><span>You and {first}<br />confirm plans by text</span></span></div>
            <div class="meet-name"><svg width="14" height="16" viewBox="0 0 24 26" aria-hidden="true"><path d="M12 25C12 25 3 16 3 10A9 9 0 0 1 21 10C21 16 12 25 12 25Z" fill="#1E3A2B" /><circle cx="12" cy="10" r="3.4" fill="#fff" /></svg><span id="meetName">{spot}</span></div>
            <div class="meet-line" id="meetLine">{line}</div>
            {!isOwner ? <button type="button" class="meet-link" id="meetMid">Suggest meeting midway instead →</button> : null}
            {!isOwner ? <div class="meet-ask" id="meetAsk" hidden><label for="meetFrom">WHERE ARE YOU COMING FROM?</label><div style="display:flex;gap:6px;margin-top:6px"><input id="meetFrom" placeholder="e.g. Bedford & N 7th" /><button type="button" id="meetGo">Midway</button></div></div> : null}
          </div>); })()}
      </section>
      <div style="height:84px"></div>
      {it.demo ? <div class="flash" id="demoNote" hidden style="margin:0 16px 90px">This one’s a demo — Iowa City is a preview of what a Lendo neighborhood looks like full. Nothing gets charged. <a href="/list">List your real stuff →</a></div> : null}
      {!isOwner && it.status === 'live' ? (
        <div class="rentbar">
          {u ? <form method="post" action={'/i/' + it.id + '/save'}><button class="btn" type="submit" aria-label={saved ? 'Unsave' : 'Save'}>{saved ? '♥' : '♡'}</button></form> : null}
          {it.demo ? <button class="btn pri" style="flex:1" id="rentBtn" type="button" onclick="document.getElementById('demoNote').hidden=false;this.textContent='DEMO LISTING'">RENT IT</button> : <button class="btn pri" style="flex:1" id="rentBtn" disabled form="rentForm" type="submit">PICK DAYS TO RENT</button>}
        </div>
      ) : isOwner ? <div class="rentbar"><a class="btn full" href="/listings">This is yours — manage it</a></div> : null}
      {raw(`<script>
(function(){var P=${it.price_cents},W=${it.week_cents || 0},F=${parseFloat(feePct)},CR=${credit};var s=null,e=null,TODAY=(bs[0]&&bs[0].classList.contains('today'))?bs[0].dataset.day:null;var bs=[].slice.call(document.querySelectorAll('#days button'));
function price(n){if(!W)return n*P;var r=Math.floor(n/7)*W+(n%7)*P;return Math.min(r,Math.ceil(n/7)*W)}
function fmt(c){var d=c/100;return '$'+(Number.isInteger(d)?d:d.toFixed(2))}
function paint(){bs.forEach(function(b){var d=b.dataset.day;b.classList.toggle('on',!!s&&!!e&&d>=s&&d<=e||d===s)});var btn=document.getElementById('rentBtn');if(s&&e){var n=Math.round((Date.parse(e)-Date.parse(s))/864e5)+1;var r=price(n);btn.disabled=false;var wk=W&&r<n*P;btn.textContent='RENT '+(n===1&&s===TODAY?'TODAY':n===7&&wk?'1 WEEK':n+(n===1?' DAY':' DAYS'))+' · '+fmt(Math.max(Math.round(r*(1+F/100))-CR,Math.min(50,Math.round(r*(1+F/100)))))+(CR?' · $5 OFF':wk?' · WEEK RATE':'');document.querySelectorAll('#quick button').forEach(function(x){x.classList.toggle('pri',(x.dataset.q==='7'&&n===7)||(x.dataset.q==='1'&&n===1))});document.getElementById('start').value=s;document.getElementById('end').value=e}else{btn.disabled=true;btn.textContent='PICK DAYS TO RENT'}}
var pend=false;
document.querySelectorAll('#quick button').forEach(function(q){q.addEventListener('click',function(){var n=+q.dataset.q,free=bs.filter(function(x){return !x.disabled});for(var i=0;i<free.length;i++){var ok=true,a=free[i].dataset.day,z=null;for(var k=0;k<n;k++){var dd=new Date(Date.parse(a)+k*864e5).toISOString().slice(0,10);var m=bs.filter(function(x){return x.dataset.day===dd})[0];if(!m||m.disabled){ok=false;break}z=dd}if(ok){s=a;e=z;pend=false;break}}document.querySelectorAll('#quick button').forEach(function(x){x.classList.toggle('pri',x===q)});paint()})});
bs.forEach(function(b){b.addEventListener('click',function(){var d=b.dataset.day;document.querySelectorAll('#quick button').forEach(function(x){x.classList.remove('pri')});if(b.disabled)return;if(!pend){s=d;e=d;pend=true}else{if(d<s){s=d;e=d;pend=true}else{var ok=true;bs.forEach(function(x){if(x.disabled&&x.dataset.day>s&&x.dataset.day<d)ok=false});if(!ok){s=d;e=d;pend=true}else{e=d;pend=false}}}paint()})});
(function(){var im=document.querySelector('img.trimme');if(!im)return;var go=function(){try{var c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;var g=c.getContext('2d');g.drawImage(im,0,0);var d=g.getImageData(0,0,c.width,c.height).data,x0=c.width,y0=c.height,x1=0,y1=0;for(var y=0;y<c.height;y++)for(var x=0;x<c.width;x++){if(d[(y*c.width+x)*4+3]>8){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}}if(x1<=x0)return;var p=6,w=x1-x0+1+p*2,h=y1-y0+1+p*2,o=document.createElement('canvas');o.width=w;o.height=h;o.getContext('2d').drawImage(c,x0-p,y0-p,w,h,0,0,w,h);im.src=o.toDataURL();im.classList.remove('trimme')}catch(e){}};if(im.complete&&im.naturalWidth)go();else im.addEventListener('load',go,{once:true})})();
if(TODAY&&!bs[0].disabled){s=e=TODAY;paint()}
var mm=document.getElementById('meetMid');if(mm){mm.addEventListener('click',function(){document.getElementById('meetAsk').hidden=false;mm.hidden=true;document.getElementById('meetFrom').focus()});document.getElementById('meetGo').addEventListener('click',function(){var v=document.getElementById('meetFrom').value.trim();if(v.length<3)return;document.getElementById('meetFromVal').value=v;var nm=document.getElementById('meetName'),ln=document.getElementById('meetLine');nm.textContent='Finding a spot…';ln.textContent='';document.getElementById('meetAsk').hidden=true;document.querySelector('.meet-lbl').textContent='MIDWAY MEETUP SPOT';fetch('/api/meetup/preview?listing=${it.id}&from='+encodeURIComponent(v)).then(function(r){return r.json()}).then(function(j){var sp=j.spots&&j.spots[0];if(sp){nm.textContent=sp.name;ln.textContent=(sp.address||'')+(sp.walk_owner_min!=null&&sp.walk_renter_min!=null?' · ~'+sp.walk_renter_min+' min for you, ~'+sp.walk_owner_min+' for them':'')}else{nm.textContent='Midway spot';ln.textContent='we’ll pick a café by text once it’s a go'}}).catch(function(){nm.textContent='Midway spot';ln.textContent='we’ll pick a café by text once it’s a go'})})}
})();
</script>`)}
    </Layout>
  );
};
browse.get('/i/:id', async (c) => {
  // old links → readable URL when there is one
  const r = await c.env.DB.prepare('SELECT l.slug, u.handle FROM listings l JOIN users u ON u.id = l.owner_id WHERE l.id = ?').bind(c.req.param('id')).first<{ slug: string | null; handle: string | null }>().catch(() => null);
  if (r?.slug && r.handle) return c.redirect(`/${r.handle}/${r.slug}`, 301);
  return itemPage(c, c.req.param('id'));
});

browse.post('/i/:id/save', async (c) => {
  const u = c.get('user');
  if (!u) return c.redirect('/login?next=' + encodeURIComponent('/i/' + c.req.param('id')));
  const lid = c.req.param('id');
  const ex = await c.env.DB.prepare('SELECT 1 FROM saved WHERE user_id = ? AND listing_id = ?').bind(u.id, lid).first();
  if (ex) await c.env.DB.prepare('DELETE FROM saved WHERE user_id = ? AND listing_id = ?').bind(u.id, lid).run();
  else await c.env.DB.prepare('INSERT INTO saved (user_id, listing_id, created_at) VALUES (?,?,?)').bind(u.id, lid, Date.now()).run();
  return c.redirect('/i/' + lid);
});

browse.get('/saved', async (c) => {
  const u = c.get('user');
  if (!u) return c.redirect('/login?next=/saved');
  const rows = await c.env.DB.prepare(`SELECT l.* FROM saved s JOIN listings l ON l.id = s.listing_id WHERE s.user_id = ? AND l.status != 'removed' ORDER BY s.created_at DESC`).bind(u.id).all<Listing>();
  const ph = await firstPhotos(c.env.DB, rows.results.map(r => r.id));
  return c.html(
    <Layout title="Saved" user={u}>
      <div class="itemgrid">
        {rows.results.length ? rows.results.map(it => (
          <a class="itemcard" href={'/i/' + it.id}>{ph[it.id] ? <img src={'/p/' + ph[it.id]} alt="" /> : <div class="ph">no photo</div>}<div class="b"><div class="pr">{money(it.price_cents)}<span style="font-size:11px;font-weight:700">/day</span></div><div class="nm">{it.name}</div></div></a>
        )) : <div class="hint" style="grid-column:1/-1;padding:24px">Nothing saved yet. Tap ♡ on an item.</div>}
      </div>
    </Layout>
  );
});

// ---------- Profile ----------
export const personPage = async (c: Ctx, uid: string) => {
  const u = c.get('user');
  const who = await userById(c.env.DB, uid);
  if (!who) return c.notFound();
  const me = u?.id === who.id;
  const rep = await reputation(c.env.DB, who.id);
  const items = await c.env.DB.prepare(`SELECT * FROM listings WHERE owner_id = ? AND status = 'live' ORDER BY created_at DESC`).bind(who.id).all<Listing>();
  const ph = await firstPhotos(c.env.DB, items.results.map(r => r.id));
  const reviews = await c.env.DB.prepare(`SELECT r.renter_rating st, r.renter_review rv, r.updated_at at, u.name nm, l.name item, 'as owner' tag FROM rentals r JOIN users u ON u.id = r.renter_id JOIN listings l ON l.id = r.listing_id WHERE r.owner_id = ? AND r.renter_rating IS NOT NULL
    UNION ALL SELECT r.owner_rating, r.owner_review, r.updated_at, u.name, l.name, 'as renter' FROM rentals r JOIN users u ON u.id = r.owner_id JOIN listings l ON l.id = r.listing_id WHERE r.renter_id = ? AND r.owner_rating IS NOT NULL ORDER BY at DESC LIMIT 50`).bind(who.id, who.id).all<{ st: number; rv: string | null; at: number; nm: string | null; item: string; tag: string }>();
  const promoN = me ? ((await c.env.DB.prepare(`SELECT COUNT(*) n FROM listings WHERE owner_id = ? AND status IN ('live','paused') AND demo = 0`).bind(who.id).first<{ n: number }>())?.n ?? 0) : null;
  const grades = await shownGrades(c.env, items.results);
  // 👍 count across everything neighbors said about them (as owner and as customer)
  const th = await c.env.DB.prepare(`SELECT SUM(st >= 3) up, COUNT(*) n FROM (SELECT renter_rating st FROM rentals WHERE owner_id = ?1 AND renter_rating IS NOT NULL UNION ALL SELECT owner_rating FROM rentals WHERE renter_id = ?1 AND owner_rating IS NOT NULL)`).bind(who.id).first<{ up: number; n: number }>().catch(() => null);
  const since = new Date(who.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const nItems = items.results.length;
  return c.html(
    <Layout title={me ? 'Profile' : (who.name || 'Neighbor')} user={u}>
      <section class="sec" style="border-bottom:0">
        <div class="pf-head">
          {(() => {
            // their things orbit the photo (up to 8)
            const orb = items.results.slice(0, 8), R = 55; // ~35% of each item overlaps the photo
            return <div class="pf-orbit">
              <Avatar name={who.name} photo={who.photo_key} size={96} />
              <div class="pf-ring">{orb.map((it, i) => { const a = (-90 + i * (360 / Math.max(orb.length, 6))) * Math.PI / 180; const src = it.avatar_key || ph[it.id];
                return <a class={'pf-sat' + (it.avatar_key ? '' : ' ph')} href={'/i/' + it.id} style={`left:${(75 + Math.cos(a) * R - 22).toFixed(1)}px;top:${(75 + Math.sin(a) * R - 22).toFixed(1)}px`} title={it.name}>{src ? <img src={'/p/' + src} alt="" data-trim={it.avatar_key ? '1' : undefined} /> : <span>{it.emoji || '📦'}</span>}</a>; })}</div>
            </div>;
          })()}
          <div style="flex:1;min-width:0">
            <div class="pf-name">{who.name || 'Neighbor'}</div>
            <div class="pf-sub">{who.hood || ''}{who.hood ? <br /> : null}Lendo since {since}</div>
            {me && (who as any).handle ? <a class="pf-link" href="/profile/edit#handle">lendo.co/{(who as any).handle} · change</a> : null}
          </div>
          {me ? <a class="btn sm" href="/profile/edit" style="width:auto">Edit</a> : null}
        </div>
        {me ? <a class="btn pri full" style="margin-top:14px" href="/list">LIST MORE STUFF</a> : null}
        {me && promoN !== null ? (
          <div class="card" style="padding:14px;margin-top:14px">
            <b style="font-size:17px">List 10 things, get $10</b>
            <div style="height:10px;border-radius:5px;background:#ECE8E0;margin:10px 0 8px;overflow:hidden"><i style={`display:block;height:100%;width:${Math.min(100, promoN * 10)}%;background:var(--orange)`} /></div>
            <div class="hint">{promoN >= 10 ? '10 of 10 · Lendo will text you to set up a 2-min FaceTime to check the items · $10 sent next day' : `${promoN} of 10 · then a 2-min FaceTime to check the items · $10 sent next day`}</div>
          </div>
        ) : null}
        <div class="pfcard">
          <div class="pfband">{nItems ? `${nItems} thing${nItems === 1 ? '' : 's'} to rent` : 'Nothing listed yet'}</div>
          {nItems ? <div class="pfbody"><div class="pgrid">
            {items.results.map(it => (
              <a class="pitem" href={'/i/' + it.id}>
                <div class="pic">
                  {it.avatar_key ? <img src={'/p/' + it.avatar_key} alt="" data-trim="1" /> : ph[it.id] ? <img class="ph" src={'/p/' + ph[it.id]} alt="" loading="lazy" /> : <span style="font-size:44px">{it.emoji || '📦'}</span>}
                  <Grade g={grades[it.id] || 'A'} cls="tiny" />
                </div>
                <span class="ptag">{money(it.price_cents)}<small>/day</small></span>
                <div class="pnm">{it.name}</div>
              </a>
            ))}
          </div></div> : null}
        </div>
        <div class="pfcard">
          <div class="pfband">{th?.n ? `👍 ${th.up || 0} of ${th.n} neighbor${th.n === 1 ? '' : 's'}` : 'No reviews yet'}</div>
          {reviews.results.length ? <div class="pfbody">
            {reviews.results.map(r => (
              <div class="prev">
                <div class="q">{r.st >= 3 ? '👍' : '👎'} {r.rv ? `“${r.rv}”` : (r.st >= 3 ? 'Thumbs up' : 'Thumbs down')}</div>
                <div class="w">{firstName(r.nm)} · {r.item} · {new Date(r.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
              </div>
            ))}
          </div> : null}
        </div>
      </section>
      <script src="/trim.js"></script>
      {nItems >= 10 ? <>
        <script src="/pinball.js"></script>
        {raw(`<script>lendoBounce(${JSON.stringify(String(nItems))}, ${Math.min(nItems, 40)}, 5000)</script>`)}
      </> : null}
    </Layout>
  );
};
browse.get('/u/:id', async (c) => {
  const r = await c.env.DB.prepare('SELECT handle FROM users WHERE id = ?').bind(c.req.param('id')).first<{ handle: string | null }>().catch(() => null);
  if (r?.handle) return c.redirect(`/${r.handle}`, 301);
  return personPage(c, c.req.param('id'));
});

browse.get('/profile/edit', async (c) => {
  const u = c.get('user');
  if (!u) return c.redirect('/login?next=/profile/edit');
  const spotsArr: string[] = (() => { try { return u.pickup_spots ? JSON.parse(u.pickup_spots) : []; } catch { return []; } })();
  return c.html(
    <Layout title="Edit profile" user={u} back={'/u/' + u.id} flashErr={c.req.query('err') === 'taken' ? 'That link is taken — try another' : c.req.query('err') === 'handle' ? 'Links use 2–24 lowercase letters, numbers or dashes' : undefined}>
      <form method="post" action="/profile/edit" enctype="multipart/form-data" style="padding:12px 16px 40px">
        <PhotoField name={u.name} photo={u.photo_key} label="Your photo (optional)" />
        <label class="field"><span>Your name</span><input name="name" value={u.name || ''} placeholder="Fiona Smith" required maxlength={40} /></label>
        <label class="field" id="handle"><span>Your Lendo link (you can change it)</span><div style="display:flex;align-items:center;gap:2px"><b style="font-size:16px;color:#6F6A60">lendo.co/</b><input name="handle" value={(u as any).handle || ''} placeholder="yourname" pattern="[a-z0-9][a-z0-9-]{1,23}" maxlength={24} autocapitalize="none" autocomplete="off" style="flex:1" /></div></label>
        <label class="field" style="position:relative"><span>Pickup address (private — renters only see cross streets)</span><input name="address" id="addr" value={u.address || ''} placeholder="Street address" maxlength={160} autocomplete="off" /><div id="addrSug" class="card" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:50;padding:4px;margin-top:4px"></div></label>
        <label class="field"><span>Cross streets (public)</span><input name="cross_streets" value={u.cross_streets || ''} placeholder="W 22nd & 9th Ave" maxlength={80} /></label>
        <div class="field"><span>Meetup spots (customers see these)</span>
          <input type="hidden" name="pickup_spots_json" id="spotsVal" />
          <div id="spotsPick" class="spotpick" />
        </div>
        <script src="/spots.js"></script>
        {raw(`<script>lendoSpots({root:'spotsPick',input:'spotsVal',token:${JSON.stringify(c.env.MAPBOX_PUBLIC_TOKEN || '')},center:${u.lat != null && u.lng != null ? JSON.stringify([u.lng, u.lat]) : 'null'},cross:${JSON.stringify(u.cross_streets || '')},initial:${JSON.stringify(spotsArr).replace(/</g, '\\u003c')}})</script>`)}
        <label class="field"><span>Neighborhood</span><input name="hood" value={u.hood || ''} placeholder="Start typing… Chelsea" maxlength={60} list="hoodList" autocomplete="off" /></label>
        <datalist id="hoodList">{CITIES.flatMap(ct => ct.hoods.map(h => <option value={h.name}>{ct.name}</option>))}</datalist>
        <input type="hidden" name="lat" id="lat" value={u.lat ?? ''} /><input type="hidden" name="lng" id="lng" value={u.lng ?? ''} />
        <button type="button" class="btn sm" onclick="navigator.geolocation.getCurrentPosition(function(p){lat.value=p.coords.latitude;lng.value=p.coords.longitude;toast('Location set')})">📍 Use my location as home base</button>
        <div style="margin-top:16px"><button class="btn pri full" type="submit">Save</button></div>
        
      </form>
      {c.env.MAPBOX_PUBLIC_TOKEN ? raw(`<script>
(function(){var tok=${JSON.stringify(c.env.MAPBOX_PUBLIC_TOKEN)},sess=(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2)),inp=document.getElementById('addr'),box=document.getElementById('addrSug'),t;
inp.addEventListener('input',function(){clearTimeout(t);var q=inp.value.trim();if(q.length<3){box.style.display='none';return}t=setTimeout(function(){
var u='https://api.mapbox.com/search/searchbox/v1/suggest?q='+encodeURIComponent(q)+'&access_token='+tok+'&session_token='+sess+'&country=US&types=address,street,poi&limit=5'+(navigator.geolocation?'':'');
fetch(u).then(function(r){return r.json()}).then(function(j){var s=j.suggestions||[];if(!s.length){box.style.display='none';return}box.innerHTML=s.map(function(x){return '<button type="button" class="btn sm full" style="justify-content:flex-start;border:0;height:auto;padding:8px;text-align:left;font-weight:600" data-a="'+(x.full_address||x.name).replace(/"/g,'&quot;')+'">'+(x.name||'')+'<span class="hint" style="margin-left:6px">'+(x.place_formatted||'')+'</span></button>'}).join('');box.style.display='block'})},250)});
box.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;inp.value=b.dataset.a;box.style.display='none'});
document.addEventListener('click',function(e){if(!box.contains(e.target)&&e.target!==inp)box.style.display='none'});})();
</script>`) : null}
    </Layout>
  );
});

browse.post('/profile/edit', async (c) => {
  const u = c.get('user');
  if (!u) return c.redirect('/login');
  const f = await c.req.parseBody();
  if (f.photo) await saveUserPhoto(c.env, u.id, f.photo).catch(e => console.warn('photo save', e));
  const hNew = String(f.handle || '').trim().toLowerCase();
  if (hNew && hNew !== (u as any).handle) {
    if (!handleOk(hNew)) return c.redirect('/profile/edit?err=handle');
    const taken = await c.env.DB.prepare('SELECT 1 FROM old_handles WHERE handle = ? AND user_id != ?').bind(hNew, u.id).first().catch(() => null);
    if (taken) return c.redirect('/profile/edit?err=taken');
    const r = await c.env.DB.prepare('UPDATE users SET handle = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM users WHERE handle = ?)').bind(hNew, u.id, hNew).run().catch(() => null);
    // the old link keeps working
    if (r?.meta.changes && (u as any).handle) await c.env.DB.prepare('INSERT OR REPLACE INTO old_handles (handle, user_id, created_at) VALUES (?,?,?)').bind((u as any).handle, u.id, Date.now()).run().catch(() => {});
    if (!r?.meta.changes) return c.redirect('/profile/edit?err=taken');
  }
  let spots: string[] = [];
  try { const j = JSON.parse(String(f.pickup_spots_json || '[]')); if (Array.isArray(j)) spots = j.map(s => String(s).trim().slice(0, 80)).filter(Boolean).slice(0, 6); } catch { /* keep empty */ }
  let lat = parseFloat(String(f.lat || '')), lng = parseFloat(String(f.lng || ''));
  const xs = String(f.cross_streets || '').trim(), hd = String(f.hood || '').trim(), addr = String(f.address || '').trim().slice(0, 160);
  let mapboxId: string | null = u.mapbox_id, geocodedAt: number | null = u.geocoded_at, hoodOut = hd || null;
  if (addr && (addr !== (u.address || '') || u.lat == null)) {
    // address set/changed → permanent geocode (server-side, secret token); the address wins over GPS
    const g = await geocodePlace(c.env, addr);
    if (g) { lat = g.lat; lng = g.lng; mapboxId = g.mapbox_id; geocodedAt = Date.now(); if (!hoodOut && g.hood_hint) hoodOut = g.hood_hint; }
  } else if (isNaN(lat) && (xs !== (u.cross_streets || '') || u.lat == null) && (xs || hd)) {
    // no address, no GPS: place the home base from cross streets (+ hood), else the hood alone
    const g = (xs ? await geocodePlace(c.env, xs + (hd ? ', ' + hd : '')) : null) || (hd ? await geocodePlace(c.env, hd) : null);
    if (g) { lat = g.lat; lng = g.lng; mapboxId = g.mapbox_id; geocodedAt = g.mapbox_id ? Date.now() : null; }
  }
  await c.env.DB.prepare('UPDATE users SET name = ?, cross_streets = ?, pickup_spots = ?, hood = ?, lat = COALESCE(?, lat), lng = COALESCE(?, lng), address = ?, mapbox_id = ?, geocoded_at = ? WHERE id = ?')
    .bind(String(f.name || '').trim().slice(0, 40) || null, String(f.cross_streets || '').trim().slice(0, 80) || null, spots.length ? JSON.stringify(spots) : null,
      hoodOut ? hoodOut.slice(0, 60) : null, isNaN(lat) ? null : lat, isNaN(lng) ? null : lng, addr || null, mapboxId, geocodedAt, u.id).run();
  const me = (await userById(c.env.DB, u.id))!;
  if (me.lat != null && me.lng != null) {
    try { await assignHood(c.env, 'users', u.id, me.lat, me.lng); } catch (e) { console.warn('hood assign', e); }
    const orphans = await c.env.DB.prepare('SELECT id FROM listings WHERE owner_id = ? AND lat IS NULL').bind(u.id).all<{ id: string }>();
    for (const o of orphans.results) { const [fl, fg] = fuzz(me.lat, me.lng); await c.env.DB.prepare('UPDATE listings SET lat = ?, lng = ?, hood = COALESCE(hood, ?) WHERE id = ?').bind(fl, fg, me.hood, o.id).run(); try { await assignHood(c.env, 'listings', o.id, fl, fg); } catch {} }
  }
  return c.redirect('/u/' + u.id);
});

// ---------- About ----------
browse.get('/about', (c) => {
  const u = c.get('user');
  const G = ['Tife ranezu so raplemo ne grine ne grirami ke romira mifera. Zu pa sopa za kenemi pleta bano quane ple zadu ta rasen.', 'Midudu soquata nonene talo neraba paromi. Palo senso no zaqua ta mo tiba fe tane no zuvi. Zuvi grisosen keti za ke kebota zavipa.', 'Gri soquami tilo quarosen ranosen fefefe. Ta feramo mo zalu quara bo tizulu quabo mo.', 'Tiro soqua talu ta tata neti ba bavi loza bomople. Lo boplepa nelovi sozaso zu pleduro qua ke. Bake ple soba bo tavi lo sonoba sone lu ta du ta.'];
  return c.html(
    <Layout title="Why Lendo" user={u}>
      <section class="sec" style="border-bottom:0;font-size:15px;line-height:1.5">
        <h2 style="font-size:26px;font-weight:900;letter-spacing:-.02em;margin:0 0 10px">Zu mi zusen.</h2>
      </section>
      <figure class="flywheel" id="flywheel">
        <img src="/flywheel.svg" width="532" height="418" alt="The Lendo flywheel: more items listed, more convenient, more rentals, then more money saved and earned, more ratings and trust, more fun, and more neighbors met, which bring more people to try, which brings more items listed. At the center: more local connection and affordability." />
      </figure>
      <section class="sec" style="border-bottom:0;font-size:15px;line-height:1.5;padding-top:0">
        {G.map(t => <p>{t}</p>)}
        <p><b>{c.env.FEE_PCT}% fee (will stay low).</b></p>
        <a class="btn pri full" href="/list" style="margin-top:12px">Rent out your stuff</a>
      </section>
    </Layout>
  );
});

// ---------- Photos (R2) ----------
browse.get('/p/:key{.+}', async (c) => {
  const key = c.req.param('key');
  // rental files (pickup/return photos, signed promise) only for the two people in that rental
  const rm = key.match(/^rentals\/([^/]+)\//);
  if (rm) { const u = c.get('user'); const r = u ? await c.env.DB.prepare('SELECT owner_id, renter_id FROM rentals WHERE id = ?').bind(rm[1]).first<{ owner_id: string; renter_id: string }>() : null; if (!r || (r.owner_id !== u!.id && r.renter_id !== u!.id)) return c.notFound(); }
  const obj = await c.env.PHOTOS.get(key);
  if (!obj) return c.notFound();
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set('etag', obj.httpEtag);
  h.set('cache-control', rm ? 'private, max-age=3600' : 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers: h });
});
