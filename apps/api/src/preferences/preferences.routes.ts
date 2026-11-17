import { preferencesUpdateSchema } from '@homehub/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { requireCsrf } from '../auth/csrf.middleware';
import { requireSession } from '../auth/session.middleware';
import { parseBody } from '../lib/validation';

/** Per-user language and colour labels; every user changes only their own row. */
export const preferencesRoutes = new Hono<AppEnv>()
  .use('*', requireSession, requireCsrf)
  .get('/', async (c) => c.json(await c.var.services.preferences.get(c.var.auth.userId)))
  .patch('/', async (c) =>
    c.json(
      await c.var.services.preferences.update(
        c.var.auth.userId,
        await parseBody(c, preferencesUpdateSchema),
      ),
    ),
  );
