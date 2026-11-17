import type { FC, Child } from 'hono/jsx';
import { html, raw } from 'hono/html';
import type { User } from '../lib/env';
import { GIFT_TEXT, site } from '../lib/blooio';

export type LayoutProps = {
  title: string;              // header title ("Item", "Your listings")
  user: User | null;
  back?: string | null;       // back link; null hides the back button
  badge?: number;             // red count on the account button
  head?: Child;               // extra <head> content
  wide?: boolean;
  top?: Child;             // rendered above the header (e.g. the map page ticker)
  promo?: boolean;         // show the $5-off phone bar (Layout decides: logged out + no lendo_p cookie); pass false to hide
  htmlClass?: string;      // e.g. 'mappage' locks the page to the viewport
  headerCenter?: Child;    // replaces the title (map page: hood/city pills)
  flash?: string | null;
  flashErr?: string | null;
  children?: Child;
};

export const Layout: FC<LayoutProps> = (p) => {
  const u = p.user;
  const initial = (u?.name || '').trim().charAt(0).toUpperCase();
  return html`<!doctype html>${(
    <html lang="en" class={p.htmlClass || ""}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        <title>Lendo — {p.title}</title>
        <meta name="theme-color" content="#F5F3EE" />
        <link rel="stylesheet" href="/app.css" />
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E👋%3C/text%3E%3C/svg%3E" />
        {p.head}
      </head>
      <body>
        <div class="wrap" style={p.wide ? 'max-width:none' : ''}>
          {p.top}
          <header class="hdr">
            {p.back === null ? null : (
              <a class="back" href={p.back || '/'} aria-label="Back" onclick="if(document.referrer&&new URL(document.referrer).origin===location.origin&&history.length>1){history.back();return false}">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2L4 7L9 12" fill="none" stroke="#1E3A2B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </a>
            )}
            <a class="logo" href="/" aria-label="Lendo home (map)"><span class="wave" aria-hidden="true">👋</span>Lendo</a>
            {p.headerCenter ? <span class="sp"></span> : <span class="sep" aria-hidden="true"></span>}
            {p.headerCenter ? p.headerCenter : <h1>{p.title}</h1>}
            <span class="sp"></span>
            {u ? <a class="hchat" href="/inbox" aria-label={'Inbox' + (u.unread ? ` (${u.unread} unread)` : '')}><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c4.9 0 8.5 3.3 8.5 7.6s-3.6 7.6-8.5 7.6c-1 0-2-.1-2.9-.4L4.5 20l1.3-3.6C4.3 15 3.5 13.2 3.5 11.1 3.5 6.8 7.1 3.5 12 3.5z" fill="none" stroke="#1E3A2B" stroke-width="2.2" stroke-linejoin="round" /></svg>{u.unread ? <span class="badge">{u.unread}</span> : null}</a> : null}
            <details class={'acct' + (u ? ' in' : '')}>
              <summary aria-label="Menu">
                {u ? (u.photo_key ? <img src={'/p/' + u.photo_key} alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover" /> : initial || <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4.2" fill="#fff" /><path d="M3.5 21C4.5 15.5 8 13.5 12 13.5S19.5 15.5 20.5 21Z" fill="#fff" /></svg>)
                  : <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4.2" fill="#1E3A2B" /><path d="M3.5 21C4.5 15.5 8 13.5 12 13.5S19.5 15.5 20.5 21Z" fill="#1E3A2B" /></svg>}
                {p.badge ? <span class="badge">{p.badge}</span> : null}
              </summary>
              <nav aria-label="Your account">
                {u ? (
                  <>
                    <a href={'/u/' + u.id}>{(() => { const f = (u.name || '').trim().split(/\s+/)[0] || 'Your'; return f === 'Your' ? 'Your Stuff' : f + (/s$/i.test(f) ? '’' : '’s') + ' Stuff'; })()}</a>
                    <a href="/rentals">Your rentals{u.unread ? <span class="badge-n" style="margin-left:6px">{u.unread}</span> : null}</a>
                    <a href="/saved">Saved</a>
                    <a href="/alerts">Search alerts</a>
                    <a href="/how-it-works">How it works</a>
                    {u.admin ? <a href="/admin">Admin</a> : null}
                    <a class="list" href="/list">Rent out your stuff</a>
                    <a href="/logout" style="color:#8A857B;font-weight:600">Log out</a>
                  </>
                ) : (
                  <>
                    <a href="/login">Log in</a>
                    <a href="/how-it-works">How it works</a>
                    <a class="list" href="/list">Rent out your stuff</a>
                  </>
                )}
              </nav>
            </details>
          </header>
          {p.flash ? <div class="flash">{p.flash}</div> : null}
          {p.flashErr ? <div class="flash err">{p.flashErr}</div> : null}
          {p.children}
          {!p.user && p.promo !== false ? <>
            <form class="promo pu" id="promo" data-promo autocomplete="on" aria-label="Get $5 off" hidden>
              {/* computers: the gift button opens this panel — scan to text Lendo, or type a number */}
              <div class="gpanel" id="gpanel">
                {site.number ? <><span class="gp-qr" id="gpQr" data-sms={`SMSTO:+1${site.number.replace(/\D/g, '').slice(-10)}:${GIFT_TEXT}`} aria-label="Scan to text Lendo"></span><span class="gp-or">or</span></> : null}
                <span class="gp-in"><label class="sr">Phone number</label>
                <input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Phone #" maxlength={14} />
                <button type="submit" disabled aria-label="Get $5 off">→</button></span>
              </div>
              {/* phones: one tap opens Messages to Lendo; the reply makes the account + texts a login link */}
              {site.number ? <a class="giftbtn" href={`sms:+1${site.number.replace(/\D/g, '').slice(-10)}?&body=${encodeURIComponent(GIFT_TEXT)}`}><span class="gb-ic" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24"><rect x="3" y="9" width="18" height="12" rx="2" fill="none" stroke="#fff" stroke-width="2.2" /><path d="M2 9h20M12 9v12M12 9c-2-4-6-5-6-2s4 2 6 2c2 0 6 1 6-2s-4-2-6 2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round" /></svg></span><span class="gb-tx">Free $5<br />gift card</span></a> : null}
            </form>
            <div class="optin" id="optin" hidden role="dialog" aria-label="Text message opt-in">
              <div class="optin-box">
                <div style="font-size:17px;font-weight:900">Get texts from Lendo?</div>
                <div style="font-size:13px;line-height:1.4;margin-top:6px">To <b id="optPhone"></b>: your $5 off, rentals, saved items and nearby alerts.</div>
                <div style="font-size:11px;line-height:1.4;color:#6F6A60;margin-top:8px">Msg frequency varies. Msg &amp; data rates may apply. Reply STOP to cancel, HELP for help.</div>
                <div style="display:flex;gap:8px;margin-top:14px"><button type="button" class="btn" id="optNo" style="flex:1">Cancel</button><button type="button" class="btn pri" id="optYes" style="flex:1.4">Agree</button></div>
              </div>
            </div>
            <script src="/promo.js" defer></script>
          </> : null}
        </div>
        {raw(`<script>
document.addEventListener('click',function(e){document.querySelectorAll('details.acct[open]').forEach(function(d){if(!d.contains(e.target))d.removeAttribute('open')})});
window.toast=function(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove()},2200)};
</script>`)}
      <script dangerouslySetInnerHTML={{ __html: "(function(){var q=location.search;if(!/[?&]flag(ged|err)=1/.test(q))return;var d=document.createElement('div');d.className='flagthx';d.textContent=/flagged/.test(q)?'Thanks \u2014 a person at Lendo will look at it':'Couldn\u2019t send that \u2014 try again';document.body.appendChild(d);setTimeout(function(){d.remove()},4000);try{history.replaceState(null,'',location.pathname+q.replace(/[?&]flag(ged|err)=1/,'').replace(/^&/,'?'))}catch(e){}})()" }} />
<script dangerouslySetInnerHTML={{ __html: "(function(){var r=document.querySelector('.ro-bonus');if(!r)return;var V=(document.cookie.match(/(?:^|; )lendo_ab_l10=([abc])/)||[])[1];if(!V){V='abc'.charAt(Math.floor(Math.random()*3));document.cookie='lendo_ab_l10='+V+';path=/;max-age=34560000;samesite=lax'}var T={a:['$10 BONUS TODAY','$10 BONUS TODAY \u00b7 list 10 things'],b:['GET $10 TODAY','Get $10 cash \u00b7 list 10 things'],c:['$1/ITEM TODAY','$1/item today \u00b7 up to $10']}[V];if(r){r.textContent=T[0];r.setAttribute('aria-label',T[0])}function ab(e){try{var b=JSON.stringify({exp:'list10',var:V,ev:e});navigator.sendBeacon?navigator.sendBeacon('/api/ab',b):fetch('/api/ab',{method:'POST',body:b,keepalive:true})}catch(x){}}try{if(!sessionStorage.getItem('ab_l10_seen')){sessionStorage.setItem('ab_l10_seen','1');ab('view')}}catch(x){}var ro=document.querySelector('.rent-out');if(ro&&r)ro.addEventListener('click',function(){ab('click')})})()" }} />
<script src="/trim.js" defer></script></body>
    </html>
  )}`;
};
