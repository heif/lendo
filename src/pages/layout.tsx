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
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
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
              <a class="back" href={p.back || '/'} aria-label="Back">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2L4 7L9 12" fill="none" stroke="#1E3A2B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </a>
            )}
            <a class="logo" href="/" aria-label="Lendo home (map)"><span class="wave" aria-hidden="true">👋</span>Lendo</a>
            {p.headerCenter ? <span class="sp"></span> : <span class="sep" aria-hidden="true"></span>}
            {p.headerCenter ? p.headerCenter : <h1>{p.title}</h1>}
            <span class="sp"></span>
            <details class={'acct' + (u ? ' in' : '')}>
              <summary aria-label="Menu">
                {u ? (initial || <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4.2" fill="#fff" /><path d="M3.5 21C4.5 15.5 8 13.5 12 13.5S19.5 15.5 20.5 21Z" fill="#fff" /></svg>)
                  : <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4.2" fill="#1E3A2B" /><path d="M3.5 21C4.5 15.5 8 13.5 12 13.5S19.5 15.5 20.5 21Z" fill="#1E3A2B" /></svg>}
                {p.badge ? <span class="badge">{p.badge}</span> : null}
              </summary>
              <nav aria-label="Your account">
                {u ? (
                  <>
                    <a href="/inbox">Inbox</a>
                    <a href="/rentals">Your rentals</a>
                    <a href="/listings">Your listings</a>
                    <a href="/saved">Saved</a>
                    <a href={'/u/' + u.id}>Profile</a>
                    <a href="/payout">Get paid</a>
                    {u.admin ? <a href="/admin/pricing">Admin</a> : null}
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
        </div>
        {raw(`<script>
document.addEventListener('click',function(e){document.querySelectorAll('details.acct[open]').forEach(function(d){if(!d.contains(e.target))d.removeAttribute('open')})});
window.toast=function(t){var d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove()},2200)};
</script>`)}
      </body>
    </html>
  )}`;
};
