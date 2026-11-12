// Condition grade (A B C D F), NYC-restaurant-sign style badge. A–B green, C amber, D–F red.
import type { Env } from './env';

export const GRADES = ['A', 'B', 'C', 'D', 'F'] as const;
export const GRADE_WORD: Record<string, string> = { A: 'Like new', B: 'Good', C: 'Fair', D: 'Worn', F: 'Rough' };
const PTS: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
export const isGrade = (g: unknown): g is string => typeof g === 'string' && g in PTS;

// Shown grade = owner's grade until customers grade it, then the average of owner + customers.
export async function shownGrade(env: Env, lid: string, ownerGrade: string | null | undefined) {
  const og = isGrade(ownerGrade) ? ownerGrade : 'A';
  const rows = (await env.DB.prepare(`SELECT grade FROM rentals WHERE listing_id = ? AND grade IS NOT NULL`).bind(lid).all<{ grade: string }>().catch(() => ({ results: [] as { grade: string }[] }))).results.filter(r => isGrade(r.grade));
  if (!rows.length) return { letter: og, customers: 0 };
  const avg = (PTS[og] + rows.reduce((a, r) => a + PTS[r.grade], 0)) / (rows.length + 1);
  const letter = GRADES[4 - Math.round(avg)] ?? 'A';
  return { letter, customers: rows.length };
}

export const Grade = (p: { g: string; arrow?: boolean; cls?: string }) =>
  <span class={'grd g' + p.g + (p.cls ? ' ' + p.cls : '')} aria-label={`Condition ${p.g}, ${GRADE_WORD[p.g] || ''}`}><b>{p.g}</b><small>CONDITION</small>{p.arrow ? <i>▾</i> : null}</span>;

// shown grade for many listings at once (owner grade averaged with customer grades)
export async function shownGrades(env: Env, ls: { id: string; grade?: string | null }[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!ls.length) return out;
  const rows = (await env.DB.prepare(`SELECT listing_id, grade FROM rentals WHERE grade IS NOT NULL AND listing_id IN (${ls.map(() => '?').join(',')})`).bind(...ls.map(l => l.id)).all<{ listing_id: string; grade: string }>().catch(() => ({ results: [] as { listing_id: string; grade: string }[] }))).results;
  for (const l of ls) {
    const og = isGrade(l.grade) ? l.grade! : 'A';
    const cs = rows.filter(r => r.listing_id === l.id && isGrade(r.grade));
    if (!cs.length) { out[l.id] = og; continue; }
    const avg = (PTS[og] + cs.reduce((a, r) => a + PTS[r.grade], 0)) / (cs.length + 1);
    out[l.id] = GRADES[4 - Math.round(avg)] ?? 'A';
  }
  return out;
}
