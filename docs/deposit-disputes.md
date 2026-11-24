# Deposits for the item's value + AI disputes (branch `deposit-ai-disputes`)

Built in a side thread on 11/24/2026. This note hands it to the main Lendo thread.

## Decisions (Scott, 11/24)
1. Every rental has a deposit: a card hold (not a charge) for the item's full value
2. The value is set by AI, not the owner. Replaces the "Worth over $150 now?" toggle and the flat $150 hold
3. Valuation timing: in the background about an hour after listing (`settings.value_after_hours`, default 1). No owner work, and a rental request never waits on the AI: no value yet → instant estimate from the daily price for that rental. Owner can ask for it on the edit page. One appeal, tucked away, open any time, then final
4. Problems are decided by AI from photos + each side's statements and rebuttals. One AI second look, then final for both
5. Chargebacks: Lendo pays the owner what the AI decided even if a bank reverses it, up to a cap
6. Why: one clean answer to "what if they break it / what if I'm blamed"

## What's built
- `migrations/0039_value_claims.sql`: `listings.value_*`, `rentals.returned_at`, `claims`, `claim_entries`, settings `guarantee_cap_cents` (25000 = $250; stated in the Terms only, not advertised; applies only if the hold was on the card at handover), `cb_auto_submit` (0). Registered in `src/lib/migrate.ts`
- `src/lib/value.ts`: `valueDue` (cron, 5 items per run), `valueNow` (request time, no AI), `ensureValue` (AI, used price not new; keeps an estimate from the daily price if the AI doesn't answer, retried after 6h), `appealValue` (once)
- `src/lib/claims.ts`: the whole process, the judge prompt, settle, cron tick, bank-dispute handling. Read the header comment first
- `src/routes/claims.tsx`: `/r/:id/claim` page and actions
- `src/lib/stripe.ts`: card saved on every checkout + the hold/AI terms shown on the Stripe pay button; `collectAward`, `payClaim`, `disputeEvidence`; claims added to `flushPendingPayouts`
- `src/lib/rentals.ts`: return no longer releases the hold. `allGood` (owner tap) or 24h releases it. Holds renew while a claim is open
- `src/routes/rentals.tsx`: value → `rentals.deposit_cents` at request; promise line 2 names the hold and the AI; "All good · release hold" / "Report a problem" card; claim banner
- `src/routes/listings.tsx`, `public/list.js`: $150 toggle removed; Value row + `/listings/:id/value` appeal
- `src/routes/webhooks.ts`: `charge.dispute.created|updated|closed` → `onDispute`
- `/admin/claims`: list, totals, cap, auto-submit switch. Pay test sets a test item's value
- Copy: item page hold line, How it works "If something goes wrong", Terms, texting facts (`intent.ts`), request email

## The process
claim (owner) → response (customer) → reply (owner) → last word (customer) → AI decision → 24h: both OK = final, or one second look (other side gets 24h) → separate AI pass → final → charged from the hold, owner paid. 24h per step; a missed step moves on. Owner has 24h after return to report; "not returned" can be reported once it's overdue.

## Before deploy
1. Apply migration 0039 (cron self-migrates too)
2. Stripe dashboard: add `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` to the webhook endpoint
3. `ANTHROPIC_API_KEY` must be set in prod (valuation uses `claude-sonnet-5-5`, the judge `claude-opus-5-5`). Without it: values are estimates and rulings wait
4. Second review pass on `src/lib/stripe.ts` and `src/lib/rentals.ts` (repo rule)
5. Run one full claim in Stripe TEST mode from `/admin/paytest`: hold → return → claim → decision → partial capture → transfer. Not yet run against Stripe (local walk-through used fake pay + a stand-in ruling)

## Not verified / open
- Real Stripe: partial capture of the hold, `source_transaction` transfer, and file upload for dispute evidence are untested against the API
- Real AI: valuation and judge prompts have not been run on real cases yet
- Bank-dispute evidence is saved as a DRAFT in Stripe by default (`cb_auto_submit` = 0), because a submitted file can't be changed
- A lost chargeback above the cap is logged and texted to the admin; nothing is taken back from the owner automatically
- Terms need a lawyer's read: "final for both" is an arbitration-type clause, and no term can remove a cardholder's right to dispute
- Legacy `listings.deposit_cents` is unused now
