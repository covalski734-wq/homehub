import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AppEnv } from '../app-env';
import { sha256Hex } from '../lib/crypto';
import { clearCookieOptions, sessionCookieName, sessionCookieOptions } from './cookies';
import { requireCsrf } from './csrf.middleware';
import { requireSession } from './session.middleware';
import { verifyPassword } from './password';
const input = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(256),
});
export const authRoutes = new Hono<AppEnv>()
  .post('/login', async (c) => {
    const { config, services } = c.var;
    c.header('Cache-Control', 'no-store');
    if (c.req.header('Origin') !== config.webOrigin)
      return c.json({ error: 'Invalid origin' }, 403);
    const parsed = input.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid credentials' }, 400);
    const now = Date.now();
    for (const [value, limit] of [
      ['ip:' + (c.req.header('cf-connecting-ip') ?? 'local'), 30],
      ['email:' + parsed.data.email, 10],
    ] as const) {
      const key = await sha256Hex(value);
      const row = await c.env.DB.prepare(
        'INSERT INTO login_attempts (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count',
      )
        .bind(key, now + 900000, now, now)
        .first<{ count: number }>();
      if (!row || row.count > limit) {
        c.header('Retry-After', '900');
        return c.json({ error: 'Too many attempts' }, 429);
      }
    }
    const user = config.users.find((u) => u.email === parsed.data.email);
    const valid = await verifyPassword(
      parsed.data.password,
      user?.passwordHash ??
        'pbkdf2:100000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000',
    );
    if (!user || !valid) return c.json({ error: 'Invalid credentials' }, 401);
    const { token, expiresAt, workspaceId } = await services.auth.completePasswordLogin(
      { sub: user.email, email: user.email, name: user.name, picture: null, emailVerified: true },
      {
        userAgent: c.req.header('user-agent') ?? null,
        ipAddress: c.req.header('cf-connecting-ip') ?? null,
      },
      getCookie(c, sessionCookieName(config)) ?? null,
    );
    if (workspaceId) await services.members.ensureLogins(workspaceId);
    setCookie(c, sessionCookieName(config), token, sessionCookieOptions(config, expiresAt));
    return c.json({ ok: true });
  })
  .get('/me', requireSession, async (c) =>
    c.json(await c.var.services.auth.getMe(c.var.auth.sessionId)),
  )
  .post('/logout', requireSession, requireCsrf, async (c) => {
    await c.var.services.auth.revokeSession(c.var.auth.sessionId);
    deleteCookie(c, sessionCookieName(c.var.config), clearCookieOptions(c.var.config));
    return c.body(null, 204);
  });
