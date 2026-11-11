// Safety net: if a deploy skipped `wrangler d1 migrations apply`, the cron applies the newest migrations itself.
// Each statement is idempotent or tolerated if already applied; then the migration is recorded like wrangler does.
import type { Env } from './env';
import m0015 from '../../migrations/0015_alerts.sql';
import m0016 from '../../migrations/0016_urls.sql';
import m0017 from '../../migrations/0017_promise.sql';
import m0018 from '../../migrations/0018_grade.sql';

const PENDING: [string, string][] = [['0015_alerts.sql', m0015], ['0016_urls.sql', m0016], ['0017_promise.sql', m0017], ['0018_grade.sql', m0018]];

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
