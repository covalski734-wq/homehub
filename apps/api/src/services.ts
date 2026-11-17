import { AccessService } from './access/access.service';
import { AuthRepository } from './auth/auth.repository';
import { AuthService } from './auth/auth.service';
import type { AppConfig } from './config';
import type { Bindings } from './config';
import { ChoresService } from './chores/chores.service';
import { ShoppingService } from './shopping/shopping.service';
import { createDb } from './db/client';
import { Ledger } from './finance/ledger';
import { AccountsRepository } from './finance/repositories/accounts.repository';
import { BudgetsRepository } from './finance/repositories/budgets.repository';
import { CategoriesRepository } from './finance/repositories/categories.repository';
import { SummaryRepository } from './finance/repositories/summary.repository';
import { TransactionsRepository } from './finance/repositories/transactions.repository';
import { AccountsService } from './finance/services/accounts.service';
import { BudgetsService } from './finance/services/budgets.service';
import { SummaryService } from './finance/services/summary.service';
import { TransactionsService } from './finance/services/transactions.service';
import { MembersService } from './members/members.service';
import { FundReturnLines } from './planner/fund-returns';
import { ItemsRepository } from './planner/items.repository';
import type { Fetcher } from './planner/nbp';
import { PlannerRepository } from './planner/planner.repository';
import { PlannerService } from './planner/planner.service';
import { PreferencesService } from './preferences/preferences.service';
import { ExtrasRepository } from './planner/extras.repository';
import { PurchasesRepository } from './planner/purchases.repository';
import { RatesService } from './planner/rates.service';
import { AssetPricesService } from './savings/asset-prices';
import { AutoMovementsService } from './savings/auto.service';
import { FundsService } from './savings/funds.service';
import { MovementsService } from './savings/movements.service';
import { PortfolioService } from './savings/portfolio.service';
import { reservedByAccount } from './savings/reserved';
import { SavingsQueries } from './savings/savings.queries';
import { SavingsRepository } from './savings/savings.repository';
import { ScenariosService } from './savings/scenarios.service';

/**
 * Plain constructor wiring instead of a DI container: objects are cheap and created per
 * request, which keeps cold starts within the Workers Free CPU budget. Each service exists once;
 * services take the caller (ServiceContext) as an argument, so HTTP, cron and a future MCP server
 * use the same instances' logic without sharing request state.
 *
 * Module dependencies point one way: savings → planner → finance → members. The planner learns
 * about fund returns through the ReturnMoney interface (implemented by savings), and accounts get
 * the fund reservations as a function, so finance never imports savings.
 */
export function createServices(
  d1: D1Database,
  config: AppConfig,
  fetcher?: Fetcher,
  env?: Bindings,
) {
  const db = createDb(d1);
  const ledger = new Ledger(d1);
  const members = new MembersService(d1);

  const accountsRepository = new AccountsRepository(db);
  const categories = new CategoriesRepository(db);
  const summary = new SummaryRepository(db, accountsRepository);
  const accounts = new AccountsService(accountsRepository, d1, ledger, members, (workspaceId) =>
    reservedByAccount(d1, workspaceId),
  );

  const savingsRepository = new SavingsRepository(d1);
  const fundReturns = new FundReturnLines(d1);
  const movements = new MovementsService(d1, savingsRepository, ledger, fundReturns);
  const rates = new RatesService(db, fetcher);
  const prices = new AssetPricesService(d1, fetcher, env?.COINGECKO_API_KEY);
  const planner = new PlannerService(
    new PlannerRepository(db),
    new ItemsRepository(db, d1),
    new PurchasesRepository(db, d1),
    rates,
    new ExtrasRepository(d1),
    ledger,
    fundReturns,
    movements,
    members,
    d1,
  );
  const savingsQueries = new SavingsQueries(
    savingsRepository,
    planner,
    rates,
    prices,
    accounts,
    members,
  );

  const access = new AccessService(d1, config);
  return {
    db,
    access,
    auth: new AuthService(new AuthRepository(db, d1), config),
    accounts,
    categories,
    transactions: new TransactionsService(
      new TransactionsRepository(db),
      accountsRepository,
      categories,
      d1,
      members,
    ),
    summary: new SummaryService(summary),
    budgets: new BudgetsService(new BudgetsRepository(db, summary), categories),
    planner,
    savings: {
      queries: savingsQueries,
      funds: new FundsService(d1, savingsRepository, ledger, members),
      movements,
      auto: new AutoMovementsService(d1, savingsRepository, ledger),
      portfolio: new PortfolioService(d1, savingsRepository, prices, rates),
      prices,
    },
    members,
    preferences: new PreferencesService(d1),
    scenarios: new ScenariosService(d1, planner, savingsQueries),
    chores: new ChoresService(d1),
    shopping: new ShoppingService(d1),
  };
}

export type Services = ReturnType<typeof createServices>;
