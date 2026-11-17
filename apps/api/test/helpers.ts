import { SYSTEM_CATEGORIES } from '@homehub/shared';
import { env, exports } from 'cloudflare:workers';
import { randomToken, sha256Hex } from '../src/lib/crypto';
import { MembersService } from '../src/members/members.service';

export const WEB_ORIGIN = 'http://localhost:5173';
const BASE = 'http://localhost';

export interface Member {
  userId: string;
  workspaceId: string;
  cookie: string;
  csrf: string;
}

/** Deletes all rows in FK-safe order. Tests share one local D1 database per file. */
export async function resetDb(): Promise<void> {
  await env.DB.batch(
    [
      'login_attempts',
      'oauth_clients',
      'mcp_audit',
      'api_tokens',
      'savings_pots',
      'asset_prices',
      'shopping_items',
      'shopping_history',
      'chore_completions',
      'chores',
      'monthly_budgets',
      'transactions',
      'categories',
      'accounts',
      'sessions',
      'workspace_members',
      'workspaces',
      'users',
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
  );
}

export async function createWorkspace(slug = crypto.randomUUID()): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO workspaces (id, slug, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)',
    ).bind(id, slug, `WS ${slug}`, now),
    ...SYSTEM_CATEGORIES.map((c) =>
      env.DB.prepare(
        `INSERT INTO categories (id, workspace_id, system_key, name, kind, color, is_system, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)`,
      ).bind(crypto.randomUUID(), id, c.key, c.name, c.kind, c.color, now),
    ),
  ]);
  return id;
}

/**
 * Inserts a user, membership and session straight into D1. Requests then pass through exactly
 * the same middleware as a browser — there is no login bypass in application code.
 */
export async function createMember(
  email: string,
  workspaceId?: string,
  expiresInMs = 3_600_000,
): Promise<Member> {
  const workspace = workspaceId ?? (await createWorkspace());
  const userId = crypto.randomUUID();
  const token = randomToken();
  const csrf = randomToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO users (id, login_id, email, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)',
    ).bind(userId, `sub-${email}`, email, now),
    env.DB.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?1, ?2, 'MEMBER', ?3)",
    ).bind(workspace, userId, now),
    env.DB.prepare(
      `INSERT INTO sessions (id, token_hash, csrf_token, user_id, expires_at, last_used_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
    ).bind(crypto.randomUUID(), await sha256Hex(token), csrf, userId, now + expiresInMs, now),
  ]);
  // As a real sign-in does: every login of the household gets its members row.
  await new MembersService(env.DB).ensureLogins(workspace);
  return { userId, workspaceId: workspace, cookie: `hh_session=${token}`, csrf };
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

async function toApiResponse<T>(response: Response): Promise<ApiResponse<T>> {
  const text = await response.text();
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : null) as T,
    headers: response.headers,
  };
}

/**
 * Calls the Worker's real fetch handler (the same entry point Cloudflare invokes).
 * Response bodies default to `any`: tests assert their shape structurally with expect().
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function call<T = any>(
  path: string,
  init: RequestInit & {
    member?: Member;
    csrf?: string | null;
    origin?: string | null;
    /** Another app than the Worker's (createApp with test options). */
    fetch?: (request: Request) => Response | Promise<Response>;
  } = {},
): Promise<ApiResponse<T>> {
  const headers = new Headers(init.headers);
  if (init.member) headers.set('Cookie', init.member.cookie);
  const method = init.method ?? 'GET';
  if (method !== 'GET') {
    if (init.origin !== null) headers.set('Origin', init.origin ?? WEB_ORIGIN);
    const csrf = init.csrf === undefined ? init.member?.csrf : init.csrf;
    if (csrf) headers.set('X-CSRF-Token', csrf);
    if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  }
  const request = new Request(`${BASE}${path}`, { ...init, method, headers, redirect: 'manual' });
  const response = await (init.fetch ? init.fetch(request) : exports.default.fetch(request));
  return toApiResponse<T>(response);
}

export const json = (value: unknown) => JSON.stringify(value);

export async function categoryId(workspaceId: string, key: string): Promise<string> {
  const row = await env.DB.prepare(
    'SELECT id FROM categories WHERE workspace_id = ?1 AND system_key = ?2',
  )
    .bind(workspaceId, key)
    .first<{ id: string }>();
  if (!row) throw new Error(`Category ${key} not found`);
  return row.id;
}

export async function createAccount(
  member: Member,
  name: string,
  currency = 'RUB',
  initialBalance = '0',
) {
  const res = await call<{ id: string }>('/api/accounts', {
    method: 'POST',
    member,
    body: json({ name, type: 'CARD', currency, initialBalance }),
  });
  if (res.status !== 201)
    throw new Error(`Account creation failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function balances(member: Member): Promise<Record<string, string>> {
  const res = await call<{ name: string; balance: string }[]>('/api/accounts', { member });
  return Object.fromEntries(res.body.map((a) => [a.name, a.balance]));
}
