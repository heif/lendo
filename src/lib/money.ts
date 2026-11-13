// Money model (Nov 13): customer pays rent − credit + sales tax. Lendo's fee comes out of the owner's payout:
// fee = FEE_PCT × (rent + tax); owner gets rent − fee. Lendo absorbs the credit and remits the tax.
import type { Env } from './env';

// Sales tax by where the item is. NYC 8.875% (4% NY + 4.5% city + 0.375% MCTD); Iowa City 7% (6% IA + 1% Johnson County)
export function taxRateFor(lat: number | null | undefined, lng: number | null | undefined): number {
  if (lat == null || lng == null) return 0;
  if (lat > 40.49 && lat < 40.92 && lng > -74.26 && lng < -73.69) return 0.08875;
  if (lat > 41.58 && lat < 41.73 && lng > -91.65 && lng < -91.45) return 0.07;
  return 0;
}

export const feePct = (env: Env) => parseFloat(env.FEE_PCT || '15');

export function quote(env: Env, rent: number, credit: number, rate: number) {
  const cr = Math.max(0, Math.min(credit || 0, rent));
  const tax = Math.round((rent - cr) * rate);
  const fee = rent > 0 ? Math.round((rent + tax) * feePct(env) / 100) : 0; /* free rental = no fee */
  return { rent, credit: cr, tax, total: rent - cr + tax, fee, payout: Math.max(0, rent - fee) };
}

// what the owner gets for a rental row (old rows, before payout_cents: the rent)
export const payoutOf = (r: { payout_cents?: number | null; rent_cents: number }) => r.payout_cents ?? r.rent_cents;
