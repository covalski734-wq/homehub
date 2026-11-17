import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { call, json, resetDb, WEB_ORIGIN } from '../helpers';
beforeEach(resetDb);
const login = (
  password = 'test-only-password-12345',
  origin = WEB_ORIGIN,
  email = 'alice@example.com',
) => call('/api/auth/login', { method: 'POST', origin, body: json({ email, password }) });
describe('configured accounts', () => {
  it('creates a household only after valid login, with no financial seed data', async () => {
    expect(await env.DB.prepare('SELECT count(*) AS n FROM users').first('n')).toBe(0);
    const response = await login();
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    const me = await call('/api/auth/me', { headers: { Cookie: cookie.split(';')[0]! } });
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('alice@example.com');
    expect(await env.DB.prepare('SELECT count(*) AS n FROM accounts').first('n')).toBe(0);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM purchases').first('n')).toBe(0);
  });
  it('rejects invalid credentials without creating a user', async () => {
    expect((await login('wrong')).status).toBe(401);
    expect((await login('wrong', WEB_ORIGIN, 'unknown@example.com')).status).toBe(401);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM users').first('n')).toBe(0);
  });
  it('rejects cross-origin login', async () => {
    expect((await login(undefined, 'https://untrusted.example.com')).status).toBe(403);
  });
  it('limits attempts persistently', async () => {
    for (let i = 0; i < 10; i++) expect((await login('wrong')).status).toBe(401);
    expect((await login()).status).toBe(429);
  });
  it('does not expose signup', async () => {
    expect(
      (
        await call('/api/auth/register', {
          method: 'POST',
          body: json({ email: 'unknown@example.com' }),
        })
      ).status,
    ).toBe(404);
  });
});
