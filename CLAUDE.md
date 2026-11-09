# Lendo — rules for working in this repo

- Cloudflare Workers + Hono + TypeScript, server-rendered Hono JSX. No framework migration without asking.
- Data: D1 via `c.env.DB.prepare(...).bind(...)` with parameters — never string-interpolate user input into SQL. Schema changes = new file in `migrations/` (never edit an applied migration).
- Photos: R2 only; keys `listingId/…` and `rentals/rentalId/…`. Serve via `/p/:key`.
- Auth: phone + texted code, session cookie `lendo_s`. Every route that reads or changes a user's data must check ownership (`owner_id === u.id` / party of rental). `requireUser` only checks login, not ownership.
- Money: all amounts in integer cents. Renter pays rent + fee; owner gets rent. Stripe flow is hold → capture on YES → release on NO/expire. Changes to `src/lib/stripe.ts` or `src/lib/rentals.ts` need a second review pass for state-machine and refund correctness.
- Texts: all outbound texts go through `textUser` (logs to `outbound_texts`, respects STOP). Keywords handled in `src/routes/webhooks.ts`.
- Copy voice: "we" = the neighbors, not the platform. Short sentences. Customers "rent", owners "list". Fee is "15% fee (will stay low)".
- Brand: cream `#F5F3EE`, ink `#1E3A2B`, orange `#FF4F00`, Helvetica Neue; 👋 Lendo logo. Tokens in `public/app.css`.
- Verify: `npm run typecheck`, then `npm run dev` + walk the flow (list → rent → YES via `/webhooks/blooio` → pickup → return → rate).
