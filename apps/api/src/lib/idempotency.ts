import type { Context, Next } from 'hono';
import type { AppEnv } from '../app-env';
import { sha256Hex } from './crypto';
import { HttpError } from './http-error';

/**
 * Idempotent writes. A client (or a future MCP tool) that may retry a write sends an
 * `Idempotency-Key`; the first response is stored and a retry with the same key gets it back
 * (header `Idempotent-Replayed: true`) instead of writing again. The key is per workspace, kept
 * for a day, and bound to its request: the same key for another method, path or body is refused.
 * Responses of server errors are not stored, so a failed request can be retried for real.
 */

const KEY = /^[A-Za-z0-9_-]{8,128}$/;
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** status = 0 marks a request still running. */
const RUNNING = 0;

export async function idempotent(c: Context<AppEnv>, next: Next): Promise<void> {
  const key = c.req.header('Idempotency-Key');
  if (!key || !WRITES.has(c.req.method)) {
    await next();
    return;
  }
  if (!KEY.test(key)) throw new HttpError(400, 'BAD_REQUEST');
  const { workspaceId, userId } = c.var.auth;
  const body = await c.req.raw.clone().text();
  const url = new URL(c.req.url);
  const hash = await sha256Hex(`${c.req.method} ${url.pathname}${url.search}\n${body}`);
  const db = c.env.DB;

  const claimed = await db
    .prepare(
      `INSERT INTO idempotency_keys (workspace_id, key, user_id, request_hash, status, body, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, '', ?6) ON CONFLICT (workspace_id, key) DO NOTHING`,
    )
    .bind(workspaceId, key, userId, hash, RUNNING, Date.now())
    .run();
  if (!claimed.meta.changes) {
    const stored = await db
      .prepare(
        'SELECT request_hash, status, body FROM idempotency_keys WHERE workspace_id = ? AND key = ?',
      )
      .bind(workspaceId, key)
      .first<{ request_hash: string; status: number; body: string }>();
    if (!stored || stored.request_hash !== hash) throw new HttpError(422, 'IDEMPOTENCY_KEY_REUSED');
    if (stored.status === RUNNING) throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS');
    c.res = new Response(stored.status === 204 ? null : stored.body, {
      status: stored.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Idempotent-Replayed': 'true',
      },
    });
    return;
  }

  try {
    await next();
  } finally {
    const status = c.res.status;
    if (status >= 500)
      await db
        .prepare('DELETE FROM idempotency_keys WHERE workspace_id = ? AND key = ?')
        .bind(workspaceId, key)
        .run();
    else
      await db
        .prepare(
          'UPDATE idempotency_keys SET status = ?, body = ? WHERE workspace_id = ? AND key = ?',
        )
        .bind(status, status === 204 ? '' : await c.res.clone().text(), workspaceId, key)
        .run();
  }
}

/** Forgets keys older than a day (daily cron). */
export async function deleteExpiredKeys(db: D1Database, now = Date.now()): Promise<number> {
  const result = await db
    .prepare('DELETE FROM idempotency_keys WHERE created_at < ?')
    .bind(now - IDEMPOTENCY_TTL_MS)
    .run();
  return result.meta.changes;
}
