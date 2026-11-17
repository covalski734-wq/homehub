import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { workspaceMembers } from './schema';

/**
 * Machine access (migration 0024): MCP clients and integrations act for a member through a token.
 *
 * - `api_tokens` — a connection: a personal token, or an app connected through OAuth (`client_id`).
 *   It carries the granted scopes; revoking it ends every secret it has.
 * - `api_token_secrets` — the secrets of a connection, stored only as SHA-256: one `personal`
 *   secret, or rotating OAuth `access` / `refresh` secrets.
 * - `oauth_clients` — apps registered through dynamic client registration (public clients, PKCE).
 * - `oauth_requests` — an authorization request waiting for the member's consent (minutes).
 * - `oauth_codes` — authorization codes (SHA-256, single use, minutes).
 * - `mcp_audit` — every write a tool made: who, through which connection, which tool, result.
 */

export const oauthClients = sqliteTable('oauth_clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** JSON array of exact redirect URIs. */
  redirectUris: text('redirect_uris').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    clientId: text('client_id').references(() => oauthClients.id, { onDelete: 'cascade' }),
    /** JSON array of scopes. */
    scopes: text('scopes').notNull(),
    expiresAt: integer('expires_at'),
    lastUsedAt: integer('last_used_at'),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.userId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }).onDelete('cascade'),
    index('api_tokens_workspace_idx').on(t.workspaceId),
  ],
);

export const apiTokenSecrets = sqliteTable(
  'api_token_secrets',
  {
    hash: text('hash').primaryKey(),
    tokenId: text('token_id')
      .notNull()
      .references(() => apiTokens.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['personal', 'access', 'refresh'] }).notNull(),
    expiresAt: integer('expires_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('api_token_secrets_token_idx').on(t.tokenId),
    check('api_token_secrets_kind', sql`${t.kind} IN ('personal', 'access', 'refresh')`),
  ],
);

export const oauthRequests = sqliteTable('oauth_requests', {
  id: text('id').primaryKey(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClients.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  scopes: text('scopes').notNull(),
  state: text('state'),
  codeChallenge: text('code_challenge').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const oauthCodes = sqliteTable(
  'oauth_codes',
  {
    hash: text('hash').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.id, { onDelete: 'cascade' }),
    redirectUri: text('redirect_uri').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    workspaceId: text('workspace_id').notNull(),
    userId: text('user_id').notNull(),
    scopes: text('scopes').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.userId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }).onDelete('cascade'),
  ],
);

export const mcpAudit = sqliteTable(
  'mcp_audit',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    userId: text('user_id').notNull(),
    tokenId: text('token_id').notNull(),
    tool: text('tool').notNull(),
    ok: integer('ok').notNull(),
    errorCode: text('error_code'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.workspaceId, t.userId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }).onDelete('cascade'),
    index('mcp_audit_workspace_idx').on(t.workspaceId, t.createdAt),
  ],
);
