import {
  currentMonth,
  DEFAULT_DASHBOARD_LAYOUT,
  dashboardLayoutSchema,
  PLANNER_CURRENCIES,
  shiftMonth,
  type DashboardLayout,
  type IncomeLineDto,
  type MonthBudgetDto,
  type PlannerSettingsDto,
  type PlannerTrendDto,
  type PurchaseDto,
  type PurchaseEventDto,
  type PurchaseStatus,
  type RatesStatusDto,
  type RecurringLineDto,
  type SavingsPlanDto,
} from '@homehub/shared';
import type { z } from 'zod';
import type {
  LoansDto,
  amountChangeSchema,
  deductionCreateSchema,
  deductionUpdateSchema,
  incomeCreateSchema,
  incomeUpdateSchema,
  plannerSettingsUpdateSchema,
  purchaseCompleteSchema,
  purchaseCreateSchema,
  purchaseUpdateSchema,
  recurringCreateSchema,
  recurringUpdateSchema,
  actualPaymentSchema,
  incomeReceiptSchema,
} from '@homehub/shared';
import { conflict, notFound, unprocessable } from '../lib/http-error';
import { formatMinor, toMinorNumber } from '../lib/money';
import {
  buildIncomeLines,
  buildLoans,
  buildMonthBudget,
  buildMonthFact,
  buildRecurringLines,
  toPurchaseDto,
} from './budget';
import { bpToPercent, percentToBp } from './calculations';
import { type ItemsRepository, type ItemKind } from './items.repository';
import { type PlannerRepository } from './planner.repository';
import { type PurchasesRepository } from './purchases.repository';
import { monthCutoff, rateTableAt, type RatesService } from './rates.service';
import { addDays, lastDayOfMonth, today } from '../lib/dates';
import type { ExtrasRepository } from './extras.repository';
import type { Ledger } from '../finance/ledger';
import {
  financeKeyForExpense,
  financeKeyForIncome,
  financeKeyForPurchase,
} from '../finance/plan-categories';
import type { MembersService } from '../members/members.service';
import type { FundReturnLines, ReturnMoney } from './fund-returns';
import { toMinor } from '../lib/money';

type Out<T extends z.ZodType> = z.output<T>;

const TREND_MAX_MONTHS = 24;

function months(from: string, to: string): string[] {
  const list: string[] = [];
  for (let m = from; m <= to; m = shiftMonth(m, 1)) list.push(m);
  return list;
}

const optionalMinor = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : toMinorNumber(value);

export class PlannerService {
  constructor(
    private readonly repo: PlannerRepository,
    private readonly items: ItemsRepository,
    private readonly purchasesRepo: PurchasesRepository,
    private readonly rates: RatesService,
    private readonly extras: ExtrasRepository,
    private readonly ledger: Ledger,
    private readonly fundReturns: FundReturnLines,
    private readonly returnMoney: ReturnMoney,
    private readonly members: MembersService,
    private readonly d1: D1Database,
    /** Member whose display currency applies to totals (each member chooses their own). */
    private readonly viewerId: string | null = null,
  ) {}

  /**
   * The same planner seen by one member (totals in their display currency). A new instance: a
   * shared one never carries one member's view into another's request.
   */
  forViewer(userId: string | null): PlannerService {
    if (userId === this.viewerId) return this;
    return new PlannerService(
      this.repo,
      this.items,
      this.purchasesRepo,
      this.rates,
      this.extras,
      this.ledger,
      this.fundReturns,
      this.returnMoney,
      this.members,
      this.d1,
      userId,
    );
  }

  /**
   * Own shares of a joint income, expense or purchase between members (an empty list returns it
   * to the household default). The line must be this household's; shares add up to 100 %.
   */
  async setShares(
    workspaceId: string,
    itemId: string,
    shares: { memberId: string; share: string }[],
  ): Promise<void> {
    const item = await this.d1
      .prepare(
        `SELECT 1 FROM income_sources WHERE id = ?1 AND workspace_id = ?2
         UNION SELECT 1 FROM recurring_expenses WHERE id = ?1 AND workspace_id = ?2
         UNION SELECT 1 FROM purchases WHERE id = ?1 AND workspace_id = ?2`,
      )
      .bind(itemId, workspaceId)
      .first();
    if (!item) throw notFound('PLANNER_LINE_NOT_FOUND');
    for (const s of shares) await this.assertOwner(workspaceId, s.memberId);
    await this.d1.batch([
      this.d1
        .prepare('DELETE FROM item_shares WHERE item_id = ? AND workspace_id = ?')
        .bind(itemId, workspaceId),
      ...shares.map((s) =>
        this.d1
          .prepare(
            'INSERT INTO item_shares (workspace_id, item_id, member_id, share_bp) VALUES (?1, ?2, ?3, ?4)',
          )
          .bind(workspaceId, itemId, s.memberId, percentToBp(s.share)),
      ),
    ]);
  }

  /** An owner must be a member of this household (null — совместный). */
  assertOwner(workspaceId: string, ownerId: string | null | undefined): Promise<void> {
    return this.members.assertMember(workspaceId, ownerId);
  }

  /** Read once per instance (an instance belongs to one viewer). */
  private viewerCurrency: Promise<'PLN' | 'EUR' | null> | null = null;

  private currencyOfViewer(): Promise<'PLN' | 'EUR' | null> {
    if (!this.viewerId) return Promise.resolve(null);
    this.viewerCurrency ??= this.repo.userCurrency(this.viewerId);
    return this.viewerCurrency;
  }

  /** A budget snapshot in the viewer's display currency. */
  private async snapshot(workspaceId: string, from: string, to: string) {
    const [snapshot, currency] = await Promise.all([
      this.repo.snapshot(workspaceId, from, to),
      this.currencyOfViewer(),
    ]);
    if (currency) snapshot.settings = { ...snapshot.settings, baseCurrency: currency };
    snapshot.extras = await this.extras.load(workspaceId, from, to);
    return snapshot;
  }

  // ---- settings & preferences -------------------------------------------------------------

  async settings(workspaceId: string): Promise<PlannerSettingsDto> {
    const [settings, currency] = await Promise.all([
      this.repo.settings(workspaceId),
      this.currencyOfViewer(),
    ]);
    const minFree = await this.d1
      .prepare(
        'SELECT min_free_minor, joint_split, savings_mode FROM planner_settings WHERE workspace_id = ?',
      )
      .bind(workspaceId)
      .first<{
        min_free_minor: number;
        joint_split: 'EQUAL' | 'INCOME';
        savings_mode: 'RATE' | 'REMAINDER';
      }>();
    return {
      baseCurrency: currency ?? settings.baseCurrency,
      defaultSavingsRate: bpToPercent(settings.defaultSavingsRateBp),
      minFree: formatMinor(minFree?.min_free_minor ?? 0),
      jointSplit: minFree?.joint_split ?? 'EQUAL',
      savingsMode: minFree?.savings_mode ?? 'RATE',
      currencies: PLANNER_CURRENCIES,
    };
  }

  async updateSettings(
    workspaceId: string,
    payload: Out<typeof plannerSettingsUpdateSchema>,
  ): Promise<PlannerSettingsDto> {
    const current = await this.repo.settings(workspaceId);
    const newRate =
      payload.defaultSavingsRate === undefined
        ? undefined
        : percentToBp(payload.defaultSavingsRate);
    // Past months that used the old default keep it.
    const earliest =
      newRate !== undefined && newRate !== current.defaultSavingsRateBp
        ? await this.repo.earliestMonth(workspaceId)
        : null;
    const lastPast = shiftMonth(currentMonth(), -1);
    const freeze = earliest && earliest <= lastPast ? months(earliest, lastPast) : [];
    // The display currency is personal: it changes only for the member who picked it.
    if (payload.baseCurrency && this.viewerId) {
      await this.repo.setUserCurrency(this.viewerId, payload.baseCurrency);
      this.viewerCurrency = Promise.resolve(payload.baseCurrency);
    }
    if (payload.minFree !== undefined)
      await this.d1
        .prepare(
          `INSERT INTO planner_settings (workspace_id, min_free_minor, updated_at) VALUES (?1, ?2, ?3)
           ON CONFLICT (workspace_id) DO UPDATE SET min_free_minor = ?2, updated_at = ?3`,
        )
        .bind(workspaceId, toMinorNumber(payload.minFree), Date.now())
        .run();
    if (payload.savingsMode !== undefined)
      await this.d1
        .prepare(
          `INSERT INTO planner_settings (workspace_id, savings_mode, updated_at) VALUES (?1, ?2, ?3)
           ON CONFLICT (workspace_id) DO UPDATE SET savings_mode = ?2, updated_at = ?3`,
        )
        .bind(workspaceId, payload.savingsMode, Date.now())
        .run();
    if (payload.jointSplit !== undefined)
      await this.d1
        .prepare(
          `INSERT INTO planner_settings (workspace_id, joint_split, updated_at) VALUES (?1, ?2, ?3)
           ON CONFLICT (workspace_id) DO UPDATE SET joint_split = ?2, updated_at = ?3`,
        )
        .bind(workspaceId, payload.jointSplit, Date.now())
        .run();
    if (newRate !== undefined || (!this.viewerId && payload.baseCurrency))
      await this.repo.updateSettings(
        workspaceId,
        {
          baseCurrency: this.viewerId ? undefined : payload.baseCurrency,
          defaultSavingsRateBp: newRate,
        },
        freeze,
        current.defaultSavingsRateBp,
      );
    return this.settings(workspaceId);
  }

  async layout(userId: string): Promise<DashboardLayout> {
    const stored = await this.repo.layout(userId);
    if (!stored) return DEFAULT_DASHBOARD_LAYOUT;
    const parsed = dashboardLayoutSchema.safeParse(JSON.parse(stored));
    if (!parsed.success) return DEFAULT_DASHBOARD_LAYOUT;
    // Charts added in later versions appear at the end of an older saved layout, as by default.
    const known = new Set(parsed.data.charts.map((c) => c.id));
    const added = DEFAULT_DASHBOARD_LAYOUT.charts.filter((c) => !known.has(c.id));
    return { ...parsed.data, charts: [...parsed.data.charts, ...added] };
  }

  async saveLayout(userId: string, layout: DashboardLayout): Promise<DashboardLayout> {
    await this.repo.saveLayout(userId, JSON.stringify(layout));
    return this.layout(userId);
  }

  // ---- budgets ------------------------------------------------------------------------------

  private async ratesFor(fromMonth: string, toMonth: string, extraDates: string[] = []) {
    const dates = [...extraDates, monthCutoff(toMonth)].sort();
    const rows = await this.rates.loadRange(
      addDays(`${fromMonth}-01`, -10),
      dates.at(-1) ?? lastDayOfMonth(toMonth),
    );
    return {
      forMonth: (month: string) => rateTableAt(rows, monthCutoff(month)),
      atDate: (date: string) => rateTableAt(rows, date).table,
    };
  }

  async monthBudget(workspaceId: string, month: string): Promise<MonthBudgetDto> {
    const snapshot = await this.snapshot(workspaceId, month, month);
    const purchaseDates = snapshot.purchases.flatMap((p) => (p.purchasedOn ? [p.purchasedOn] : []));
    const rates = await this.ratesFor(month, month, purchaseDates);
    const budget = buildMonthBudget(snapshot, month, rates.forMonth(month), rates.atDate);
    return { ...budget, fact: buildMonthFact(budget, snapshot, rates.forMonth(month).table) };
  }

  /** The savings plans of consecutive months (one snapshot): forecasts of funds use them. */
  async savingsPlans(
    workspaceId: string,
    from: string,
    count: number,
  ): Promise<{ month: string; plan: SavingsPlanDto }[]> {
    const to = shiftMonth(from, count - 1);
    const snapshot = await this.snapshot(workspaceId, from, to);
    const purchaseDates = snapshot.purchases.flatMap((p) => (p.purchasedOn ? [p.purchasedOn] : []));
    const rates = await this.ratesFor(from, to, purchaseDates);
    return months(from, to).map((month) => ({
      month,
      plan: buildMonthBudget(snapshot, month, rates.forMonth(month), rates.atDate).savingsPlan,
    }));
  }

  /** Budgets of a period from one snapshot, after `adjust` changed it (scenarios). */
  async budgetsFor(
    workspaceId: string,
    from: string,
    count: number,
    adjust: (snapshot: Awaited<ReturnType<PlannerService['snapshot']>>) => void,
  ): Promise<MonthBudgetDto[]> {
    const to = shiftMonth(from, count - 1);
    const snapshot = await this.snapshot(workspaceId, from, to);
    adjust(snapshot);
    const purchaseDates = snapshot.purchases.flatMap((p) => (p.purchasedOn ? [p.purchasedOn] : []));
    const rates = await this.ratesFor(from, to, purchaseDates);
    return months(from, to).map((month) =>
      buildMonthBudget(snapshot, month, rates.forMonth(month), rates.atDate),
    );
  }

  async setSavingsRate(
    workspaceId: string,
    month: string,
    rate: string | null,
  ): Promise<MonthBudgetDto> {
    await this.repo.setMonthRate(workspaceId, month, rate === null ? null : percentToBp(rate));
    return this.monthBudget(workspaceId, month);
  }

  async trend(workspaceId: string, to: string, count: number): Promise<PlannerTrendDto> {
    const from = shiftMonth(to, -(Math.min(Math.max(count, 1), TREND_MAX_MONTHS) - 1));
    const snapshot = await this.snapshot(workspaceId, from, to);
    const purchaseDates = snapshot.purchases.flatMap((p) => (p.purchasedOn ? [p.purchasedOn] : []));
    const rates = await this.ratesFor(from, to, purchaseDates);
    return {
      baseCurrency: snapshot.settings.baseCurrency,
      points: months(from, to).map((month) => {
        const budget = buildMonthBudget(snapshot, month, rates.forMonth(month), rates.atDate);
        const { totals } = budget;
        return {
          month,
          grossIncome: totals.grossIncome,
          netIncome: totals.netIncome,
          deductions: totals.deductions,
          recurring: totals.recurring,
          purchases: totals.purchases,
          savingsTarget: totals.savingsTarget,
          free: totals.free,
          savingsRate: budget.savingsRate,
          breakdown: budget.breakdown,
        };
      }),
    };
  }

  // ---- incomes ------------------------------------------------------------------------------

  async incomes(workspaceId: string, month: string): Promise<IncomeLineDto[]> {
    const snapshot = await this.snapshot(workspaceId, month, month);
    const rates = await this.ratesFor(month, month);
    return buildIncomeLines(
      snapshot,
      month,
      snapshot.settings.baseCurrency,
      rates.forMonth(month).table,
    );
  }

  private async incomeLine(workspaceId: string, id: string, month: string): Promise<IncomeLineDto> {
    const line = (await this.incomes(workspaceId, month)).find((l) => l.id === id);
    if (!line) throw notFound('PLANNER_INCOME_NOT_FOUND');
    return line;
  }

  async createIncome(
    workspaceId: string,
    payload: Out<typeof incomeCreateSchema>,
    month: string,
  ): Promise<IncomeLineDto> {
    await this.assertOwner(workspaceId, payload.ownerId);
    const id = await this.items.createIncome({
      workspaceId,
      name: payload.name,
      kind: payload.kind,
      currency: payload.currency,
      startMonth: payload.startMonth,
      endMonth: payload.endMonth,
      amountMinor: toMinorNumber(payload.amount),
      ownerId: payload.ownerId,
    });
    return this.incomeLine(workspaceId, id, month);
  }

  async updateIncome(
    workspaceId: string,
    id: string,
    payload: Out<typeof incomeUpdateSchema>,
    month: string,
  ) {
    await this.assertOwner(workspaceId, payload.ownerId);
    const { version, ...changes } = payload;
    await this.guardCurrencyChange('income', workspaceId, id, changes.currency);
    await this.items.updateIncome(workspaceId, id, version, changes);
    return this.incomeLine(workspaceId, id, month);
  }

  async setAmount(
    kind: ItemKind,
    workspaceId: string,
    id: string,
    payload: Out<typeof amountChangeSchema>,
  ) {
    const head = await this.items.head(kind, workspaceId, id);
    if (
      payload.month < head.startMonth ||
      (head.endMonth !== null && payload.month > head.endMonth)
    ) {
      throw unprocessable('PLANNER_MONTH_OUTSIDE_LINE');
    }
    await this.items.setAmount(
      kind,
      workspaceId,
      id,
      payload.month,
      toMinorNumber(payload.amount),
      payload.scope,
    );
    return kind === 'income'
      ? this.incomeLine(workspaceId, id, payload.month)
      : this.recurringLine(workspaceId, id, payload.month);
  }

  async setSkipped(
    kind: ItemKind,
    workspaceId: string,
    id: string,
    month: string,
    skipped: boolean,
  ) {
    await this.items.head(kind, workspaceId, id);
    await this.items.setSkipped(kind, workspaceId, id, month, skipped);
    return kind === 'income'
      ? this.incomeLine(workspaceId, id, month)
      : this.recurringLine(workspaceId, id, month);
  }

  async stopFrom(kind: ItemKind, workspaceId: string, id: string, month: string) {
    const head = await this.items.head(kind, workspaceId, id);
    return { result: await this.items.stopFrom(kind, workspaceId, head, month) };
  }

  /**
   * Amounts of past months are stored in the item's currency; switching it would silently
   * reinterpret history. An item that started in the past keeps its currency.
   */
  private async guardCurrencyChange(
    kind: ItemKind,
    workspaceId: string,
    id: string,
    currency: string | undefined,
  ) {
    if (!currency) return;
    const head = await this.items.head(kind, workspaceId, id);
    if (head.currency !== currency && head.startMonth < currentMonth()) {
      throw conflict('PLANNER_CURRENCY_USED');
    }
  }

  async createDeduction(
    workspaceId: string,
    incomeId: string,
    payload: Out<typeof deductionCreateSchema>,
    month: string,
  ) {
    await this.items.head('income', workspaceId, incomeId);
    await this.items.createDeduction({
      workspaceId,
      incomeId,
      name: payload.name,
      kind: payload.kind,
      rateBp: payload.kind === 'PERCENT' && payload.rate ? percentToBp(payload.rate) : null,
      base: payload.kind === 'PERCENT' ? payload.base : 'GROSS',
      amountMinor:
        payload.kind === 'FIXED' && payload.amount ? toMinorNumber(payload.amount) : null,
      currency: payload.kind === 'FIXED' ? (payload.currency ?? null) : null,
      startMonth: payload.startMonth,
      endMonth: payload.endMonth,
    });
    return this.incomeLine(workspaceId, incomeId, month);
  }

  async updateDeduction(
    workspaceId: string,
    id: string,
    payload: Out<typeof deductionUpdateSchema>,
    month: string,
  ) {
    const { version, rate, amount, ...rest } = payload;
    const changes = {
      ...rest,
      rateBp: rate === undefined ? undefined : rate === null ? null : percentToBp(rate),
      amountMinor: optionalMinor(amount),
    };
    // Switching kind clears the other kind's fields so the row stays consistent.
    if (changes.kind === 'PERCENT') Object.assign(changes, { amountMinor: null, currency: null });
    if (changes.kind === 'FIXED') Object.assign(changes, { rateBp: null, base: 'GROSS' });
    await this.items.updateDeduction(workspaceId, id, version, changes);
    return this.incomeLine(workspaceId, await this.deductionIncome(workspaceId, id), month);
  }

  async deleteDeduction(workspaceId: string, id: string, month: string) {
    const incomeId = await this.deductionIncome(workspaceId, id);
    await this.items.deleteDeduction(workspaceId, id);
    return this.incomeLine(workspaceId, incomeId, month);
  }

  private deductionIncome(workspaceId: string, deductionId: string): Promise<string> {
    return this.items.deductionIncomeId(workspaceId, deductionId);
  }

  // ---- regular expenses -------------------------------------------------------------------

  /** Loans and installment plans as seen in the given month (the member's current month). */
  async loans(workspaceId: string, month: string): Promise<LoansDto> {
    // The whole history: a loan's schedule may start long before and end long after the month.
    const snapshot = await this.snapshot(workspaceId, '1990-01', '2199-12');
    const rates = await this.ratesFor(month, month);
    const base = snapshot.settings.baseCurrency;
    return {
      baseCurrency: base,
      month,
      loans: buildLoans(snapshot, month, base, rates.forMonth(month).table),
    };
  }

  async recurring(workspaceId: string, month: string): Promise<RecurringLineDto[]> {
    const snapshot = await this.snapshot(workspaceId, month, month);
    const rates = await this.ratesFor(month, month);
    return buildRecurringLines(
      snapshot,
      month,
      snapshot.settings.baseCurrency,
      rates.forMonth(month).table,
    );
  }

  private async recurringLine(
    workspaceId: string,
    id: string,
    month: string,
  ): Promise<RecurringLineDto> {
    const line = (await this.recurring(workspaceId, month)).find((l) => l.id === id);
    if (!line) throw notFound('PLANNER_RECURRING_NOT_FOUND');
    return line;
  }

  async createRecurring(
    workspaceId: string,
    payload: Out<typeof recurringCreateSchema>,
    month: string,
  ) {
    await this.assertOwner(workspaceId, payload.ownerId);
    const id = await this.items.createRecurring({
      workspaceId,
      name: payload.name,
      isRequired: payload.isRequired,
      isOngoing: payload.isOngoing,
      ongoingStartDay: payload.ongoingStartDay,
      ongoingEndDay: payload.ongoingEndDay,
      isLoan: payload.isLoan,
      loanTotalMinor: payload.loanTotal === null ? null : toMinorNumber(payload.loanTotal),
      category: payload.category,
      currency: payload.currency,
      intervalMonths: payload.intervalMonths,
      startMonth: payload.startMonth,
      endMonth: payload.endMonth,
      dueDay: payload.dueDay,
      note: payload.note,
      amountMinor: toMinorNumber(payload.amount),
      ownerId: payload.ownerId,
    });
    return this.recurringLine(workspaceId, id, month);
  }

  /**
   * «Оплачено». With `actual` the real amount is written off an account as an operation linked
   * to the line (replacing an earlier one); unticking removes it. A fund return never writes an
   * operation: paying it puts money back into the fund, not out of the household.
   */
  async setPaid(
    workspaceId: string,
    id: string,
    month: string,
    paid: boolean,
    actual: Out<typeof actualPaymentSchema> | null = null,
    userId?: string,
  ) {
    const line = await this.recurringLine(workspaceId, id, month);
    if (paid && !line.active) throw unprocessable('PLANNER_RECURRING_NOT_PLANNED');
    if (paid && actual && line.isOngoing) throw unprocessable('PLANNER_ONGOING_PAID_BY_OPERATIONS');
    const statements: D1PreparedStatement[] = [];
    if (!paid) statements.push(this.ledger.removeFact(workspaceId, 'recurring', id, month));
    else if (actual && !line.isFundReturn && userId) {
      await this.assertOwner(workspaceId, actual.payerId);
      const account = await this.ledger.usableAccount(workspaceId, actual.accountId);
      statements.push(
        ...this.ledger.fact({
          workspaceId,
          userId,
          link: 'recurring',
          itemId: id,
          month,
          type: 'EXPENSE',
          amountMinor: toMinor(actual.amount),
          date: actual.date,
          accountId: account.id,
          currency: account.currency,
          payerId: actual.payerId ?? account.owner_id,
          plannerCategory: line.category,
          categoryKey: financeKeyForExpense(line.category),
          description: actual.note || line.name,
        }).statements,
      );
    }
    // The mark, its operation and (for a fund return) the money put back go in one batch.
    statements.push(this.fundReturns.setPaid(workspaceId, id, month, paid));
    if (line.isFundReturn)
      statements.push(
        ...(await this.returnMoney.statements(workspaceId, id, paid, userId ?? null)),
      );
    await this.d1.batch(statements);
    return this.recurringLine(workspaceId, id, month);
  }

  /** A planned income received: an income operation on the account it came to. */
  async receiveIncome(
    workspaceId: string,
    userId: string,
    id: string,
    payload: Out<typeof incomeReceiptSchema>,
  ): Promise<IncomeLineDto> {
    const line = await this.incomeLine(workspaceId, id, payload.month);
    if (!line.active) throw unprocessable('PLANNER_INCOME_NOT_PLANNED');
    await this.assertOwner(workspaceId, payload.payerId);
    const account = await this.ledger.usableAccount(workspaceId, payload.accountId);
    await this.d1.batch(
      this.ledger.fact({
        workspaceId,
        userId,
        link: 'income',
        itemId: id,
        month: payload.month,
        type: 'INCOME',
        amountMinor: toMinor(payload.amount),
        date: payload.date,
        accountId: account.id,
        currency: account.currency,
        payerId: payload.payerId ?? line.ownerId ?? account.owner_id,
        plannerCategory: null,
        categoryKey: financeKeyForIncome(line.kind),
        description: payload.note || line.name,
      }).statements,
    );
    return this.incomeLine(workspaceId, id, payload.month);
  }

  async unreceiveIncome(workspaceId: string, id: string, month: string): Promise<IncomeLineDto> {
    await this.ledger.removeFact(workspaceId, 'income', id, month).run();
    return this.incomeLine(workspaceId, id, month);
  }

  async updateRecurring(
    workspaceId: string,
    id: string,
    payload: Out<typeof recurringUpdateSchema>,
    month: string,
  ) {
    await this.assertOwner(workspaceId, payload.ownerId);
    const { version, loanTotal, ...changes } = payload;
    await this.guardCurrencyChange('recurring', workspaceId, id, changes.currency);
    await this.items.updateRecurring(workspaceId, id, version, {
      ...changes,
      ...(loanTotal === undefined ? {} : { loanTotalMinor: optionalMinor(loanTotal) }),
    });
    return this.recurringLine(workspaceId, id, month);
  }

  // ---- purchases ----------------------------------------------------------------------------

  async purchases(
    workspaceId: string,
    filter: { status?: PurchaseStatus; month?: string },
  ): Promise<PurchaseDto[]> {
    const [rows, shares] = await Promise.all([
      this.purchasesRepo.list(workspaceId, filter),
      this.d1
        ? this.d1
            .prepare('SELECT item_id, member_id, share_bp FROM item_shares WHERE workspace_id = ?')
            .bind(workspaceId)
            .all<{ item_id: string; member_id: string; share_bp: number }>()
        : null,
    ]);
    return rows.map((p) => {
      const own = shares?.results.filter((s) => s.item_id === p.id) ?? [];
      return {
        ...toPurchaseDto(p),
        shares: own.length
          ? own.map((s) => ({ memberId: s.member_id, share: bpToPercent(s.share_bp) }))
          : null,
      };
    });
  }

  private async purchase(workspaceId: string, id: string): Promise<PurchaseDto> {
    return toPurchaseDto(await this.purchasesRepo.find(workspaceId, id));
  }

  async createPurchase(
    workspaceId: string,
    userId: string,
    payload: Out<typeof purchaseCreateSchema>,
  ) {
    await this.assertOwner(workspaceId, payload.ownerId);
    const id = await this.purchasesRepo.create(
      {
        workspaceId,
        title: payload.title,
        category: payload.category,
        priority: payload.priority,
        currency: payload.currency,
        estimatedAmountMinor: toMinorNumber(payload.estimatedAmount),
        plannedMonth: payload.plannedMonth,
        note: payload.note,
        ownerId: payload.ownerId,
        status: 'ACTIVE',
      },
      userId,
    );
    return this.purchase(workspaceId, id);
  }

  async updatePurchase(
    workspaceId: string,
    userId: string,
    id: string,
    payload: Out<typeof purchaseUpdateSchema>,
  ) {
    await this.assertOwner(workspaceId, payload.ownerId);
    const { version, estimatedAmount, ...rest } = payload;
    const current = await this.purchasesRepo.find(workspaceId, id);
    const rescheduled =
      rest.plannedMonth !== undefined && rest.plannedMonth !== current.plannedMonth;
    if (rest.plannedMonth === null && current.status === 'PURCHASED' && !current.purchasedOn) {
      throw unprocessable('PLANNER_PURCHASE_NEEDS_DATE');
    }
    await this.purchasesRepo.change(
      workspaceId,
      id,
      version,
      { ...rest, estimatedAmountMinor: optionalMinor(estimatedAmount) ?? undefined },
      {
        type: rescheduled ? 'RESCHEDULED' : 'UPDATED',
        toMonth: rescheduled ? rest.plannedMonth : current.plannedMonth,
        amountMinor: estimatedAmount === undefined ? null : toMinorNumber(estimatedAmount),
      },
      userId,
      ['ACTIVE', 'PURCHASED'],
    );
    return this.purchase(workspaceId, id);
  }

  /**
   * Marking as bought records the actual price and date. Without a date the purchase stays in its
   * planned month ("bought that month"), so a date is never invented. No transaction is needed.
   */
  async completePurchase(
    workspaceId: string,
    userId: string,
    id: string,
    payload: Out<typeof purchaseCompleteSchema>,
  ) {
    const current = await this.purchasesRepo.find(workspaceId, id);
    if (payload.purchasedOn === null && !current.plannedMonth)
      throw unprocessable('PLANNER_PURCHASE_DATE_REQUIRED');
    const actual = toMinorNumber(payload.actualAmount);
    const operation: D1PreparedStatement[] = [];
    if (payload.accountId) {
      await this.assertOwner(workspaceId, payload.payerId);
      const account = await this.ledger.usableAccount(workspaceId, payload.accountId);
      const date = payload.purchasedOn ?? today();
      operation.push(
        ...this.ledger.fact({
          workspaceId,
          userId,
          link: 'purchase',
          itemId: id,
          month: current.plannedMonth ?? date.slice(0, 7),
          type: 'EXPENSE',
          amountMinor: actual,
          date,
          accountId: account.id,
          currency: account.currency,
          payerId: payload.payerId ?? account.owner_id,
          plannerCategory: 'PURCHASES',
          categoryKey: financeKeyForPurchase(current.category),
          description: current.title,
        }).statements,
      );
    }
    await this.purchasesRepo.change(
      workspaceId,
      id,
      payload.version,
      { status: 'PURCHASED', purchasedOn: payload.purchasedOn, actualAmountMinor: actual },
      { type: 'PURCHASED', amountMinor: actual, eventDate: payload.purchasedOn },
      userId,
      ['ACTIVE', 'PURCHASED'],
      operation,
    );
    return this.purchase(workspaceId, id);
  }

  async setPurchaseStatus(
    workspaceId: string,
    userId: string,
    id: string,
    version: number,
    action: 'unpurchase' | 'cancel' | 'restore',
  ) {
    const transitions = {
      unpurchase: { from: ['PURCHASED'], type: 'UNPURCHASED' },
      cancel: { from: ['ACTIVE'], type: 'CANCELLED' },
      restore: { from: ['CANCELLED'], type: 'RESTORED' },
    } as const;
    const { from, type } = transitions[action];

    await this.purchasesRepo.change(
      workspaceId,
      id,
      version,
      {
        status: action === 'cancel' ? 'CANCELLED' : 'ACTIVE',
        purchasedOn: null,
        actualAmountMinor: null,
      },
      { type },
      userId,
      [...from],
      // Not bought any more: the money did not leave the account.
      action === 'unpurchase' ? [this.ledger.removeFact(workspaceId, 'purchase', id)] : [],
    );
    return this.purchase(workspaceId, id);
  }

  async deletePurchase(workspaceId: string, id: string): Promise<void> {
    const current = await this.purchasesRepo.find(workspaceId, id);
    if (current.status === 'PURCHASED') {
      throw conflict('PLANNER_PURCHASED_UNDELETABLE');
    }
    await this.purchasesRepo.delete(workspaceId, id);
  }

  async purchaseHistory(workspaceId: string, id: string): Promise<PurchaseEventDto[]> {
    await this.purchasesRepo.find(workspaceId, id);
    const rows = await this.purchasesRepo.history(workspaceId, id);
    return rows.map(({ event, userName, userEmail }) => ({
      id: event.id,
      type: event.type as PurchaseEventDto['type'],
      fromMonth: event.fromMonth,
      toMonth: event.toMonth,
      amount: event.amountMinor === null ? null : formatMinor(event.amountMinor),
      currency: event.currency as PurchaseEventDto['currency'],
      date: event.eventDate,
      createdAt: event.createdAt.toISOString(),
      createdBy: userEmail ? { name: userName, email: userEmail } : null,
    }));
  }

  // ---- exchange rates -----------------------------------------------------------------------

  ratesStatus(): Promise<RatesStatusDto> {
    return this.rates.status();
  }

  async refreshRates(): Promise<RatesStatusDto> {
    const earliest = await this.repo.earliestMonthOverall();
    await this.rates.refresh(earliest ? `${earliest}-01` : undefined);
    return this.rates.status();
  }
}
