import { SCOPES, type Scope } from '@homehub/shared';
import { HttpError } from './http-error';

/**
 * Who calls a service and what they may do. HTTP builds it from the session, cron from the
 * workspace it works on, MCP and integrations from the grant of their token (access/tokens.service.ts).
 * Services take it as an argument and never read it from a request, so any transport can call
 * them and a context can never leak from one caller into another.
 */
export interface ServiceContext {
  workspaceId: string;
  /** The acting user (for cron: the household's first member, or null when there is none). */
  userId: string | null;
  scopes: ReadonlySet<Scope>;
  /** MCP and integrations: the token that acts (audit records name it). */
  tokenId?: string;
}

/**
 * Coarse permissions by area (`SCOPES` in @homehub/shared). Every member of a household reads and
 * edits everything (the product decision so far, see ARCHITECTURE.md), so a session gets all
 * scopes; a token (MCP, integrations) gets only the scopes its owner granted.
 */
export { SCOPES, type Scope };

export const MEMBER_SCOPES: ReadonlySet<Scope> = new Set(SCOPES);

export function memberContext(workspaceId: string, userId: string | null): ServiceContext {
  return { workspaceId, userId, scopes: MEMBER_SCOPES };
}

/** Throws 403 unless the context holds the scope. */
export function requireScope(ctx: ServiceContext, scope: Scope): void {
  if (!ctx.scopes.has(scope)) throw new HttpError(403, 'ACCESS_SCOPE_MISSING', { scope });
}

/** The acting user for writes that record an author. */
export function actor(ctx: ServiceContext): string {
  if (!ctx.userId) throw new HttpError(403, 'FORBIDDEN');
  return ctx.userId;
}
