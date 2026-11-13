// Append-only activity log (events table, /admin/log). Never throws: logging must not break the thing being logged.
export type Ev = { user?: string | null; rental?: string | null; listing?: string | null; cents?: number | null; data?: unknown };

export async function logEvent(db: D1Database, kind: string, e: Ev = {}): Promise<void> {
  try {
    const data = e.data == null ? null : typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
    await db.prepare('INSERT INTO events (at, kind, user_id, rental_id, listing_id, amount_cents, data) VALUES (?,?,?,?,?,?,?)')
      .bind(Date.now(), kind, e.user ?? null, e.rental ?? null, e.listing ?? null, e.cents ?? null, data ? data.slice(0, 4000) : null).run();
  } catch (err) { console.warn('logEvent', kind, err); }
}

// errors: console (Workers logs) + events table
export async function logErr(db: D1Database, where: string, err: unknown, e: Ev = {}): Promise<void> {
  console.error(where, err);
  const msg = err instanceof Error ? `${err.message}\n${err.stack || ''}` : String(err);
  await logEvent(db, 'error', { ...e, data: { where, msg: msg.slice(0, 2000) } });
}
