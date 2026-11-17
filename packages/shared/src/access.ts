import { z } from 'zod';

/**
 * Machine access to HomeHub (MCP clients, integrations): coarse permissions by area. A member's
 * browser session holds every scope; a token holds only the scopes its owner granted.
 */
export const SCOPES = [
  'finance:read',
  'finance:write',
  'planner:read',
  'planner:write',
  'savings:read',
  'savings:write',
  'household:read',
  'household:write',
] as const;
export const scopeSchema = z.enum(SCOPES);
export type Scope = z.infer<typeof scopeSchema>;

/** Areas in the order the settings page shows them. */
export const SCOPE_AREAS = ['finance', 'planner', 'savings', 'household'] as const;
export type ScopeArea = (typeof SCOPE_AREAS)[number];

/** Areas without a write scope: HomeHub changes nothing there (conversations are read only). */

export const READ_ONLY_AREAS: ReadonlySet<ScopeArea> = new Set();

const scopeList = z
  .array(scopeSchema)
  .min(1, 'VALIDATION_SCOPES_REQUIRED')
  .transform((scopes) => [...new Set(scopes)]);

/** A personal access token: for MCP clients that take a bearer token (Claude Code, Cursor …). */
export const personalTokenCreateSchema = z.object({
  name: z.string().trim().min(1, 'VALIDATION_NAME_REQUIRED').max(80),
  scopes: scopeList,
  /** Days until it stops working; null — until revoked. */
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).nullable(),
});
export type PersonalTokenCreateInput = z.input<typeof personalTokenCreateSchema>;

/** The user's decision on an OAuth connection request (the consent page). */
export const oauthDecisionSchema = z.object({
  approve: z.boolean(),
  scopes: z.array(scopeSchema).default([]),
});
export type OAuthDecisionInput = z.input<typeof oauthDecisionSchema>;

/** A connection: a personal token or an app connected through OAuth. Secrets are never shown again. */
export interface AccessTokenDto {
  id: string;
  name: string;
  kind: 'personal' | 'oauth';
  scopes: Scope[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  /** Created by this user (others' connections are listed, only their owner revokes them). */
  own: boolean;
}

export interface PersonalTokenCreatedDto {
  token: AccessTokenDto;
  /** Shown once: only its hash is stored. */
  secret: string;
}

export interface OAuthRequestDto {
  id: string;
  clientName: string;
  /** Where the app sends the user back (its host), to recognise the app. */
  redirectHost: string;
  scopes: Scope[];
  expiresAt: string;
}

export interface OAuthDecisionDto {
  redirectUrl: string;
}
