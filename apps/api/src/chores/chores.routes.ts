import {
  choreCompleteSchema,
  choreCreateSchema,
  choreSnoozeSchema,
  choreUpdateSchema,
  dateSchema,
  todayDate,
} from '@homehub/shared';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app-env';
import { requireCsrf } from '../auth/csrf.middleware';
import { requireSession } from '../auth/session.middleware';
import { requireArea } from '../lib/scope.middleware';
import { parseBody, parseQuery, uuidParam } from '../lib/validation';

const ws = (c: Context<AppEnv>) => c.var.auth.workspaceId;
const chores = (c: Context<AppEnv>) => c.var.services.chores;
/** The member's local date (the server runs in UTC and does not know the household's zone). */
const todayQuery = z.object({
  today: dateSchema.optional(),
});
const today = (c: Context<AppEnv>) => parseQuery(c, todayQuery).today ?? todayDate();

/** Household chores: every member of the workspace can read, edit and tick them off. */
export const choresRoutes = new Hono<AppEnv>()
  .use('*', requireSession, requireCsrf, requireArea('household'))
  .get('/', async (c) => c.json(await chores(c).overview(ws(c), today(c))))
  .post('/', async (c) =>
    c.json(
      await chores(c).create(ws(c), c.var.auth.userId, await parseBody(c, choreCreateSchema)),
      201,
    ),
  )
  .patch('/:id', async (c) =>
    c.json(await chores(c).update(ws(c), uuidParam(c), await parseBody(c, choreUpdateSchema))),
  )
  .delete('/:id', async (c) => {
    await chores(c).remove(ws(c), uuidParam(c));
    return c.body(null, 204);
  })
  .post('/:id/complete', async (c) =>
    c.json(
      await chores(c).complete(
        ws(c),
        c.var.auth.userId,
        uuidParam(c),
        await parseBody(c, choreCompleteSchema),
      ),
    ),
  )
  .post('/:id/snooze', async (c) =>
    c.json(
      await chores(c).snooze(ws(c), uuidParam(c), await parseBody(c, choreSnoozeSchema), today(c)),
    ),
  )
  .delete('/completions/:id', async (c) => c.json(await chores(c).undo(ws(c), uuidParam(c))));
