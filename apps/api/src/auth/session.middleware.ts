import type { ErrorCode } from '@homehub/shared';
import { idempotent } from '../lib/idempotency';
import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../app-env';
import { HttpError } from '../lib/http-error';
import { MEMBER_SCOPES } from '../lib/service-context';
import { clearCookieOptions, sessionCookieName, sessionCookieOptions } from './cookies';

const unauthorized = (code: ErrorCode) => new HttpError(401, code);

/**
 * Every /api route requires a valid server-side session unless it is registered before this
 * middleware (health, login start, OAuth callback). The allowlist is re-checked on every
 * request, so removing an email from ALLOWED_EMAILS revokes access immediately.
 */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { config, services } = c.var;
  const cookieName = sessionCookieName(config);
  const token = getCookie(c, cookieName);
  if (!token) throw unauthorized('UNAUTHENTICATED');

  const session = await services.auth.validateSession(token);
  if (!session) {
    deleteCookie(c, cookieName, clearCookieOptions(config));
    throw unauthorized('SESSION_EXPIRED');
  }

  if (!config.isEmailAllowed(session.email) || !session.workspaceId) {
    await services.auth.revokeSession(session.id);
    deleteCookie(c, cookieName, clearCookieOptions(config));
    throw unauthorized('ACCESS_REVOKED');
  }

  if (session.renewed) {
    setCookie(c, cookieName, token, sessionCookieOptions(config, session.expiresAt));
  }

  c.set('auth', {
    sessionId: session.id,
    userId: session.userId,
    email: session.email,
    workspaceId: session.workspaceId,
    csrfToken: session.csrfToken,
    scopes: MEMBER_SCOPES,
  });
  // Demo mode picks the workspace first, so a replayed write is looked up where it was made.
  c.header('Cache-Control', 'no-store');
  await idempotent(c, next);
};
