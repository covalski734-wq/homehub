import {
  amountChangeSchema,
  dashboardLayoutSchema,
  deductionCreateSchema,
  deductionUpdateSchema,
  incomeCreateSchema,
  incomeUpdateSchema,
  monthPlanUpdateSchema,
  monthSchema,
  plannerSettingsUpdateSchema,
  purchaseCompleteSchema,
  purchaseCreateSchema,
  purchaseQuerySchema,
  purchaseUpdateSchema,
  recurringCreateSchema,
  recurringUpdateSchema,
  recurringPaymentSchema,
  incomeReceiptSchema,
  itemSharesSchema,
  skipMonthSchema,
  stopFromMonthSchema,
  versionOnlySchema,
} from '@homehub/shared';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app-env';
import { requireCsrf } from '../auth/csrf.middleware';
import { requireSession } from '../auth/session.middleware';
import { requireArea } from '../lib/scope.middleware';
import { parseBody, parseQuery, parseWith, uuidParam } from '../lib/validation';
import type { ItemKind } from './items.repository';

const monthQuery = z.object({ month: monthSchema });
const trendQuery = z.object({
  to: monthSchema,
  months: z.coerce.number<string>().int().min(1).max(24).default(12),
});

/** Month the client is looking at; responses describe the edited row as seen in that month. */
const viewMonth = (c: Context<AppEnv>) => parseQuery(c, monthQuery).month;
const ws = (c: Context<AppEnv>) => c.var.auth.workspaceId;
// Totals are shown in the display currency of the member who asks.
const planner = (c: Context<AppEnv>) => c.var.services.planner.forViewer(c.var.auth.userId);

/** Income sources and regular expenses expose the same amount/skip/stop operations. */
function itemRoutes(kind: ItemKind) {
  return new Hono<AppEnv>()
    .put('/:id/amount', async (c) =>
      c.json(
        await planner(c).setAmount(
          kind,
          ws(c),
          uuidParam(c),
          await parseBody(c, amountChangeSchema),
        ),
      ),
    )
    .put('/:id/skip', async (c) => {
      const body = await parseBody(c, skipMonthSchema);
      return c.json(
        await planner(c).setSkipped(kind, ws(c), uuidParam(c), body.month, body.skipped),
      );
    })
    .post('/:id/stop', async (c) => {
      const body = await parseBody(c, stopFromMonthSchema);
      return c.json(await planner(c).stopFrom(kind, ws(c), uuidParam(c), body.month));
    });
}

export const plannerRoutes = new Hono<AppEnv>()
  .use('*', requireSession, requireCsrf, requireArea('planner'))

  .get('/settings', async (c) => c.json(await planner(c).settings(ws(c))))
  .patch('/settings', async (c) =>
    c.json(await planner(c).updateSettings(ws(c), await parseBody(c, plannerSettingsUpdateSchema))),
  )
  .get('/layout', async (c) => c.json(await planner(c).layout(c.var.auth.userId)))
  .put('/layout', async (c) =>
    c.json(
      await planner(c).saveLayout(c.var.auth.userId, await parseBody(c, dashboardLayoutSchema)),
    ),
  )

  .get('/months/:month', async (c) => {
    const month = parseWith(monthSchema, c.req.param('month'));
    return c.json(await planner(c).monthBudget(ws(c), month));
  })
  .put('/months/:month/savings-rate', async (c) => {
    const month = parseWith(monthSchema, c.req.param('month'));
    const body = await parseBody(c, monthPlanUpdateSchema);
    return c.json(await planner(c).setSavingsRate(ws(c), month, body.savingsRate));
  })
  .get('/trend', async (c) => {
    const query = parseQuery(c, trendQuery);
    return c.json(await planner(c).trend(ws(c), query.to, query.months));
  })

  .get('/incomes', async (c) => c.json(await planner(c).incomes(ws(c), viewMonth(c))))
  .post('/incomes', async (c) =>
    c.json(
      await planner(c).createIncome(ws(c), await parseBody(c, incomeCreateSchema), viewMonth(c)),
      201,
    ),
  )
  .patch('/incomes/:id', async (c) =>
    c.json(
      await planner(c).updateIncome(
        ws(c),
        uuidParam(c),
        await parseBody(c, incomeUpdateSchema),
        viewMonth(c),
      ),
    ),
  )
  .post('/incomes/:id/deductions', async (c) =>
    c.json(
      await planner(c).createDeduction(
        ws(c),
        uuidParam(c),
        await parseBody(c, deductionCreateSchema),
        viewMonth(c),
      ),
      201,
    ),
  )
  .route('/incomes', itemRoutes('income'))
  .put('/shares/:id', async (c) => {
    await planner(c).setShares(ws(c), uuidParam(c), (await parseBody(c, itemSharesSchema)).shares);
    return c.json(await planner(c).monthBudget(ws(c), viewMonth(c)));
  })
  .put('/incomes/:id/receipt', async (c) =>
    c.json(
      await planner(c).receiveIncome(
        ws(c),
        c.var.auth.userId,
        uuidParam(c),
        await parseBody(c, incomeReceiptSchema),
      ),
    ),
  )
  .delete('/incomes/:id/receipt', async (c) =>
    c.json(await planner(c).unreceiveIncome(ws(c), uuidParam(c), viewMonth(c))),
  )
  .patch('/deductions/:id', async (c) =>
    c.json(
      await planner(c).updateDeduction(
        ws(c),
        uuidParam(c),
        await parseBody(c, deductionUpdateSchema),
        viewMonth(c),
      ),
    ),
  )
  .delete('/deductions/:id', async (c) =>
    c.json(await planner(c).deleteDeduction(ws(c), uuidParam(c), viewMonth(c))),
  )

  .get('/loans', async (c) => c.json(await planner(c).loans(ws(c), viewMonth(c))))
  .get('/recurring', async (c) => c.json(await planner(c).recurring(ws(c), viewMonth(c))))
  .post('/recurring', async (c) =>
    c.json(
      await planner(c).createRecurring(
        ws(c),
        await parseBody(c, recurringCreateSchema),
        viewMonth(c),
      ),
      201,
    ),
  )
  .patch('/recurring/:id', async (c) =>
    c.json(
      await planner(c).updateRecurring(
        ws(c),
        uuidParam(c),
        await parseBody(c, recurringUpdateSchema),
        viewMonth(c),
      ),
    ),
  )
  .route('/recurring', itemRoutes('recurring'))
  .put('/recurring/:id/payment', async (c) => {
    const body = await parseBody(c, recurringPaymentSchema);
    return c.json(
      await planner(c).setPaid(
        ws(c),
        uuidParam(c),
        body.month,
        body.paid,
        body.actual,
        c.var.auth.userId,
      ),
    );
  })

  .get('/purchases', async (c) =>
    c.json(await planner(c).purchases(ws(c), parseQuery(c, purchaseQuerySchema))),
  )
  .post('/purchases', async (c) =>
    c.json(
      await planner(c).createPurchase(
        ws(c),
        c.var.auth.userId,
        await parseBody(c, purchaseCreateSchema),
      ),
      201,
    ),
  )
  .patch('/purchases/:id', async (c) =>
    c.json(
      await planner(c).updatePurchase(
        ws(c),
        c.var.auth.userId,
        uuidParam(c),
        await parseBody(c, purchaseUpdateSchema),
      ),
    ),
  )
  .post('/purchases/:id/purchase', async (c) =>
    c.json(
      await planner(c).completePurchase(
        ws(c),
        c.var.auth.userId,
        uuidParam(c),
        await parseBody(c, purchaseCompleteSchema),
      ),
    ),
  )
  .post('/purchases/:id/:action{unpurchase|cancel|restore}', async (c) => {
    const { version } = await parseBody(c, versionOnlySchema);
    const action = c.req.param('action') as 'unpurchase' | 'cancel' | 'restore';
    return c.json(
      await planner(c).setPurchaseStatus(ws(c), c.var.auth.userId, uuidParam(c), version, action),
    );
  })
  .delete('/purchases/:id', async (c) => {
    await planner(c).deletePurchase(ws(c), uuidParam(c));
    return c.body(null, 204);
  })
  .get('/purchases/:id/history', async (c) =>
    c.json(await planner(c).purchaseHistory(ws(c), uuidParam(c))),
  )

  .get('/rates', async (c) => c.json(await planner(c).ratesStatus()))
  .post('/rates/refresh', async (c) => c.json(await planner(c).refreshRates()));
