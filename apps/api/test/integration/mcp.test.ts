import type { AccessTokenDto, PersonalTokenCreatedDto, Scope } from '@homehub/shared';
import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { sha256Base64Url } from '../../src/lib/crypto';
import {
  call,
  createAccount,
  createMember,
  json,
  resetDb,
  WEB_ORIGIN,
  type Member,
} from '../helpers';

/**
 * Machine access end to end: personal tokens, OAuth 2.1 (registration, consent, PKCE, refresh
 * rotation, revocation) and the MCP endpoint — tools offered by scope, calls through the services,
 * workspace isolation and the audit of writes.
 */

beforeEach(resetDb);

const ORIGIN = 'http://localhost';

async function mcp(secret: string | null, method: string, params: unknown = {}) {
  const response = await exports.default.fetch(
    new Request(`${ORIGIN}/api/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
}

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: { type: string; text: string }[];
}

async function tool(secret: string, name: string, args: unknown = {}): Promise<ToolResult> {
  const res = await mcp(secret, 'tools/call', { name, arguments: args });
  expect(res.status).toBe(200);
  return res.body.result as ToolResult;
}

async function personalToken(member: Member, scopes: Scope[]) {
  const res = await call<PersonalTokenCreatedDto>('/api/access/tokens', {
    method: 'POST',
    member,
    body: json({ name: 'Claude Code', scopes, expiresInDays: 30 }),
  });
  expect(res.status).toBe(201);
  return res.body;
}

describe('personal tokens and the MCP endpoint', () => {
  it('rejects calls without a valid token and points to the OAuth metadata', async () => {
    const res = await mcp(null, 'tools/list');
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain(
      'resource_metadata="http://localhost:5173/.well-known/oauth-protected-resource/api/mcp"',
    );
    expect((await mcp('hh_pat_not-a-real-token', 'tools/list')).status).toBe(401);
  });

  it('initializes and lists only the tools of the granted scopes', async () => {
    const alice = await createMember('alice@example.com');
    const { secret, token } = await personalToken(alice, ['finance:read']);
    expect(secret).toMatch(/^hh_pat_/);
    expect(token).toMatchObject({ kind: 'personal', scopes: ['finance:read'], own: true });

    const init = await mcp(secret, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe('homehub');

    const list = await mcp(secret, 'tools/list');
    const names: string[] = list.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('finance_list_accounts');
    expect(names).not.toContain('finance_create_account');
    const accounts = list.body.result.tools.find(
      (t: { name: string }) => t.name === 'finance_list_accounts',
    );
    expect(accounts.annotations.readOnlyHint).toBe(true);
  });

  it('reads through the services, never another workspace, and refuses ungranted writes', async () => {
    const alice = await createMember('alice@example.com');
    const bob = await createMember('bob@example.com');
    await createAccount(alice, 'Alice card', 'PLN', '100');
    await createAccount(bob, 'Bob card', 'PLN', '50');
    const { secret } = await personalToken(alice, ['finance:read']);

    const read = await tool(secret, 'finance_list_accounts');
    const items = read.structuredContent?.items as { name: string }[];
    expect(items.map((a) => a.name)).toEqual(['Alice card']);

    const write = await tool(secret, 'finance_create_account', {
      data: { name: 'X', type: 'CARD', currency: 'PLN', initialBalance: '0' },
    });
    expect(write.isError).toBe(true);
    expect((await call<{ name: string }[]>('/api/accounts', { member: alice })).body).toHaveLength(
      1,
    );
  });

  it('writes through the services with their rules, and audits every write', async () => {
    const alice = await createMember('alice@example.com');
    const { secret, token } = await personalToken(alice, ['finance:read', 'finance:write']);
    const created = await tool(secret, 'finance_create_account', {
      data: { name: 'Card', type: 'CARD', currency: 'PLN', initialBalance: '10.50' },
    });
    expect(created.isError).toBeFalsy();
    expect(created.structuredContent).toMatchObject({ name: 'Card', balance: '10.50' });

    // A rule of the service (validation from the shared schema) answers as a coded error.
    const invalid = await tool(secret, 'finance_create_account', {
      data: { name: '', type: 'CARD', currency: 'PLN', initialBalance: '0' },
    });
    expect(invalid.isError).toBe(true);
    // The SDK checks the input against the same schema first; the message carries its code.
    expect(invalid.content[0]?.text).toContain('VALIDATION_NAME_REQUIRED');

    const audit = await env.DB.prepare(
      'SELECT tool, ok, error_code FROM mcp_audit WHERE token_id = ? ORDER BY created_at',
    )
      .bind(token.id)
      .all<{ tool: string; ok: number; error_code: string | null }>();
    // A refusal of the service itself is audited too (a different currency on an account with
    // operations is not, here: the account is new — so an unknown account id).
    const missing = await tool(secret, 'finance_update_account', {
      id: '00000000-0000-4000-8000-000000000000',
      data: { name: 'Y' },
    });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]?.text).toMatch(/^FINANCE_ACCOUNT_NOT_FOUND/);
    expect(audit.results).toEqual([{ tool: 'finance_create_account', ok: 1, error_code: null }]);
    const after = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM mcp_audit WHERE ok = 0 AND error_code = ?',
    )
      .bind('FINANCE_ACCOUNT_NOT_FOUND')
      .first<{ n: number }>();
    expect(after?.n).toBe(1);
  });

  it('a revoked token stops at once; only its owner revokes it', async () => {
    const alice = await createMember('alice@example.com');
    const { secret, token } = await personalToken(alice, ['finance:read']);
    const listed = await call<AccessTokenDto[]>('/api/access/tokens', { member: alice });
    expect(listed.body.map((t) => t.id)).toEqual([token.id]);

    const res = await call(`/api/access/tokens/${token.id}`, { method: 'DELETE', member: alice });
    expect(res.status).toBe(204);
    expect((await mcp(secret, 'tools/list')).status).toBe(401);
    expect((await call<AccessTokenDto[]>('/api/access/tokens', { member: alice })).body).toEqual(
      [],
    );
  });
});

describe('OAuth 2.1 for MCP clients', () => {
  const redirect = 'https://chatgpt.example/connector/callback';
  const verifier = 'v'.repeat(64);

  async function raw(path: string, init: RequestInit = {}) {
    return exports.default.fetch(new Request(`${ORIGIN}${path}`, { redirect: 'manual', ...init }));
  }

  async function connect(member: Member, scopes: Scope[]) {
    const registered = await raw('/api/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [redirect] }),
    });
    expect(registered.status).toBe(201);
    const client = (await registered.json()) as { client_id: string };

    const authorize = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: redirect,
      code_challenge: await sha256Base64Url(verifier),
      code_challenge_method: 'S256',
      scope: 'finance:read planner:read',
      state: 'xyz',
    });
    const start = await raw(`/api/oauth/authorize?${authorize}`);
    expect(start.status).toBe(302);
    const consent = new URL(start.headers.get('Location') ?? '');
    expect(consent.origin + consent.pathname).toBe(`${WEB_ORIGIN}/oauth/consent`);
    const request = consent.searchParams.get('request') ?? '';

    const described = await call<{ clientName: string; scopes: Scope[]; redirectHost: string }>(
      `/api/access/oauth/requests/${request}`,
      { member },
    );
    expect(described.body).toMatchObject({
      clientName: 'ChatGPT',
      redirectHost: 'chatgpt.example',
      scopes: ['finance:read', 'planner:read'],
    });

    const decided = await call<{ redirectUrl: string }>(`/api/access/oauth/requests/${request}`, {
      method: 'POST',
      member,
      body: json({ approve: true, scopes }),
    });
    const back = new URL(decided.body.redirectUrl);
    expect(back.searchParams.get('state')).toBe('xyz');
    return { client, code: back.searchParams.get('code') ?? '' };
  }

  async function token(body: Record<string, string>) {
    const res = await raw('/api/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
    return { status: res.status, body: (await res.json()) as Record<string, string> };
  }

  it('publishes the discovery documents at the origin root', async () => {
    const resource = await raw('/.well-known/oauth-protected-resource/api/mcp');
    expect(await resource.json()).toMatchObject({
      resource: `${WEB_ORIGIN}/api/mcp`,
      authorization_servers: [WEB_ORIGIN],
    });
    const server = await raw('/.well-known/oauth-authorization-server');
    expect(await server.json()).toMatchObject({
      registration_endpoint: `${WEB_ORIGIN}/api/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('connects with consent and PKCE, rotates refresh tokens, and revokes', async () => {
    const alice = await createMember('alice@example.com');
    await createAccount(alice, 'Card', 'PLN', '5');
    const { client, code } = await connect(alice, ['finance:read']);

    const wrong = await token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
      client_id: client.client_id,
      code_verifier: 'w'.repeat(64),
    });
    // A wrong verifier burns the code too: it is single use.
    expect(wrong).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });

    const { client: secondClient, code: second } = await connect(alice, ['finance:read']);
    const issued = await token({
      grant_type: 'authorization_code',
      code: second,
      redirect_uri: redirect,
      client_id: secondClient.client_id,
      code_verifier: verifier,
    });
    expect(issued.status).toBe(200);
    expect(issued.body).toMatchObject({ token_type: 'Bearer', scope: 'finance:read' });
    const access = issued.body.access_token ?? '';
    const read = await tool(access, 'finance_list_accounts');
    expect((read.structuredContent?.items as unknown[]).length).toBe(1);

    const replay = await token({
      grant_type: 'authorization_code',
      code: second,
      redirect_uri: redirect,
      client_id: secondClient.client_id,
      code_verifier: verifier,
    });
    expect(replay.status).toBe(400);

    const refreshed = await token({
      grant_type: 'refresh_token',
      refresh_token: issued.body.refresh_token ?? '',
    });
    expect(refreshed.status).toBe(200);
    // The old refresh token and the old access token no longer work.
    expect(
      (await token({ grant_type: 'refresh_token', refresh_token: issued.body.refresh_token ?? '' }))
        .status,
    ).toBe(400);
    expect((await mcp(access, 'tools/list')).status).toBe(401);
    const fresh = refreshed.body.access_token ?? '';
    expect((await mcp(fresh, 'tools/list')).status).toBe(200);

    const connections = await call<AccessTokenDto[]>('/api/access/tokens', { member: alice });
    expect(connections.body).toEqual([expect.objectContaining({ kind: 'oauth', name: 'ChatGPT' })]);

    await raw('/api/oauth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: fresh }).toString(),
    });
    expect((await mcp(fresh, 'tools/list')).status).toBe(401);
  });

  it('a denied request returns access_denied; unknown redirect URIs are never followed', async () => {
    const alice = await createMember('alice@example.com');
    const registered = await raw('/api/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [redirect] }),
    });
    const { client_id } = (await registered.json()) as { client_id: string };
    const params = new URLSearchParams({
      response_type: 'code',
      client_id,
      redirect_uri: 'https://evil.example/cb',
      code_challenge: await sha256Base64Url(verifier),
      code_challenge_method: 'S256',
    });
    const evil = await raw(`/api/oauth/authorize?${params}`);
    expect(evil.status).toBe(400);
    expect(evil.headers.get('Location')).toBeNull();

    // http redirect URIs are only allowed on loopback.
    const http = await raw('/api/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://example.com/cb'] }),
    });
    expect(http.status).toBe(400);

    params.set('redirect_uri', redirect);
    const start = await raw(`/api/oauth/authorize?${params}`);
    const request = new URL(start.headers.get('Location') ?? '').searchParams.get('request') ?? '';
    const denied = await call<{ redirectUrl: string }>(`/api/access/oauth/requests/${request}`, {
      method: 'POST',
      member: alice,
      body: json({ approve: false }),
    });
    expect(new URL(denied.body.redirectUrl).searchParams.get('error')).toBe('access_denied');
  });

  it('a token of a member who left the allowlist stops working', async () => {
    const eve = await createMember('eve@example.com');
    const { secret } = await personalToken(eve, ['finance:read']);
    expect((await mcp(secret, 'tools/list')).status).toBe(200);
    await env.DB.prepare("UPDATE users SET email = 'gone@example.com' WHERE id = ?")
      .bind(eve.userId)
      .run();
    expect((await mcp(secret, 'tools/list')).status).toBe(401);
  });
});
