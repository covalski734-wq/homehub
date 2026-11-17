import {
  assetSearchSchema,
  autoAmountSchema,
  autoRuleCreateSchema,
  autoRuleUpdateSchema,
  currentMonth,
  fundOverrideSchema,
  fundRuleSchema,
  monthSchema,
  movementCreateSchema,
  movementMoveSchema,
  movementReturnedSchema,
  movementUpdateSchema,
  positionCreateSchema,
  positionUpdateSchema,
  potCreateSchema,
  potUpdateSchema,
  subaccountCreateSchema,
  subaccountUpdateSchema,
} from '@homehub/shared';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { unprocessable } from '../lib/http-error';
import type { AppEnv } from '../app-env';
import { requireCsrf } from '../auth/csrf.middleware';
import { requireSession } from '../auth/session.middleware';
import { requireArea } from '../lib/scope.middleware';
import { serviceContext } from '../lib/http-context';
import { parseBody, parseQuery, uuidParam } from '../lib/validation';

const monthQuery = z.object({ month: monthSchema.default(() => currentMonth()) });
const month = (c: Context<AppEnv>) => parseQuery(c, monthQuery).month;

/**
 * Every change answers with the overview of the month the page shows (values in the display
 * currency of the member who asks). The overview is read after the change, never written by it.
 */
async function changed(
  c: Context<AppEnv>,
  change: () => Promise<unknown>,
  status: 200 | 201 = 200,
) {
  const shown = month(c);
  await change();
  const { savings } = c.var.services;
  return c.json(await savings.queries.overview(serviceContext(c), shown), status);
}

/**
 * Funds (money pots: parts, deposits, withdrawals, returns through the planner, automatic
 * operations) and portfolios of coins and tokens valued at the daily CoinGecko price.
 */
export const savingsRoutes = new Hono<AppEnv>()
  .use('*', requireSession, requireCsrf, requireArea('savings'))
  .get('/', async (c) =>
    c.json(await c.var.services.savings.queries.overview(serviceContext(c), month(c))),
  )
  .get('/wealth', async (c) =>
    c.json(await c.var.services.savings.queries.wealth(serviceContext(c), month(c))),
  )
  .get('/pots/:id/movements', async (c) =>
    c.json(await c.var.services.savings.queries.history(serviceContext(c), uuidParam(c))),
  )
  .get('/pots/:id/part-history', async (c) =>
    c.json(await c.var.services.savings.funds.partHistory(serviceContext(c), uuidParam(c))),
  )
  .post('/auto/:id/confirm', async (c) =>
    changed(c, async () =>
      c.var.services.savings.auto.confirm(serviceContext(c), uuidParam(c), month(c)),
    ),
  )
  .post('/subaccounts/:id/confirm-plan', async (c) =>
    changed(c, async () => {
      const ctx = serviceContext(c);
      const overview = await c.var.services.savings.queries.overview(ctx, month(c));
      const id = uuidParam(c);
      for (const pot of overview.pots) {
        const part = pot.subaccounts.find((s) => s.id === id && !s.archived);
        if (part) return c.var.services.savings.movements.confirmPlan(ctx, pot.id, part, month(c));
      }
      throw unprocessable('SAVINGS_PART_NOT_FOUND_OR_ARCHIVED');
    }),
  )
  .get('/assets', async (c) =>
    c.json(await c.var.services.savings.portfolio.search(parseQuery(c, assetSearchSchema).q)),
  )
  .post('/prices/refresh', async (c) =>
    changed(c, async () => c.var.services.savings.portfolio.refreshPrices(serviceContext(c))),
  )
  // ---- funds and portfolios
  .post('/pots', async (c) =>
    changed(
      c,
      async () =>
        c.var.services.savings.funds.createPot(
          serviceContext(c),
          await parseBody(c, potCreateSchema),
        ),
      201,
    ),
  )
  .patch('/pots/:id', async (c) =>
    changed(c, async () =>
      c.var.services.savings.funds.updatePot(
        serviceContext(c),
        uuidParam(c),
        await parseBody(c, potUpdateSchema),
      ),
    ),
  )
  .delete('/pots/:id', async (c) =>
    changed(c, async () => c.var.services.savings.funds.deletePot(serviceContext(c), uuidParam(c))),
  )
  // ---- parts
  .post('/pots/:id/subaccounts', async (c) =>
    changed(
      c,
      async () =>
        c.var.services.savings.funds.createPart(
          serviceContext(c),
          uuidParam(c),
          await parseBody(c, subaccountCreateSchema),
        ),
      201,
    ),
  )
  .patch('/subaccounts/:id', async (c) =>
    changed(c, async () =>
      c.var.services.savings.funds.updatePart(
        serviceContext(c),
        uuidParam(c),
        await parseBody(c, subaccountUpdateSchema),
      ),
    ),
  )
  .delete('/subaccounts/:id', async (c) =>
    changed(c, async () =>
      c.var.services.savings.funds.deletePart(serviceContext(c), uuidParam(c)),
    ),
  )
  .put('/subaccounts/:id/rule', async (c) =>
    changed(c, async () =>
      c.var.services.savings.funds.setRule(
        serviceContext(c),
        uuidParam(c),
        await parseBody(c, fundRuleSchema),
      ),
    ),
  )
  .delete('/subaccounts/:id/rule', async (c) =>
    changed(c, async () =>
      c.var.services.savings.funds.deleteRule(serviceContext(c), uuidParam(c)),
    ),
  )
  .put('/subaccounts/:id/plan', async (c) =>
    changed(c, async () =>
      c.var.services.savings.funds.setOverride(
        serviceContext(c),
        uuidParam(c),
        await parseBody(c, fundOverrideSchema),
      ),
    ),
  )
  // ---- money
  .post('/pots/:id/movements', async (c) =>
    changed(
      c,
      async () =>
        c.var.services.savings.movements.add(
          serviceContext(c),
          uuidParam(c),
          await parseBody(c, movementCreateSchema),
        ),
      201,
    ),
  )
  .patch('/movements/:id', async (c) =>
    changed(c, async () =>
      c.var.services.savings.movements.update(
        serviceContext(c),
        uuidParam(c),
        await parseBody(c, movementUpdateSchema),
      ),
    ),
  )
  .delete('/movements/:id', async (c) =>
    changed(c, async () =>
      c.var.services.savings.movements.remove(serviceContext(c), uuidParam(c)),
    ),
  )
  .put('/movements/:id/returned', async (c) =>
    changed(c, async () =>
      c.var.services.savings.movements.setReturned(
        serviceContext(c),
        uuidParam(c),
        (await parseBody(c, movementReturnedSchema)).returned,
      ),
    ),
  )
  .put('/movements/:id/repay-month', async (c) =>
    changed(c, async () =>
      c.var.services.savings.movements.moveReturn(
        serviceContext(c),
        uuidParam(c),
        (await parseBody(c, movementMoveSchema)).repayMonth,
      ),
    ),
  )
  // ---- automatic operations
  .post('/subaccounts/:id/auto', async (c) =>
    changed(
      c,
      async () =>
        c.var.services.savings.auto.create(
          serviceContext(c),
          uuidParam(c),
          await parseBody(c, autoRuleCreateSchema),
        ),
      201,
    ),
  )
  .patch('/auto/:id', async (c) =>
    changed(c, async () =>
      c.var.services.savings.auto.update(
        serviceContext(c),
        uuidParam(c),
        await parseBody(c, autoRuleUpdateSchema),
      ),
    ),
  )
  .put('/auto/:id/amount', async (c) =>
    changed(c, async () =>
      c.var.services.savings.auto.setAmount(
        serviceContext(c),
        uuidParam(c),
        await parseBody(c, autoAmountSchema),
      ),
    ),
  )
  .delete('/auto/:id', async (c) =>
    changed(c, async () => c.var.services.savings.auto.remove(serviceContext(c), uuidParam(c))),
  )
  // ---- portfolio positions
  .post('/pots/:id/positions', async (c) =>
    changed(
      c,
      async () =>
        c.var.services.savings.portfolio.add(
          serviceContext(c),
          uuidParam(c),
          await parseBody(c, positionCreateSchema),
        ),
      201,
    ),
  )
  .patch('/positions/:id', async (c) =>
    changed(c, async () =>
      c.var.services.savings.portfolio.update(
        serviceContext(c),
        uuidParam(c),
        await parseBody(c, positionUpdateSchema),
      ),
    ),
  )
  .delete('/positions/:id', async (c) =>
    changed(c, async () =>
      c.var.services.savings.portfolio.remove(serviceContext(c), uuidParam(c)),
    ),
  );
