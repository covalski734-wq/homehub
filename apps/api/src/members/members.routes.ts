import { memberCreateSchema, memberUpdateSchema } from '@homehub/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { requireCsrf } from '../auth/csrf.middleware';
import { requireSession } from '../auth/session.middleware';
import { requireArea } from '../lib/scope.middleware';
import { serviceContext } from '../lib/http-context';
import { parseBody, uuidParam } from '../lib/validation';

export const membersRoutes = new Hono<AppEnv>()
  .use('*', requireSession, requireCsrf, requireArea('household'))
  .get('/', async (c) => c.json(await c.var.services.members.list(c.var.auth.workspaceId)))
  .post('/', async (c) =>
    c.json(
      await c.var.services.members.create(
        serviceContext(c),
        await parseBody(c, memberCreateSchema),
      ),
      201,
    ),
  )
  .patch('/:id', async (c) =>
    c.json(
      await c.var.services.members.update(
        serviceContext(c),
        uuidParam(c),
        await parseBody(c, memberUpdateSchema),
      ),
    ),
  );
