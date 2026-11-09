# Lendo — v1

Rent the stuff near you. Cloudflare Workers + Hono + D1 + R2. Stripe for payments. Blooio for iMessage/SMS.

## Stack
| Piece | Choice |
|---|---|
| Runtime / hosting | Cloudflare Workers (`wrangler.jsonc`), static assets from `public/` |
| DB | Cloudflare D1 (SQLite) — `migrations/0001_init.sql` |
| Photos | Cloudflare R2 (`PHOTOS` bucket), served at `/p/<key>` |
| Web | Hono + server-rendered JSX, small inline JS per page, Leaflet + CARTO tiles for the map |
| Payments | Stripe Checkout with **manual capture** (card held at request, captured on owner YES, released on NO / 24h timeout). Stripe Connect Express for owner payouts (transfers). |
| Texts | Blooio (`POST {BLOOIO_API_BASE}/chats/{phone}/messages`). Login codes + every rental text. Inbound webhook handles YES / NO / LATE / HERE / STOP / STOP NUDGES / LIST / HELP and relays free text to the other party. |
| Cron | every 15 min: expire held requests, cancel abandoned checkouts |

## Routes
- `/` map (search, list toggle, KPI count) · `/i/:id` item + day picker · `/u/:id` profile · `/about`
- `/login` → text code → `/welcome` (name) · `/logout`
- `/list` snap-price-live · `/listings` manage (±$1, pause, remove, edit, block days)
- `POST /i/:id/rent` → Stripe Checkout → `/r/:id` rental page (steps, YES/NO, pickup & return photo, chat, rating)
- `/rentals` · `/inbox` (every text we sent you) · `/saved` · `/payout` (Connect Express)
- `/webhooks/stripe` · `/webhooks/blooio`
- `GET /api/listings?bbox=w,s,e,n&q=&hood=` · `GET /api/listings/:id` · `GET /api/health` (agents welcome, read-only for now)

## Money
Renter pays `rent + FEE_PCT%` (default 15). Owner receives 100% of rent. Week price caps each (partial) week (`rentFor` in `src/lib/util.ts`, mirrored in item-page JS). Minimum `MIN_PRICE_CENTS` (800).

## Run locally
```bash
npm install
cp .dev.vars.example .dev.vars        # leave keys blank → dev mode
npm run db:migrate:local
npm run dev                           # http://localhost:8787
```
Dev mode (no `BLOOIO_API_KEY`): login codes print in the console and are shown on the verify page. No `STRIPE_SECRET_KEY`: "rent" skips Checkout and marks the card as held.

## Deploy
```bash
npx wrangler login
npx wrangler d1 create lendo          # paste database_id into wrangler.jsonc
npx wrangler r2 bucket create lendo-photos
npm run db:migrate
npx wrangler secret put SESSION_SECRET
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET   # from the Stripe webhook you create below
npx wrangler secret put BLOOIO_API_KEY
npx wrangler secret put BLOOIO_WEBHOOK_SECRET
# set APP_URL in wrangler.jsonc vars to your real domain
npm run deploy
```
Then:
1. Stripe → Developers → Webhooks → endpoint `https://<domain>/webhooks/stripe`, events: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.canceled`. Enable Connect (Express) in the Stripe dashboard.
2. Blooio → register webhook `https://<domain>/webhooks/blooio` (all events are sent; handler ignores non-`message.received`). Set the webhook secret as `BLOOIO_WEBHOOK_SECRET`. The handler accepts both payload shapes seen in Blooio docs (`external_id`/`text` and `data.from`/`data.text`); verify the signature header name (`x-blooio-signature`, HMAC-SHA256 hex of raw body) against their current docs.
3. Custom domain → Workers → Triggers → Custom Domains.

## Not in v1 (on purpose)
Admin tools · neighborhood promo payouts ($1/item) · FaceTime owner check · nudges/milestone texts (schema has `category`, no sender yet) · deposits · disputes/refunds UI · write API keys · email · search ranking beyond LIKE.
