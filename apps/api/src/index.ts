import { wellKnown } from './access/well-known';
import { createApp } from './app';
import { AuthRepository } from './auth/auth.repository';
import { getConfig, type Bindings } from './config';
import { createDb } from './db/client';
import type { Fetcher } from './planner/nbp';
import { PlannerRepository } from './planner/planner.repository';
import { RatesService } from './planner/rates.service';
import { AssetPricesService } from './savings/asset-prices';
import { AutoMovementsService } from './savings/auto.service';
import { SavingsRepository } from './savings/savings.repository';
import { Ledger } from './finance/ledger';
import { deleteExpiredKeys } from './lib/idempotency';
import { AccessService } from './access/access.service';

const app = createApp();

/** Cron expressions from wrangler.jsonc → what they do. */
export const CRON = {
  /** Every 5 minutes: reminders, then ad platform statistics. */
  /** Daily: expired sessions and login attempts, then coin prices. */
  cleanup: '17 3 * * *',
  /** NBP publishes table A around 12:15 Warsaw time on business days. */
  rates: '20 11,15 * * 1-5',
} as const;

export async function runScheduled(cron: string, env: Bindings, fetcher?: Fetcher): Promise<void> {
  // The steps of a cron are independent: a failure in one (or in one workspace) never skips the
  // rest. Failures are logged where they happen and re-thrown together, so the run still reports them.
  const failures: unknown[] = [];
  const isolated = async (label: string, step: () => Promise<void>) => {
    try {
      await step();
    } catch (error) {
      console.error(`${label} failed`, error);
      failures.push(error);
    }
  };
  const report = () => {
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, `Cron ${cron}: several steps failed`);
  };

  const db = createDb(env.DB);
  if (cron === CRON.rates) {
    const earliest = await new PlannerRepository(db).earliestMonthOverall();
    const { stored, error } = await new RatesService(db, fetcher).refresh(
      earliest ? `${earliest}-01` : undefined,
    );
    if (error) console.warn(`NBP rates refresh failed, stored rates stay in use: ${error}`);
    else console.log(`NBP rates refresh: ${stored} rates stored`);
    return;
  }
  await isolated('Cleanup', async () => {
    const { sessions, flows } = await new AuthRepository(db, env.DB).deleteExpired(new Date());
    const keys = await deleteExpiredKeys(env.DB);
    await new AccessService(env.DB, getConfig(env)).deleteExpired();
    console.log(
      `Cleanup: ${sessions} expired sessions, ${flows} expired login attempts, ${keys} idempotency keys`,
    );
  });
  // Automatic fund deposits and withdrawals due today (a changed rule catches up right away).
  const autoMovements = new AutoMovementsService(
    env.DB,
    new SavingsRepository(env.DB),
    new Ledger(env.DB),
  );
  await isolated('Automatic fund operations', async () => {
    const autos = await env.DB.prepare('SELECT DISTINCT workspace_id FROM fund_auto_rules').all<{
      workspace_id: string;
    }>();
    let made = 0;
    for (const row of autos.results)
      await isolated(`Automatic fund operations of workspace ${row.workspace_id}`, async () => {
        made += await autoMovements.run(row.workspace_id);
      });
    if (made) console.log(`Automatic fund operations: ${made} made`);
  });
  await isolated('Asset prices refresh', async () => {
    const prices = await new AssetPricesService(env.DB, fetcher, env.COINGECKO_API_KEY).refresh();
    if (prices.error)
      console.warn(`Asset prices refresh failed, stored prices stay in use: ${prices.error}`);
    else console.log(`Asset prices refresh: ${prices.stored} prices stored`);
  });

  report();
}

export default {
  // OAuth discovery lives at the origin's root, outside /api.
  fetch: (request, env, ctx) =>
    wellKnown(request, getConfig(env).webOrigin) ?? app.fetch(request, env, ctx),

  /** Cron Triggers: daily cleanup and coin prices; exchange rates on business days. */
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(controller.cron, env));
  },
} satisfies ExportedHandler<Bindings>;
