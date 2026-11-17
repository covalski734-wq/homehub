import { oauthDecisionSchema, personalTokenCreateSchema } from '@homehub/shared';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../app-env';
import { requireCsrf } from '../auth/csrf.middleware';
import { requireSession } from '../auth/session.middleware';
import { serviceContext } from '../lib/http-context';
import { parseBody, parseWith, uuidParam } from '../lib/validation';
import {
  authorizeSchema,
  clientRegistrationSchema,
  OAuthError,
  tokenRequestSchema,
} from './access.service';
import { z } from 'zod';

/**
 * A member's connections (Settings → access for AI): personal tokens and connected OAuth apps,
 * and the consent page's API. Session + CSRF like every page of the app.
 */
export const accessRoutes = new Hono<AppEnv>()
  .use('*', requireSession, requireCsrf)
  .get('/tokens', async (c) => c.json(await c.var.services.access.list(serviceContext(c))))
  .post('/tokens', async (c) =>
    c.json(
      await c.var.services.access.createPersonal(
        serviceContext(c),
        await parseBody(c, personalTokenCreateSchema),
      ),
      201,
    ),
  )
  .delete('/tokens/:id', async (c) => {
    await c.var.services.access.revoke(serviceContext(c), uuidParam(c));
    return c.body(null, 204);
  })
  .get('/oauth/requests/:request', async (c) =>
    c.json(await c.var.services.access.describeRequest(requestId(c))),
  )
  .post('/oauth/requests/:request', async (c) =>
    c.json(
      await c.var.services.access.decide(
        serviceContext(c),
        requestId(c),
        await parseBody(c, oauthDecisionSchema),
      ),
    ),
  );

const requestId = (c: Context<AppEnv>) =>
  parseWith(
    z.string().regex(/^[A-Za-z0-9_-]{20,64}$/, 'VALIDATION_INVALID'),
    c.req.param('request'),
  );

/** OAuth answers errors in its own shape (RFC 6749 §5.2), never as an app error body. */
function oauthError(c: Context<AppEnv>, error: unknown) {
  if (error instanceof OAuthError)
    return c.json({ error: error.error, error_description: error.description }, error.status);
  throw error;
}

async function formOrJson(c: Context<AppEnv>): Promise<unknown> {
  const type = c.req.header('content-type') ?? '';
  if (type.includes('application/json')) return c.req.json().catch(() => ({}));
  return Object.fromEntries(new URLSearchParams(await c.req.text()));
}

/**
 * OAuth 2.1 for MCP clients (ChatGPT, claude.ai …): public endpoints without cookies. The consent
 * itself happens in the app, after the member's usual sign-in (/oauth/consent).
 */
export const oauthRoutes = new Hono<AppEnv>()
  .post('/register', async (c) => {
    const input = clientRegistrationSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      return c.json(
        {
          error: 'invalid_client_metadata',
          error_description: 'redirect_uris must be https (or loopback)',
        },
        400,
      );
    return c.json(await c.var.services.access.registerClient(input.data), 201);
  })
  .get('/authorize', async (c) => {
    const input = authorizeSchema.safeParse(c.req.query());
    if (!input.success)
      return c.json(
        { error: 'invalid_request', error_description: 'code with PKCE S256 is required' },
        400,
      );
    try {
      const request = await c.var.services.access.startAuthorization(input.data);
      const consent = new URL('/oauth/consent', c.var.config.webOrigin);
      consent.searchParams.set('request', request);
      return c.redirect(consent.href, 302);
    } catch (error) {
      return oauthError(c, error);
    }
  })
  .post('/token', async (c) => {
    const input = tokenRequestSchema.safeParse(await formOrJson(c));
    if (!input.success)
      return c.json({ error: 'invalid_request', error_description: 'unsupported request' }, 400);
    try {
      const tokens = await c.var.services.access.token(input.data);
      c.header('Cache-Control', 'no-store');
      return c.json(tokens);
    } catch (error) {
      return oauthError(c, error);
    }
  })
  .post('/revoke', async (c) => {
    const body = z.object({ token: z.string().min(1) }).safeParse(await formOrJson(c));
    if (body.success) await c.var.services.access.revokeSecret(body.data.token);
    return c.body(null, 200);
  });
