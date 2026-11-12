import type { FC, Child } from 'hono/jsx';
import { html, raw } from 'hono/html';
import type { User } from '../lib/env';

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
            <details class={'acct' + (u ? ' in' : '')}>
              <summary aria-label="Menu">
                {u ? (u.photo_key ? <img src={'/p/' + u.photo_key} alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover" /> : initial || <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4.2" fill="#fff" /><path d="M3.5 21C4.5 15.5 8 13.5 12 13.5S19.5 15.5 20.5 21Z" fill="#fff" /></svg>)
                  : <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4.2" fill="#1E3A2B" /><path d="M3.5 21C4.5 15.5 8 13.5 12 13.5S19.5 15.5 20.5 21Z" fill="#1E3A2B" /></svg>}
                {(p.badge ?? u?.unread) ? <span class="badge">{p.badge ?? u?.unread}</span> : null}
              </summary>
              <nav aria-label="Your account">
                {u ? (
                  <>
                    <a href="/inbox">Inbox</a>
                    <a href="/rentals">Your rentals{u.unread ? <span class="badge-n" style="margin-left:6px">{u.unread}</span> : null}</a>
                    <a href="/alerts">Search alerts</a>
                    <a href="/saved">Saved</a>
                    <a href={'/u/' + u.id}>Your profile</a>
                    <a href="/payout">Get paid</a>
                    {u.admin ? <><a href="/admin/pricing">Admin · pricing</a><a href="/admin/wanted">Admin · wanted items</a></> : null}
                    <a href="/about">Why Lendo</a>
                    <a class="list" href="/list">Rent out your stuff</a>
                    <a href="/logout" style="color:#8A857B;font-weight:600">Log out</a>
                  </>
                ) : (
                  <>
                    <a href="/login">Log in</a>
                    <a href="/about">Why Lendo</a>
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
              <label class="sr">Phone number</label>
              <input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Phone #" maxlength={14} />
              <button type="submit" disabled>$5 OFF</button>
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
      </body>
    </html>
  )}`;
};
