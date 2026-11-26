// Safety net: if a deploy skipped `wrangler d1 migrations apply`, the cron applies the newest migrations itself.
// Each statement is idempotent or tolerated if already applied; then the migration is recorded like wrangler does.
import type { Env } from './env';
import m0015 from '../../migrations/0015_alerts.sql';
import m0016 from '../../migrations/0016_urls.sql';
import m0017 from '../../migrations/0017_promise.sql';
import m0018 from '../../migrations/0018_grade.sql';
import m0019 from '../../migrations/0019_extend.sql';
import m0020 from '../../migrations/0020_item_rating.sql';
import m0021 from '../../migrations/0021_inbound.sql';
import m0022 from '../../migrations/0022_reads.sql';
import m0023 from '../../migrations/0023_user_photo.sql';
import m0024 from '../../migrations/0024_old_handles.sql';
import m0025 from '../../migrations/0025_socials.sql';
import m0026 from '../../migrations/0026_tax.sql';
import m0027 from '../../migrations/0027_events.sql';
import m0028 from '../../migrations/0028_admin_role.sql';
import m0029 from '../../migrations/0029_meet_times.sql';
import m0030 from '../../migrations/0030_grade_e.sql';
import m0031 from '../../migrations/0031_hold.sql';
import m0032 from '../../migrations/0032_flags.sql';
import m0033 from '../../migrations/0033_notext.sql';
import m0034 from '../../migrations/0034_stock.sql';
import m0035 from '../../migrations/0035_android.sql';
import m0036 from '../../migrations/0036_ac.sql';
import m0037 from '../../migrations/0037_smsok.sql';
import m0038 from '../../migrations/0038_email.sql';
import m0039 from '../../migrations/0039_value_claims.sql';
import m0040 from '../../migrations/0040_min_price.sql';
import m0041 from '../../migrations/0041_combo.sql';

const PENDING: [string, string][] = [['0015_alerts.sql', m0015], ['0016_urls.sql', m0016], ['0017_promise.sql', m0017], ['0018_grade.sql', m0018], ['0019_extend.sql', m0019], ['0020_item_rating.sql', m0020], ['0021_inbound.sql', m0021], ['0022_reads.sql', m0022], ['0023_user_photo.sql', m0023], ['0024_old_handles.sql', m0024], ['0025_socials.sql', m0025], ['0026_tax.sql', m0026], ['0027_events.sql', m0027], ['0028_admin_role.sql', m0028], ['0029_meet_times.sql', m0029], ['0030_grade_e.sql', m0030], ['0031_hold.sql', m0031], ['0032_flags.sql', m0032], ['0033_notext.sql', m0033], ['0034_stock.sql', m0034], ['0035_android.sql', m0035], ['0036_ac.sql', m0036], ['0037_smsok.sql', m0037], ['0038_email.sql', m0038], ['0039_value_claims.sql', m0039], ['0040_min_price.sql', m0040], ['0041_combo.sql', m0041]];

export async function selfMigrate(env: Env): Promise<string[]> {
  const done = new Set((await env.DB.prepare('SELECT name FROM d1_migrations').all<{ name: string }>().catch(() => ({ results: [] as { name: string }[] }))).results.map(r => r.name));
  const applied: string[] = [];
  for (const [name, sql] of PENDING) {
    if (done.has(name)) continue;
    const stmts = sql.split(/;\s*(?:\n|$)/).map(s => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
    for (const st of stmts) { try { await env.DB.prepare(st).run(); } catch (e: any) { if (!/duplicate column|already exists/i.test(String(e?.message || e))) throw e; } }
    await env.DB.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name).run();
    applied.push(name);
  }
  return applied;
}
