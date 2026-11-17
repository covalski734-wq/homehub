import { scenarioMonthSchema, scenarioQuerySchema, scenarioUpdateSchema } from '@homehub/shared';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../app-env';
import { requireCsrf } from '../auth/csrf.middleware';
import { requireSession } from '../auth/session.middleware';
import { requireArea } from '../lib/scope.middleware';
import { parseBody, parseQuery } from '../lib/validation';

const scenarios = (c: Context<AppEnv>) => c.var.services.scenarios.forViewer(c.var.auth.userId);

export const scenariosRoutes = new Hono<AppEnv>()
  .use('*', requireSession, requireCsrf, requireArea('savings'))
  .get('/', async (c) => {
    const query = parseQuery(c, scenarioQuerySchema);
    return c.json(await scenarios(c).compute(c.var.auth.workspaceId, query.from, query.months));
  })
  .put('/months', async (c) => {
    await scenarios(c).setMonth(c.var.auth.workspaceId, await parseBody(c, scenarioMonthSchema));
    const query = parseQuery(c, scenarioQuerySchema);
    return c.json(await scenarios(c).compute(c.var.auth.workspaceId, query.from, query.months));
  })
  .put('/', async (c) => {
    await scenarios(c).update(c.var.auth.workspaceId, await parseBody(c, scenarioUpdateSchema));
    const query = parseQuery(c, scenarioQuerySchema);
    return c.json(await scenarios(c).compute(c.var.auth.workspaceId, query.from, query.months));
  });
