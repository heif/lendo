import { Hono } from 'hono';
import { raw } from 'hono/html';
import type { Env, Listing, Vars } from '../lib/env';
import { Layout } from '../pages/layout';
import { cutoutUrl } from '../lib/cutout';
import { CITIES } from '../lib/places';
import { counts, firstPhotos, listingById, photosFor, reputation, userById, busyDays } from '../lib/db';
import { money, fmtDay, dayStr, addDays, firstName, fuzz } from '../lib/util';
import { feeFor } from '../lib/stripe';
import { geocodePlace } from '../lib/geo';
import { assignHood, loadHoods } from '../lib/hoods';

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
browse.get('/', async (c) => {
  const u = c.get('user');
  const k = await counts(c.env.DB, u?.hood ?? null);
  let center = u?.lat && u?.lng ? [u.lng, u.lat] : [-73.997, 40.7465]; // [lng, lat]; Chelsea default
  const cq = (c.req.query('c') || '').split(',').map(parseFloat); // ?c=lng,lat deep link (shares, debugging)
  if (cq.length === 2 && cq.every(n => !isNaN(n)) && Math.abs(cq[1]) <= 90) center = cq;
  const badge = u ? ((await c.env.DB.prepare(`SELECT COUNT(*) n FROM rentals WHERE owner_id = ? AND status = 'held'`).bind(u.id).first<{ n: number }>())?.n ?? 0) : 0;
  // Visitors outside a live city (by Cloudflare geo) start in NYC, the most active city, with a nudge to switch.
  const cf: any = (c.req.raw as any).cf || {};
  const vLat = parseFloat(cf.latitude), vLng = parseFloat(cf.longitude);
  const inLive = !isNaN(vLat) && !isNaN(vLng) && CITIES.some(ct => ct.id === 'nyc' && vLng >= ct.bbox[0] && vLng <= ct.bbox[2] && vLat >= ct.bbox[1] && vLat <= ct.bbox[3]);
  const away = !u?.lat && !isNaN(vLat) && !inLive;
  const mapbox = !!c.env.MAPBOX_PUBLIC_TOKEN;
  const cfg = JSON.stringify({ away, visitorCity: away ? (cf.city || '') : '', wantedPromo: c.env.WANTED_PROMO === 'true', token: c.env.MAPBOX_PUBLIC_TOKEN || '', style: c.env.MAPBOX_STYLE_URL || 'mapbox://styles/mapbox/light-v11', center, zoom: 14.5, hasHome: !!(u?.lat) || cq.length === 2 && cq.every(n => !isNaN(n)) });
  return c.html(
    <Layout title={u?.hood || 'Near you'} user={u} back={null} badge={badge} htmlClass="mappage"
      top={<a class="ticker" href="/about" aria-label="Why Lendo"><div class="tk" aria-hidden="true">{[0, 1].map(() => TICKER.map(t => <span>{t}<i>•</i></span>))}</div></a>}
      headerCenter={
        <div class="scope" role="group" aria-label="Where you're looking">
          <button class="scope-hood" id="scHood" type="button"><b id="scHoodN">{u?.hood || 'Near you'}</b><small><span id="scHoodC">{k.hood || k.global}</span> to rent</small><svg width="12" height="8" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5L6 6.5L11 1.5" fill="none" stroke="#1E3A2B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
          <button class="scope-city" id="scCity" type="button"><b>NYC</b><small id="scCityC">{k.global}</small></button>
          <button class="scope-globe" id="scGlobe" type="button" aria-label="Everywhere"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6F6A60" stroke-width="2"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></svg></button>
        </div>
      }
      head={mapbox ? <><link rel="stylesheet" href={MAPBOX_CSS} /><script src={MAPBOX_JS}></script></> : <><link rel="stylesheet" href={LEAFLET_CSS} /><script src={LEAFLET_JS}></script></>}>
      <div class="mapwrap">
        <div id="map" role="application" aria-label="Map of things to rent"></div>
        <div class="mapctl">
          <button class="btn sm listtoggle" id="toggle" type="button"><svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true"><path d="M1 1.5h1M4 1.5h9M1 6h1M4 6h9M1 10.5h1M4 10.5h9" stroke="#1E3A2B" stroke-width="2" stroke-linecap="round" /></svg> List</button>
          <input id="q" type="search" placeholder="Rent a…" aria-label="Search" />
          <button class="btn sm" id="locate" aria-label="Use my location">📍</button>
        </div>
        <a class="rent-out" href="/list">RENT OUT YOUR STUFF</a>
        <div class="kpi" id="kpi" hidden><b id="kpiN">{k.global}</b><span id="kpiL">things to rent</span></div>
        <div class="wsheet" id="wsheet" role="dialog" aria-label="Wanted item" hidden>
          <button class="pcard-x" id="wsClose" aria-label="Close"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2L10 10M10 2L2 10" stroke="#fff" stroke-width="2.2" stroke-linecap="round" /></svg></button>
          <div class="wsheet-head">WANTED<small>to rent</small></div>
          <div class="wsheet-em" id="wsEm"></div>
          <div class="wsheet-name" id="wsName"></div>
          <a class="wsheet-go" id="wsGo" href="/list">List yours →</a>
        </div>
        <div class="places-dim" id="plDim" hidden></div>
        <div class="places" id="places" role="dialog" aria-label="Neighborhoods and cities" hidden>
          <div class="places-h"><b id="plTitle">Neighborhoods</b><button type="button" class="places-x" id="plClose" aria-label="Close">×</button></div>
          <div class="places-cities" id="plCities"></div>
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
            <input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Phone # for $5 off this" maxlength={14} />
            <button type="submit" disabled>$5 OFF</button>
          </form> : null}
        </div>
        <div id="grid" class="itemgrid" style="display:none;position:absolute;inset:0;overflow:auto;background:var(--cream);z-index:450;align-content:start;padding-top:64px"></div>
      </div>
      {raw(`<script>window.LENDO_MAP=${cfg};</script>`)}
      {mapbox ? <><script src="/map-style.js"></script><script src="/map.js"></script></> : <script src="/map-leaflet.js"></script>}
    </Layout>
  );
});

// ---------- Item ----------
browse.get('/i/:id', async (c) => {
  const u = c.get('user');
  const it = await listingById(c.env.DB, c.req.param('id'));
  if (!it || it.status === 'removed') return c.notFound();
  const owner = (await userById(c.env.DB, it.owner_id))!;
  const photos = await photosFor(c.env.DB, it.id);
  const rep = await reputation(c.env.DB, owner.id);
  const today = dayStr(new Date());
  const to = addDays(today, 13);
  const busy = await busyDays(c.env.DB, it.id, today, to);
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const isOwner = u?.id === it.owner_id;
  const feePct = c.env.FEE_PCT;
  const review = await c.env.DB.prepare(`SELECT r.renter_review rv, u.name nm FROM rentals r JOIN users u ON u.id = r.renter_id WHERE r.owner_id = ? AND r.renter_review IS NOT NULL ORDER BY r.updated_at DESC LIMIT 1`).bind(owner.id).first<{ rv: string; nm: string }>();
  const saved = u ? !!(await c.env.DB.prepare('SELECT 1 FROM saved WHERE user_id = ? AND listing_id = ?').bind(u.id, it.id).first()) : false;
  return c.html(
    <Layout title="Item" user={u} flash={c.req.query('canceled') ? 'Checkout canceled — nothing was charged.' : null}>
      <div class="hero">
        {photos[0] ? <img id="heroImg" src={cutoutUrl(c.env, photos[0].r2_key)} alt={it.name} onerror={`this.onerror=null;this.src='/p/${photos[0].r2_key}'`} /> : it.avatar_key ? <img id="heroImg" src={'/p/' + it.avatar_key} alt={it.name} style="padding:40px;box-sizing:border-box" /> : <div class="hint">no photo yet</div>}
        <div class="pr"><b class="price">{money(it.price_cents)}</b><span style="font-size:15px">/day</span>
        </div>
      </div>
      {photos.length > 1 ? <div class="thumbs">{photos.map(p => <img src={cutoutUrl(c.env, p.r2_key, 160, 160)} alt="" data-full={cutoutUrl(c.env, p.r2_key)} onclick={`document.getElementById('heroImg').src=this.dataset.full`} />)}</div> : null}
      <section class="sec">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <h2 style="margin:0;font-size:19px;font-weight:800;line-height:1.3">{it.name}</h2>
          {it.status === 'paused' ? <span class="pill">paused</span> : null}
        </div>
        {it.description ? <p style="margin:8px 0 0;font-size:14px;color:var(--ink2);white-space:pre-wrap">{it.description}</p> : null}
        <div class="hint" style="margin-top:8px">{it.hood || 'near you'}{owner.cross_streets ? ' · ' + owner.cross_streets : ''}{owner.pickup_spots ? ' · meet: ' + JSON.parse(owner.pickup_spots).join(', ') : ''}</div>
        {(() => { const first = (owner.name || 'Neighbor').split(' ')[0]; const spots: string[] = owner.pickup_spots ? JSON.parse(owner.pickup_spots) : []; const spot = spots[0] || `${first}’s block`; const line = [owner.cross_streets, it.hood].filter(Boolean).join(' · ') || 'near you'; return (
          <div class="meet" id="meet">
            <div class="meet-top"><span class="meet-lbl">{first.toUpperCase()}’S MEETUP SPOT</span><span class="meet-note"><svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="#8A857B" stroke-width="2" /><path d="M12 10.5V17" stroke="#8A857B" stroke-width="2.4" stroke-linecap="round" /><circle cx="12" cy="7.2" r="1.4" fill="#8A857B" /></svg><span>You and {first}<br />confirm plans by text</span></span></div>
            <div class="meet-name"><svg width="14" height="16" viewBox="0 0 24 26" aria-hidden="true"><path d="M12 25C12 25 3 16 3 10A9 9 0 0 1 21 10C21 16 12 25 12 25Z" fill="#1E3A2B" /><circle cx="12" cy="10" r="3.4" fill="#fff" /></svg><span id="meetName">{spot}</span></div>
            <div class="meet-line" id="meetLine">{line}</div>
            {!isOwner ? <button type="button" class="meet-link" id="meetMid">Suggest meeting midway instead →</button> : null}
            {!isOwner ? <div class="meet-ask" id="meetAsk" hidden><label for="meetFrom">WHERE ARE YOU COMING FROM?</label><div style="display:flex;gap:6px;margin-top:6px"><input id="meetFrom" placeholder="e.g. Bedford & N 7th" /><button type="button" id="meetGo">Midway</button></div></div> : null}
          </div>); })()}
        {!isOwner && it.status === 'live' ? (
          <form method="post" action={'/i/' + it.id + '/rent'} id="rentForm">
            <div class="quick" id="quick" style="display:flex;gap:8px;margin-top:14px">
              <button type="button" class="btn" data-q="1" style="flex:1;height:48px;flex-direction:column;line-height:1.1"><b style="font-size:16px">1 day</b><small style="font-size:12px;font-weight:700">{money(it.price_cents)}</small></button>
              {it.week_cents && it.week_cents < it.price_cents * 7 ? <button type="button" class="btn" data-q="7" style="flex:1.3;height:48px;flex-direction:column;line-height:1.1;position:relative"><b style="font-size:16px">1 week</b><small style="font-size:12px;font-weight:700">{money(it.week_cents)} <s style="color:var(--mute);font-weight:600">{money(it.price_cents * 7)}</s></small><span style="position:absolute;right:-6px;top:-9px;background:var(--orange);color:#fff;border:1.5px solid var(--ink);border-radius:8px;font-size:10px;font-weight:900;padding:2px 6px">{Math.round(100 - it.week_cents / (it.price_cents * 7) * 100)}% OFF</span></button> : null}
            </div>
            <div class="m" style="font-size:11px;color:var(--mute);margin-top:12px">or tap days</div>
            <div class="days" id="days">
              {days.map(d => {
                const b = busy.has(d);
                const dt = new Date(d + 'T12:00:00Z');
                return <button type="button" class={b ? 'busy' : ''} data-day={d} disabled={b} aria-label={fmtDay(d) + (b ? ' booked' : '')}>{dt.toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' })} {dt.getUTCDate()}</button>;
              })}
            </div>
            
            <input type="hidden" name="start" id="start" /><input type="hidden" name="end" id="end" /><input type="hidden" name="from" id="meetFromVal" />
          </form>
        ) : null}
      </section>
      <section class="sec">
        <div class="m" style="font-size:11px;color:var(--mute)">owner</div>
        <div class="row" style="justify-content:space-between;align-items:flex-start;margin-top:6px">
          <div>
            <a href={'/u/' + owner.id} style="font-size:17px;font-weight:700">{owner.name || 'Neighbor'}</a>
            {owner.hood ? <div style="margin-top:6px"><span class="tag">★ {owner.hood}</span></div> : null}
            <div class="hint" style="margin-top:8px">on Lendo since {new Date(owner.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>
          </div>
          <div style="text-align:right"><div class="price" style="font-size:48px;line-height:.9">{rep.listed}</div><div style="font-size:11px">items listed</div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;margin-top:14px;border:1.5px solid var(--ink);border-radius:10px;overflow:hidden">
          <div style="padding:10px;border-right:1.5px solid var(--ink)"><div class="price" style="font-size:26px;line-height:1">{rep.as_owner_avg ? '★' + rep.as_owner_avg.toFixed(1) : 'new'}</div><div style="font-size:11px;margin-top:4px">as owner · {rep.as_owner_n} ratings</div></div>
          <div style="padding:10px"><div class="price" style="font-size:26px;line-height:1">{rep.as_renter_avg ? '★' + rep.as_renter_avg.toFixed(1) : 'new'}</div><div style="font-size:11px;margin-top:4px">as renter · {rep.as_renter_n}</div></div>
        </div>
        {review ? <p style="margin:12px 0 0;font-size:13px;font-style:italic">“{review.rv}” — {firstName(review.nm)}</p> : null}
      </section>
      <section class="sec" style="border-bottom:0;padding-bottom:110px">
        <div class="hint">Card held until {firstName(owner.name)} says yes · {feePct}% fee · photo at pickup instead of a deposit</div>
      </section>
      {it.demo ? <div class="flash" id="demoNote" hidden style="margin:0 16px 90px">This one’s a demo — Iowa City is a preview of what a Lendo neighborhood looks like full. Nothing gets charged. <a href="/list">List your real stuff →</a></div> : null}
      {!isOwner && it.status === 'live' ? (
        <div class="rentbar">
          {u ? <form method="post" action={'/i/' + it.id + '/save'}><button class="btn" type="submit" aria-label={saved ? 'Unsave' : 'Save'}>{saved ? '♥' : '♡'}</button></form> : null}
          {it.demo ? <button class="btn pri" style="flex:1" id="rentBtn" type="button" onclick="document.getElementById('demoNote').hidden=false;this.textContent='DEMO LISTING'">RENT IT</button> : <button class="btn pri" style="flex:1" id="rentBtn" disabled form="rentForm" type="submit">PICK DAYS TO RENT</button>}
        </div>
      ) : isOwner ? <div class="rentbar"><a class="btn full" href="/listings">This is yours — manage it</a></div> : null}
      {raw(`<script>
(function(){var P=${it.price_cents},W=${it.week_cents || 0},F=${parseFloat(feePct)};var s=null,e=null;var bs=[].slice.call(document.querySelectorAll('#days button'));
function price(n){if(!W)return n*P;var r=Math.floor(n/7)*W+(n%7)*P;return Math.min(r,Math.ceil(n/7)*W)}
function fmt(c){var d=c/100;return '$'+(Number.isInteger(d)?d:d.toFixed(2))}
function paint(){bs.forEach(function(b){var d=b.dataset.day;b.classList.toggle('on',!!s&&!!e&&d>=s&&d<=e||d===s)});var btn=document.getElementById('rentBtn');if(s&&e){var n=Math.round((Date.parse(e)-Date.parse(s))/864e5)+1;var r=price(n);btn.disabled=false;btn.textContent='RENT '+n+(n===1?' DAY':' DAYS')+' · '+fmt(Math.round(r*(1+F/100)));document.getElementById('start').value=s;document.getElementById('end').value=e}else{btn.disabled=true;btn.textContent='PICK DAYS TO RENT'}}
var pend=false;
document.querySelectorAll('#quick button').forEach(function(q){q.addEventListener('click',function(){var n=+q.dataset.q,free=bs.filter(function(x){return !x.disabled});for(var i=0;i<free.length;i++){var ok=true,a=free[i].dataset.day,z=null;for(var k=0;k<n;k++){var dd=new Date(Date.parse(a)+k*864e5).toISOString().slice(0,10);var m=bs.filter(function(x){return x.dataset.day===dd})[0];if(!m||m.disabled){ok=false;break}z=dd}if(ok){s=a;e=z;pend=false;break}}document.querySelectorAll('#quick button').forEach(function(x){x.classList.toggle('pri',x===q)});paint()})});
bs.forEach(function(b){b.addEventListener('click',function(){var d=b.dataset.day;document.querySelectorAll('#quick button').forEach(function(x){x.classList.remove('pri')});if(b.disabled)return;if(!pend){s=d;e=d;pend=true}else{if(d<s){s=d;e=d;pend=true}else{var ok=true;bs.forEach(function(x){if(x.disabled&&x.dataset.day>s&&x.dataset.day<d)ok=false});if(!ok){s=d;e=d;pend=true}else{e=d;pend=false}}}paint()})});
var mm=document.getElementById('meetMid');if(mm){mm.addEventListener('click',function(){document.getElementById('meetAsk').hidden=false;mm.hidden=true;document.getElementById('meetFrom').focus()});document.getElementById('meetGo').addEventListener('click',function(){var v=document.getElementById('meetFrom').value.trim();if(v.length<3)return;document.getElementById('meetFromVal').value=v;var nm=document.getElementById('meetName'),ln=document.getElementById('meetLine');nm.textContent='Finding a spot…';ln.textContent='';document.getElementById('meetAsk').hidden=true;document.querySelector('.meet-lbl').textContent='MIDWAY MEETUP SPOT';fetch('/api/meetup/preview?listing=${it.id}&from='+encodeURIComponent(v)).then(function(r){return r.json()}).then(function(j){var sp=j.spots&&j.spots[0];if(sp){nm.textContent=sp.name;ln.textContent=(sp.address||'')+(sp.walk_owner_min!=null&&sp.walk_renter_min!=null?' · ~'+sp.walk_renter_min+' min for you, ~'+sp.walk_owner_min+' for them':'')}else{nm.textContent='Midway spot';ln.textContent='we’ll pick a café by text once it’s a go'}}).catch(function(){nm.textContent='Midway spot';ln.textContent='we’ll pick a café by text once it’s a go'})})}
})();
</script>`)}
    </Layout>
  );
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
browse.get('/u/:id', async (c) => {
  const u = c.get('user');
  const who = await userById(c.env.DB, c.req.param('id'));
  if (!who) return c.notFound();
  const me = u?.id === who.id;
  const rep = await reputation(c.env.DB, who.id);
  const items = await c.env.DB.prepare(`SELECT * FROM listings WHERE owner_id = ? AND status = 'live' ORDER BY created_at DESC`).bind(who.id).all<Listing>();
  const ph = await firstPhotos(c.env.DB, items.results.map(r => r.id));
  const reviews = await c.env.DB.prepare(`SELECT r.renter_rating st, r.renter_review rv, r.updated_at at, u.name nm, l.name item, 'as owner' tag FROM rentals r JOIN users u ON u.id = r.renter_id JOIN listings l ON l.id = r.listing_id WHERE r.owner_id = ? AND r.renter_rating IS NOT NULL
    UNION ALL SELECT r.owner_rating, r.owner_review, r.updated_at, u.name, l.name, 'as renter' FROM rentals r JOIN users u ON u.id = r.owner_id JOIN listings l ON l.id = r.listing_id WHERE r.renter_id = ? AND r.owner_rating IS NOT NULL ORDER BY at DESC LIMIT 20`).bind(who.id, who.id).all<{ st: number; rv: string | null; at: number; nm: string | null; item: string; tag: string }>();
  const avgAll = (() => { const n = rep.as_owner_n + rep.as_renter_n; if (!n) return null; return ((rep.as_owner_avg || 0) * rep.as_owner_n + (rep.as_renter_avg || 0) * rep.as_renter_n) / n; })();
  return c.html(
    <Layout title={me ? 'Profile' : (who.name || 'Neighbor')} user={u}>
      <section class="sec">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div>
            <div style="font-size:24px;font-weight:900;letter-spacing:-.02em">{who.name || 'Neighbor'}</div>
            <div class="hint" style="margin-top:4px">📍 {who.hood || 'NYC'} · since {new Date(who.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} · ✓ phone</div>
          </div>
          {me ? <a class="btn sm" href="/profile/edit">Edit</a> : null}
        </div>
        <div style="margin-top:14px;display:flex;gap:18px;align-items:baseline">
          <div><div class="price" style="font-size:44px;line-height:1">{avgAll ? '★ ' + avgAll.toFixed(1) : 'new'}</div><div class="hint">{rep.rentals} rentals · renting and renting out</div></div>
          <div><div class="price" style="font-size:44px;line-height:1">{rep.listed}</div><div class="hint">things listed</div></div>
        </div>
        {me ? <a class="btn pri full" style="margin-top:14px" href="/list">LIST MORE STUFF</a> : null}
      </section>
      <section class="sec">
        <div class="m" style="font-size:11px;color:var(--mute)">things ({items.results.length})</div>
        <div class="itemgrid" style="padding:10px 0 0">
          {items.results.map(it => <a class="itemcard" href={'/i/' + it.id}>{ph[it.id] ? <img src={'/p/' + ph[it.id]} alt="" /> : <div class="ph">no photo</div>}<div class="b"><div class="pr">{money(it.price_cents)}<span style="font-size:11px;font-weight:700">/day</span></div><div class="nm">{it.name}</div></div></a>)}
        </div>
      </section>
      <section class="sec" style="border-bottom:0">
        <div class="m" style="font-size:11px;color:var(--mute)">reviews ({reviews.results.length})</div>
        {reviews.results.length ? reviews.results.map(r => (
          <div class="card" style="margin-top:8px">
            <div class="row" style="justify-content:space-between"><b>{firstName(r.nm)}</b><span class="hint">{r.tag} · {r.item}</span></div>
            <div style="color:var(--orange);font-weight:900">{'★'.repeat(r.st)}</div>
            {r.rv ? <div style="font-size:14px;margin-top:4px">{r.rv}</div> : null}
          </div>
        )) : <div class="hint" style="margin-top:8px">No reviews yet.</div>}
      </section>
    </Layout>
  );
});

browse.get('/profile/edit', async (c) => {
  const u = c.get('user');
  if (!u) return c.redirect('/login?next=/profile/edit');
  const spots = u.pickup_spots ? (JSON.parse(u.pickup_spots) as string[]).join(', ') : '';
  return c.html(
    <Layout title="Edit profile" user={u} back={'/u/' + u.id}>
      <form method="post" action="/profile/edit" style="padding:12px 16px 40px">
        <label class="field"><span>Your name (first name + last initial)</span><input name="name" value={u.name || ''} placeholder="Fiona S." required maxlength={40} /></label>
        <label class="field" style="position:relative"><span>Pickup address (private — renters only see cross streets)</span><input name="address" id="addr" value={u.address || ''} placeholder="Street address" maxlength={160} autocomplete="off" /><div id="addrSug" class="card" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:50;padding:4px;margin-top:4px"></div></label>
        <label class="field"><span>Cross streets (public)</span><input name="cross_streets" value={u.cross_streets || ''} placeholder="W 22nd & 9th Ave" maxlength={80} /></label>
        <label class="field"><span>Meetup spots (comma separated)</span><input name="pickup_spots" value={spots} placeholder="Lobby, Joe Coffee on 9th" maxlength={200} /></label>
        <label class="field"><span>Neighborhood</span><input name="hood" value={u.hood || ''} placeholder="Chelsea" maxlength={60} /></label>
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
  const spots = String(f.pickup_spots || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
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
  const obj = await c.env.PHOTOS.get(c.req.param('key'));
  if (!obj) return c.notFound();
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set('etag', obj.httpEtag);
  h.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers: h });
});
