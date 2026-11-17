import type { CookieOptions } from 'hono/utils/cookie';
import type { AppConfig } from '../config';

/**
 * In production the `__Host-` prefix makes the browser reject the cookie unless it is
 * Secure, has Path=/ and no Domain — so it cannot be set or overridden by a subdomain.
 */
export function sessionCookieName(config: AppConfig): string {
  return config.isProduction ? '__Host-hh_session' : 'hh_session';
}

function baseOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProduction,
    // Lax: sent on top-level navigation,
    // never on cross-site POST/fetch. Mutations are additionally protected by a CSRF token.
    sameSite: 'Lax',
    path: '/',
  };
}

export function sessionCookieOptions(config: AppConfig, expiresAt: Date): CookieOptions {
  return { ...baseOptions(config), expires: expiresAt };
}

export function clearCookieOptions(config: AppConfig): CookieOptions {
  return baseOptions(config);
}
