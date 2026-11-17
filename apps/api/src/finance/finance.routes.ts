import {
  accountCreateSchema,
  accountUpdateSchema,
  reconcileSchema,
  accountTopupSchema,
  budgetCopySchema,
  budgetQuerySchema,
  budgetUpsertSchema,
  summaryQuerySchema,
  transactionInputSchema,
  transactionQuerySchema,
  type CategoryDto,
} from '@homehub/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../app-env';
import { requireCsrf } from '../auth/csrf.middleware';
import { requireSession } from '../auth/session.middleware';
import { serviceContext } from '../lib/http-context';
import { requireArea } from '../lib/scope.middleware';
import { parseBody, parseQuery, uuidParam } from '../lib/validation';

/** All finance routes are private: session first, then CSRF for state-changing methods. */
function privateRouter() {
  return new Hono<AppEnv>().use('*', requireSession, requireCsrf, requireArea('finance'));
}

export const accountsRoutes = privateRouter()
  .get('/', async (c) => c.json(await c.var.services.accounts.list(c.var.auth.workspaceId)))
  .get('/totals', async (c) => c.json(await c.var.services.accounts.totals(c.var.auth.workspaceId)))
  .post('/', async (c) => {
    const body = await parseBody(c, accountCreateSchema);
    return c.json(await c.var.services.accounts.create(c.var.auth.workspaceId, body), 201);
  })
  .patch('/:id', async (c) => {
    const id = uuidParam(c);
    const body = await parseBody(c, accountUpdateSchema);
    return c.json(await c.var.services.accounts.update(c.var.auth.workspaceId, id, body));
  })
  .post('/:id/topup', async (c) => {
    const id = uuidParam(c);
    const body = await parseBody(c, accountTopupSchema);
    return c.json(await c.var.services.accounts.topup(serviceContext(c), id, body));
  })
  .post('/:id/reconcile', async (c) => {
    const id = uuidParam(c);
    const body = await parseBody(c, reconcileSchema);
    return c.json(
      await c.var.services.accounts.reconcile(serviceContext(c), id, body.balance, body.date),
    );
  });

export const categoriesRoutes = privateRouter().get('/', async (c) => {
  const rows = await c.var.services.categories.list(c.var.auth.workspaceId);
  return c.json(
    rows.map(({ id, name, kind, color, isSystem, systemKey }): CategoryDto => ({
      id,
      name,
      kind,
      color,
      isSystem,
      systemKey,
    })),
  );
});

export const transactionsRoutes = privateRouter()
  .get('/', async (c) => {
    const query = parseQuery(c, transactionQuerySchema);
    return c.json(await c.var.services.transactions.list(c.var.auth.workspaceId, query));
  })
  .post('/', async (c) => {
    const body = await parseBody(c, transactionInputSchema);
    return c.json(await c.var.services.transactions.create(serviceContext(c), body), 201);
  })
  // Full replacement: the client always sends the complete operation.
  .put('/:id', async (c) => {
    const id = uuidParam(c);
    const body = await parseBody(c, transactionInputSchema);
    return c.json(await c.var.services.transactions.update(serviceContext(c), id, body));
  })
  .delete('/:id', async (c) => {
    await c.var.services.transactions.remove(serviceContext(c), uuidParam(c));
    return c.body(null, 204);
  });

export const summaryRoutes = privateRouter().get('/summary', async (c) => {
  const { month } = parseQuery(c, summaryQuerySchema);
  return c.json(await c.var.services.summary.getMonthSummary(c.var.auth.workspaceId, month));
});

export const budgetsRoutes = privateRouter()
  .get('/', async (c) => {
    const { month } = parseQuery(c, budgetQuerySchema);
    return c.json(await c.var.services.budgets.list(c.var.auth.workspaceId, month));
  })
  // Creates or changes the limit for (month, category, currency).
  .put('/', async (c) => {
    const body = await parseBody(c, budgetUpsertSchema);
    return c.json(await c.var.services.budgets.upsert(c.var.auth.workspaceId, body));
  })
  .post('/copy', async (c) => {
    const body = await parseBody(c, budgetCopySchema);
    return c.json(await c.var.services.budgets.copy(c.var.auth.workspaceId, body), 201);
  })
  .delete('/:id', async (c) => {
    await c.var.services.budgets.remove(c.var.auth.workspaceId, uuidParam(c));
    return c.body(null, 204);
  });
