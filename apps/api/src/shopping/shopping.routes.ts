import { shoppingAddSchema, shoppingUpdateSchema } from '@homehub/shared';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../app-env';
import { requireCsrf } from '../auth/csrf.middleware';
import { requireSession } from '../auth/session.middleware';
import { requireArea } from '../lib/scope.middleware';
import { parseBody, uuidParam } from '../lib/validation';

const ws = (c: Context<AppEnv>) => c.var.auth.workspaceId;
const shopping = (c: Context<AppEnv>) => c.var.services.shopping;

/** The shared shopping list: every member of the workspace can add, tick off and clear. */
export const shoppingRoutes = new Hono<AppEnv>()
  .use('*', requireSession, requireCsrf, requireArea('household'))
  .get('/', async (c) => c.json(await shopping(c).list(ws(c))))
  .post('/', async (c) =>
    c.json(
      await shopping(c).add(ws(c), c.var.auth.userId, await parseBody(c, shoppingAddSchema)),
      201,
    ),
  )
  .post('/clear', async (c) => c.json(await shopping(c).clearChecked(ws(c))))
  .patch('/:id', async (c) =>
    c.json(await shopping(c).update(ws(c), uuidParam(c), await parseBody(c, shoppingUpdateSchema))),
  )
  .delete('/:id', async (c) => {
    await shopping(c).remove(ws(c), uuidParam(c));
    return c.body(null, 204);
  });
