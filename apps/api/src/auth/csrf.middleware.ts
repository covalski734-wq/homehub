import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app-env';
import { safeEqual } from '../lib/crypto';
import { HttpError } from '../lib/http-error';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'X-CSRF-Token';

function requestOrigin(origin: string | undefined, referer: string | undefined): string | null {
  if (origin) return origin;
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * Two independent checks for state-changing requests:
 * 1. Origin (or Referer) must be the web app origin, when the browser sends it.
 * 2. Synchronizer token: X-CSRF-Token must equal the token bound to the session.
 *    A foreign site cannot read it, because GET /auth/me is not readable cross-origin.
 * Runs after requireSession.
 */
export const requireCsrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();

  const origin = requestOrigin(c.req.header('origin'), c.req.header('referer'));
  if (origin && origin !== c.var.config.webOrigin) {
    throw new HttpError(403, 'AUTH_CSRF_ORIGIN');
  }

  const token = c.req.header(CSRF_HEADER);
  if (!token || !safeEqual(token, c.var.auth.csrfToken)) {
    throw new HttpError(403, 'AUTH_CSRF_TOKEN');
  }
  await next();
};
