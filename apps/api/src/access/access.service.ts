import {
  scopeSchema,
  SCOPES,
  type AccessTokenDto,
  type oauthDecisionSchema,
  type OAuthDecisionDto,
  type OAuthRequestDto,
  type personalTokenCreateSchema,
  type PersonalTokenCreatedDto,
  type Scope,
} from '@homehub/shared';
import { z } from 'zod';
import type { AppConfig } from '../config';
import { randomToken, safeEqual, sha256Base64Url, sha256Hex } from '../lib/crypto';
import { HttpError, notFound } from '../lib/http-error';
import type { ServiceContext } from '../lib/service-context';

type Out<T extends z.ZodType> = z.output<T>;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
export const ACCESS_TOKEN_TTL_MS = 60 * MINUTE;
export const REFRESH_TOKEN_TTL_MS = 30 * DAY;
const REQUEST_TTL_MS = 10 * MINUTE;
const CODE_TTL_MS = 5 * MINUTE;
const LAST_USED_STEP_MS = MINUTE;
const READ_SCOPES = SCOPES.filter((s) => s.endsWith(':read'));

/** Secret prefixes make a leaked secret recognisable (and scannable) as a HomeHub token. */
const PREFIX = { personal: 'hh_pat_', access: 'hh_oat_', refresh: 'hh_ort_' } as const;
const newSecret = (kind: keyof typeof PREFIX) => `${PREFIX[kind]}${randomToken()}`;

const scopesFrom = (json: string): Scope[] =>
  z
    .array(z.string())
    .parse(JSON.parse(json))
    .flatMap((s) => {
      const parsed = scopeSchema.safeParse(s);
      return parsed.success ? [parsed.data] : [];
    });

/** Scopes from an OAuth `scope` parameter (space separated); unknown ones are ignored. */
export function scopesFromParam(scope: string | undefined | null): Scope[] {
  const asked = (scope ?? '')
    .split(/\s+/)
    .flatMap((s) => (scopeSchema.safeParse(s).success ? [scopeSchema.parse(s)] : []));
  return asked.length ? [...new Set(asked)] : [...READ_SCOPES];
}

/** An OAuth protocol error (RFC 6749 §5.2): answered as `{ error, error_description }`. */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status: 400 | 401 = 400,
  ) {
    super(description);
  }
}

export const clientRegistrationSchema = z.object({
  client_name: z.string().trim().min(1).max(120).optional(),
  redirect_uris: z
    .array(
      z
        .string()
        .url()
        .refine((uri) => {
          const url = new URL(uri);
          // https only, except a local client (MCP Inspector, desktop apps) on loopback.
          return (
            url.protocol === 'https:' ||
            (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
          );
        }),
    )
    .min(1)
    .max(10),
  token_endpoint_auth_method: z.literal('none').optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

export const authorizeSchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1).max(100),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal('S256'),
  scope: z.string().max(1000).optional(),
  state: z.string().max(1000).optional(),
  resource: z.string().optional(),
});

export const tokenRequestSchema = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string().min(1),
    redirect_uri: z.string().min(1),
    client_id: z.string().min(1),
    code_verifier: z.string().min(43).max(128),
  }),
  z.object({
    grant_type: z.literal('refresh_token'),
    refresh_token: z.string().min(1),
    client_id: z.string().min(1).optional(),
  }),
]);

interface TokenRow {
  id: string;
  user_id: string;
  name: string;
  client_id: string | null;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
}

/** The caller behind a bearer token: a member of a workspace with the scopes the token grants. */
export interface TokenCaller {
  ctx: ServiceContext & { userId: string };
  tokenId: string;
}

/**
 * Machine access: personal tokens and OAuth 2.1 (dynamic registration, PKCE, rotating refresh
 * tokens). A connection belongs to one member of one workspace and holds only the scopes granted;
 * its secrets are stored as SHA-256 and checked against the allowlist on every use, like sessions.
 */
export class AccessService {
  constructor(
    private readonly d1: D1Database,
    private readonly config: AppConfig,
  ) {}

  // ---- connections ---------------------------------------------------------------------------

  async list(ctx: ServiceContext): Promise<AccessTokenDto[]> {
    const rows = await this.d1
      .prepare(
        `SELECT id, user_id, name, client_id, scopes, created_at, last_used_at, expires_at
         FROM api_tokens WHERE workspace_id = ? AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
           AND EXISTS (SELECT 1 FROM api_token_secrets s WHERE s.token_id = api_tokens.id)
         ORDER BY created_at DESC`,
      )
      .bind(ctx.workspaceId, Date.now())
      .all<TokenRow>();
    return rows.results.map((r) => this.toDto(r, ctx.userId));
  }

  private toDto(r: TokenRow, userId: string | null): AccessTokenDto {
    return {
      id: r.id,
      name: r.name,
      kind: r.client_id ? 'oauth' : 'personal',
      scopes: scopesFrom(r.scopes),
      createdAt: new Date(r.created_at).toISOString(),
      lastUsedAt: r.last_used_at === null ? null : new Date(r.last_used_at).toISOString(),
      expiresAt: r.expires_at === null ? null : new Date(r.expires_at).toISOString(),
      own: r.user_id === userId,
    };
  }

  async createPersonal(
    ctx: ServiceContext,
    input: Out<typeof personalTokenCreateSchema>,
  ): Promise<PersonalTokenCreatedDto> {
    if (!ctx.userId) throw new HttpError(403, 'FORBIDDEN');
    const id = crypto.randomUUID();
    const secret = newSecret('personal');
    const now = Date.now();
    const expiresAt = input.expiresInDays === null ? null : now + input.expiresInDays * DAY;
    await this.d1.batch([
      this.d1
        .prepare(
          `INSERT INTO api_tokens (id, workspace_id, user_id, name, scopes, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          ctx.workspaceId,
          ctx.userId,
          input.name,
          JSON.stringify(input.scopes),
          expiresAt,
          now,
        ),
      this.d1
        .prepare(
          `INSERT INTO api_token_secrets (hash, token_id, kind, expires_at, created_at)
           VALUES (?, ?, 'personal', ?, ?)`,
        )
        .bind(await sha256Hex(secret), id, expiresAt, now),
    ]);
    return {
      token: {
        id,
        name: input.name,
        kind: 'personal',
        scopes: input.scopes,
        createdAt: new Date(now).toISOString(),
        lastUsedAt: null,
        expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(),
        own: true,
      },
      secret,
    };
  }

  /** Ends a connection at once: its secrets are deleted. Only its owner revokes it. */
  async revoke(ctx: ServiceContext, id: string): Promise<void> {
    const row = await this.d1
      .prepare(
        'SELECT user_id FROM api_tokens WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL',
      )
      .bind(id, ctx.workspaceId)
      .first<{ user_id: string }>();
    if (!row) throw notFound('ACCESS_TOKEN_NOT_FOUND');
    if (row.user_id !== ctx.userId) throw new HttpError(403, 'ACCESS_TOKEN_NOT_OWN');
    await this.d1.batch([
      this.d1.prepare('DELETE FROM api_token_secrets WHERE token_id = ?').bind(id),
      this.d1
        .prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND workspace_id = ?')
        .bind(Date.now(), id, ctx.workspaceId),
    ]);
  }

  /**
   * The caller of a bearer secret (a personal or an OAuth access token), or null. The member must
   * still belong to the workspace and be on the allowlist — removing an email closes its tokens too.
   */
  async authenticate(secret: string): Promise<TokenCaller | null> {
    if (!secret.startsWith(PREFIX.personal) && !secret.startsWith(PREFIX.access)) return null;
    const now = Date.now();
    const row = await this.d1
      .prepare(
        `SELECT t.id, t.workspace_id, t.user_id, t.scopes, t.last_used_at, u.email
         FROM api_token_secrets s
         JOIN api_tokens t ON t.id = s.token_id
         JOIN workspace_members m ON m.workspace_id = t.workspace_id AND m.user_id = t.user_id
         JOIN users u ON u.id = t.user_id
         WHERE s.hash = ? AND s.kind IN ('personal', 'access') AND t.revoked_at IS NULL
           AND (s.expires_at IS NULL OR s.expires_at > ?) AND (t.expires_at IS NULL OR t.expires_at > ?)`,
      )
      .bind(await sha256Hex(secret), now, now)
      .first<{
        id: string;
        workspace_id: string;
        user_id: string;
        scopes: string;
        last_used_at: number | null;
        email: string;
      }>();
    if (!row || !this.config.isEmailAllowed(row.email)) return null;
    if (!row.last_used_at || now - row.last_used_at > LAST_USED_STEP_MS)
      await this.d1
        .prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?')
        .bind(now, row.id)
        .run();
    return {
      ctx: {
        workspaceId: row.workspace_id,
        userId: row.user_id,
        scopes: new Set(scopesFrom(row.scopes)),
        tokenId: row.id,
      },
      tokenId: row.id,
    };
  }

  // ---- OAuth 2.1 -------------------------------------------------------------------------------

  /** Dynamic client registration (RFC 7591): a public client that must use PKCE. */
  async registerClient(input: z.output<typeof clientRegistrationSchema>) {
    const id = `hh_client_${randomToken()}`;
    const now = Date.now();
    const name = input.client_name ?? 'MCP';
    await this.d1
      .prepare(
        'INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)',
      )
      .bind(id, name, JSON.stringify(input.redirect_uris), now)
      .run();
    return {
      client_id: id,
      client_id_issued_at: Math.floor(now / 1000),
      client_name: name,
      redirect_uris: input.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
  }

  private async client(id: string) {
    const row = await this.d1
      .prepare('SELECT id, name, redirect_uris FROM oauth_clients WHERE id = ?')
      .bind(id)
      .first<{ id: string; name: string; redirect_uris: string }>();
    if (!row) return null;
    return { ...row, redirectUris: z.array(z.string()).parse(JSON.parse(row.redirect_uris)) };
  }

  /**
   * A valid authorization request is kept for the consent page; the browser is sent there. An
   * unknown client or redirect URI is never redirected to (RFC 6749 §4.1.2.1).
   */
  async startAuthorization(input: z.output<typeof authorizeSchema>): Promise<string> {
    const client = await this.client(input.client_id);
    if (!client) throw new OAuthError('invalid_client', 'Unknown client_id');
    if (!client.redirectUris.includes(input.redirect_uri))
      throw new OAuthError('invalid_request', 'redirect_uri is not registered for this client');
    const id = randomToken();
    await this.d1
      .prepare(
        `INSERT INTO oauth_requests (id, client_id, redirect_uri, scopes, state, code_challenge, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        client.id,
        input.redirect_uri,
        JSON.stringify(scopesFromParam(input.scope)),
        input.state ?? null,
        input.code_challenge,
        Date.now() + REQUEST_TTL_MS,
      )
      .run();
    return id;
  }

  private async request(id: string) {
    const row = await this.d1
      .prepare(
        `SELECT r.id, r.client_id, r.redirect_uri, r.scopes, r.state, r.code_challenge, r.expires_at,
           c.name AS client_name
         FROM oauth_requests r JOIN oauth_clients c ON c.id = r.client_id
         WHERE r.id = ? AND r.expires_at > ?`,
      )
      .bind(id, Date.now())
      .first<{
        id: string;
        client_id: string;
        redirect_uri: string;
        scopes: string;
        state: string | null;
        code_challenge: string;
        expires_at: number;
        client_name: string;
      }>();
    if (!row) throw notFound('OAUTH_REQUEST_NOT_FOUND');
    return row;
  }

  async describeRequest(id: string): Promise<OAuthRequestDto> {
    const r = await this.request(id);
    return {
      id: r.id,
      clientName: r.client_name,
      redirectHost: new URL(r.redirect_uri).host,
      scopes: scopesFrom(r.scopes),
      expiresAt: new Date(r.expires_at).toISOString(),
    };
  }

  /**
   * The member's answer on the consent page. Approved: a single-use code for the granted scopes
   * (the member may narrow or widen what the app asked). Denied: `access_denied` (RFC 6749).
   */
  async decide(
    ctx: ServiceContext,
    id: string,
    decision: Out<typeof oauthDecisionSchema>,
  ): Promise<OAuthDecisionDto> {
    if (!ctx.userId) throw new HttpError(403, 'FORBIDDEN');
    const r = await this.request(id);
    const redirect = new URL(r.redirect_uri);
    if (r.state) redirect.searchParams.set('state', r.state);
    const consumed = this.d1.prepare('DELETE FROM oauth_requests WHERE id = ?').bind(id);
    if (!decision.approve || decision.scopes.length === 0) {
      await consumed.run();
      redirect.searchParams.set('error', 'access_denied');
      return { redirectUrl: redirect.href };
    }
    const code = randomToken();
    await this.d1.batch([
      consumed,
      this.d1
        .prepare(
          `INSERT INTO oauth_codes (hash, client_id, redirect_uri, code_challenge, workspace_id, user_id,
             scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          await sha256Hex(code),
          r.client_id,
          r.redirect_uri,
          r.code_challenge,
          ctx.workspaceId,
          ctx.userId,
          JSON.stringify([...new Set(decision.scopes)]),
          Date.now() + CODE_TTL_MS,
        ),
    ]);
    redirect.searchParams.set('code', code);
    return { redirectUrl: redirect.href };
  }

  /** The token endpoint: an authorization code (with its PKCE verifier) or a refresh token. */
  async token(input: z.output<typeof tokenRequestSchema>) {
    return input.grant_type === 'authorization_code'
      ? this.exchangeCode(input)
      : this.refresh(input.refresh_token, input.client_id);
  }

  private async exchangeCode(
    input: Extract<z.output<typeof tokenRequestSchema>, { grant_type: 'authorization_code' }>,
  ) {
    // DELETE … RETURNING: of two exchanges of one code, exactly one gets it.
    const code = await this.d1
      .prepare(
        `DELETE FROM oauth_codes WHERE hash = ? AND expires_at > ?
         RETURNING client_id, redirect_uri, code_challenge, workspace_id, user_id, scopes`,
      )
      .bind(await sha256Hex(input.code), Date.now())
      .first<{
        client_id: string;
        redirect_uri: string;
        code_challenge: string;
        workspace_id: string;
        user_id: string;
        scopes: string;
      }>();
    if (
      !code ||
      code.client_id !== input.client_id ||
      code.redirect_uri !== input.redirect_uri ||
      !safeEqual(await sha256Base64Url(input.code_verifier), code.code_challenge)
    )
      throw new OAuthError('invalid_grant', 'The code is invalid, expired or does not match');
    const client = await this.client(code.client_id);
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.d1
      .prepare(
        `INSERT INTO api_tokens (id, workspace_id, user_id, name, client_id, scopes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        code.workspace_id,
        code.user_id,
        client?.name ?? 'MCP',
        code.client_id,
        code.scopes,
        now,
      )
      .run();
    return this.issue(id, code.scopes);
  }

  /** Refresh tokens rotate: the used one is deleted together with the old access tokens. */
  private async refresh(refreshToken: string, clientId: string | undefined) {
    const hash = await sha256Hex(refreshToken);
    const row = await this.d1
      .prepare(
        `DELETE FROM api_token_secrets WHERE hash = ? AND kind = 'refresh' AND expires_at > ?
         RETURNING token_id`,
      )
      .bind(hash, Date.now())
      .first<{ token_id: string }>();
    const token = row
      ? await this.d1
          .prepare(
            'SELECT id, client_id, scopes FROM api_tokens WHERE id = ? AND revoked_at IS NULL',
          )
          .bind(row.token_id)
          .first<{ id: string; client_id: string | null; scopes: string }>()
      : null;
    if (!token || (clientId && token.client_id !== clientId))
      throw new OAuthError('invalid_grant', 'The refresh token is invalid, used or revoked');
    await this.d1
      .prepare("DELETE FROM api_token_secrets WHERE token_id = ? AND kind = 'access'")
      .bind(token.id)
      .run();
    return this.issue(token.id, token.scopes);
  }

  private async issue(tokenId: string, scopes: string) {
    const access = newSecret('access');
    const refresh = newSecret('refresh');
    const now = Date.now();
    const insert = (secret: string, kind: 'access' | 'refresh', ttl: number) =>
      sha256Hex(secret).then((hash) =>
        this.d1
          .prepare(
            'INSERT INTO api_token_secrets (hash, token_id, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
          )
          .bind(hash, tokenId, kind, now + ttl, now),
      );
    await this.d1.batch([
      await insert(access, 'access', ACCESS_TOKEN_TTL_MS),
      await insert(refresh, 'refresh', REFRESH_TOKEN_TTL_MS),
    ]);
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_MS / 1000,
      refresh_token: refresh,
      scope: scopesFrom(scopes).join(' '),
    };
  }

  /** Token revocation (RFC 7009): a known secret ends its connection; unknown ones are ignored. */
  async revokeSecret(secret: string): Promise<void> {
    const row = await this.d1
      .prepare('SELECT token_id FROM api_token_secrets WHERE hash = ?')
      .bind(await sha256Hex(secret))
      .first<{ token_id: string }>();
    if (!row) return;
    await this.d1.batch([
      this.d1.prepare('DELETE FROM api_token_secrets WHERE token_id = ?').bind(row.token_id),
      this.d1
        .prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ?')
        .bind(Date.now(), row.token_id),
    ]);
  }

  /** Daily cleanup: expired requests, codes and secrets; clients nobody connected for a week. */
  async deleteExpired(now = Date.now()): Promise<void> {
    await this.d1.batch([
      this.d1.prepare('DELETE FROM oauth_requests WHERE expires_at < ?').bind(now),
      this.d1.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').bind(now),
      this.d1.prepare('DELETE FROM api_token_secrets WHERE expires_at < ?').bind(now),
      this.d1
        .prepare(
          `DELETE FROM oauth_clients WHERE created_at < ? AND NOT EXISTS (
             SELECT 1 FROM api_tokens t WHERE t.client_id = oauth_clients.id AND t.revoked_at IS NULL)`,
        )
        .bind(now - 7 * DAY),
    ]);
  }

  /** Records a write a tool made (the audit of machine access). */
  audit(caller: TokenCaller, tool: string, errorCode: string | null) {
    return this.d1
      .prepare(
        `INSERT INTO mcp_audit (id, workspace_id, user_id, token_id, tool, ok, error_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        caller.ctx.workspaceId,
        caller.ctx.userId,
        caller.tokenId,
        tool,
        errorCode ? 0 : 1,
        errorCode,
        Date.now(),
      )
      .run();
  }
}
