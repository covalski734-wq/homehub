import type {
  BaseCurrency,
  BudgetBreakdownDto,
  DeductionDto,
  ExchangeRateDto,
  IncomeLineDto,
  LoanDto,
  MonthBudgetDto,
  MonthFactDto,
  PlannerCurrency,
  PlanFactDto,
  PurchaseDto,
  RecurringCategory,
  SavingsPlanDto,
  ShareDto,
  RecurringLineDto,
} from '@homehub/shared';
import { shiftMonth } from '@homehub/shared';
import { formatMinor, toMinor } from '../lib/money';
import {
  amountForMonth,
  applyDeductions,
  bpToPercent,
  budgetTotals,
  convert,
  isInPeriod,
  purchaseBudgetEntry,
  resolveMonthValue,
  type AmountEntry,
  type DeductionRule,
  type Override,
  type RateTable,
} from './calculations';
import type { FactRow } from './extras.repository';
import { planFunds } from './fund-plan';
import type { AmountRow, OverrideRow, PlannerSnapshot, PurchaseRow } from './planner.repository';

export interface RatesForMonth {
  table: RateTable;
  used: ExchangeRateDto[];
}

/** Rates valid on a given date — purchases already made convert at their own date's rate. */
export type RatesAtDate = (date: string) => RateTable;

function groupHistory(rows: readonly AmountRow[]): Map<string, AmountEntry[]> {
  const map = new Map<string, AmountEntry[]>();
  for (const row of rows) {
    const list = map.get(row.itemId) ?? [];
    list.push({ effectiveMonth: row.effectiveMonth, amountMinor: row.amountMinor });
    map.set(row.itemId, list);
  }
  return map;
}

function overrideFor(
  rows: readonly OverrideRow[],
  itemId: string,
  month: string,
): Override | undefined {
  return rows.find((row) => row.itemId === itemId && row.month === month);
}

const money = (value: bigint) => formatMinor(value);
const moneyOrNull = (value: bigint | null) => (value === null ? null : formatMinor(value));

function sharesDto(snapshot: PlannerSnapshot, id: string): ShareDto[] | null {
  const list = snapshot.extras.shares.get(id);
  return list?.length
    ? list.map((s) => ({ memberId: s.memberId, share: bpToPercent(s.shareBp) }))
    : null;
}

/**
 * Splits an amount between members: an owner takes it all; a joint line by its own shares, else
 * by the household default (equal, or by the members' own incomes). Rounding leftovers go to the
 * first member, so the parts always add up to the amount.
 */
function splitter(snapshot: PlannerSnapshot, ownIncome: Map<string, bigint>) {
  const members = snapshot.extras.members;
  const known = new Set(members);
  const byWeights = (amount: bigint, weights: [string, bigint][]) => {
    const total = weights.reduce((sum, [, w]) => sum + w, 0n);
    const out = new Map<string, bigint>();
    if (total <= 0n) return out;
    let given = 0n;
    for (const [id, w] of weights) {
      const part = (amount * w) / total;
      out.set(id, part);
      given += part;
    }
    const first = weights[0]![0];
    out.set(first, out.get(first)! + amount - given);
    return out;
  };
  const income = members.map((id) => [id, ownIncome.get(id) ?? 0n] as [string, bigint]);
  const fallback: [string, bigint][] =
    snapshot.extras.jointSplit === 'INCOME' && income.some(([, w]) => w > 0n)
      ? income
      : members.map((id) => [id, 1n]);
  return (amount: bigint, ownerId: string | null, itemId: string | null): Map<string, bigint> => {
    if (members.length === 0) return new Map();
    if (ownerId && known.has(ownerId)) return new Map([[ownerId, amount]]);
    const own = itemId
      ? snapshot.extras.shares.get(itemId)?.filter((s) => known.has(s.memberId))
      : undefined;
    return byWeights(
      amount,
      own?.length ? own.map((s) => [s.memberId, BigInt(s.shareBp)]) : fallback,
    );
  };
}

function factDto(fact: FactRow | undefined): PlanFactDto | null {
  return fact
    ? {
        transactionId: fact.id,
        amount: formatMinor(fact.amountMinor),
        currency: fact.currency,
        date: fact.occurredAt,
        accountId: fact.accountId,
        payerId: fact.payerId,
      }
    : null;
}

export function toPurchaseDto(row: PurchaseRow, facts: readonly FactRow[] = []): PurchaseDto {
  const entry = purchaseBudgetEntry(row);
  return {
    id: row.id,
    title: row.title,
    ownerId: row.ownerId,
    shares: null,
    actual: factDto(facts.find((f) => f.purchaseId === row.id)),
    category: row.category as PurchaseDto['category'],
    priority: row.priority,
    currency: row.currency as PlannerCurrency,
    estimatedAmount: formatMinor(row.estimatedAmountMinor),
    plannedMonth: row.plannedMonth,
    status: row.status,
    purchasedOn: row.purchasedOn,
    actualAmount: row.actualAmountMinor === null ? null : formatMinor(row.actualAmountMinor),
    note: row.note,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    budgetMonth: entry?.month ?? null,
    budgetAmount: formatMinor(entry?.amount ?? 0n),
  };
}

export function buildIncomeLines(
  snapshot: PlannerSnapshot,
  month: string,
  base: BaseCurrency,
  rates: RateTable,
): IncomeLineDto[] {
  const history = groupHistory(snapshot.incomeAmounts);
  return snapshot.incomes.map((source) => {
    const value = resolveMonthValue(
      { startMonth: source.startMonth, endMonth: source.endMonth, intervalMonths: 1 },
      history.get(source.id) ?? [],
      overrideFor(snapshot.incomeOverrides, source.id, month),
      month,
    );
    const currency = source.currency as PlannerCurrency;
    const rules = snapshot.deductions.filter((d) => d.incomeId === source.id);
    const gross = value.amount;
    // The same rules are applied once in the income currency (for the row) and once in the base
    // currency (for totals), so a PLN commission on a EUR salary is never rounded twice.
    const fixedIn = (target: string) => (rule: DeductionRule) =>
      convert(BigInt(rule.amountMinor ?? 0), rule.currency ?? currency, target, rates);
    const inIncome = applyDeductions(rules, gross, month, fixedIn(currency));
    const grossBase = convert(gross, currency, base, rates);
    const inBase =
      grossBase === null ? null : applyDeductions(rules, grossBase, month, fixedIn(base));

    const deductionsTotal = inIncome.reduce<bigint>((sum, a) => sum + (a ?? 0n), 0n);
    const deductionsBase =
      inBase === null || inBase.includes(null)
        ? null
        : inBase.reduce<bigint>((sum, a) => sum + a!, 0n);
    const deductions: DeductionDto[] = rules.map((d, index) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      rate: d.rateBp === null ? null : bpToPercent(d.rateBp),
      base: d.base,
      amount: d.amountMinor === null ? null : formatMinor(d.amountMinor),
      currency: (d.currency ?? currency) as PlannerCurrency,
      startMonth: d.startMonth,
      endMonth: d.endMonth,
      version: d.version,
      monthAmount: moneyOrNull(inIncome[index]!),
      active: value.active && isInPeriod(month, d.startMonth, d.endMonth),
    }));
    const net = value.amount - deductionsTotal;
    return {
      id: source.id,
      name: source.name,
      ownerId: source.ownerId,
      shares: sharesDto(snapshot, source.id),
      received: factDto(
        snapshot.extras.facts.find((f) => f.incomeSourceId === source.id && f.month === month),
      ),
      kind: source.kind,
      currency,
      startMonth: source.startMonth,
      endMonth: source.endMonth,
      version: source.version,
      active: value.active,
      overridden: value.overridden,
      gross: money(value.amount),
      deductions,
      deductionsTotal: money(deductionsTotal),
      net: money(net),
      grossBase: moneyOrNull(grossBase),
      deductionsBase: moneyOrNull(deductionsBase),
      netBase:
        grossBase === null || deductionsBase === null ? null : money(grossBase - deductionsBase),
    };
  });
}

export function buildRecurringLines(
  snapshot: PlannerSnapshot,
  month: string,
  base: BaseCurrency,
  rates: RateTable,
): RecurringLineDto[] {
  const history = groupHistory(snapshot.recurringAmounts);
  return snapshot.recurring.map((expense) => {
    const value = resolveMonthValue(
      expense,
      history.get(expense.id) ?? [],
      overrideFor(snapshot.recurringOverrides, expense.id, month),
      month,
    );
    const currency = expense.currency as PlannerCurrency;
    // Inactive rows still show their regular amount so the table stays informative.
    const shown = value.active
      ? value.amount
      : amountForMonth(history.get(expense.id) ?? [], month);
    return {
      id: expense.id,
      name: expense.name,
      ownerId: expense.ownerId,
      shares: sharesDto(snapshot, expense.id),
      actual: factDto(
        snapshot.extras.facts.find((f) => f.recurringExpenseId === expense.id && f.month === month),
      ),
      isFundReturn: snapshot.extras.fundReturnIds.has(expense.id),
      isRequired: expense.isRequired,
      isOngoing: expense.isOngoing,
      ongoingStartDay: expense.ongoingStartDay,
      ongoingEndDay: expense.ongoingEndDay,
      isLoan: expense.isLoan,
      loanTotal: expense.loanTotalMinor === null ? null : formatMinor(expense.loanTotalMinor),
      paid: snapshot.recurringPayments.some(
        (p) => p.expenseId === expense.id && p.month === month && p.paid,
      ),
      category: expense.category as RecurringCategory,
      currency,
      intervalMonths: expense.intervalMonths,
      startMonth: expense.startMonth,
      endMonth: expense.endMonth,
      dueDay: expense.dueDay,
      note: expense.note,
      version: expense.version,
      active: value.active,
      skipped: value.skipped,
      overridden: value.overridden,
      amount: money(shown),
      base: value.active ? moneyOrNull(convert(value.amount, currency, base, rates)) : money(0n),
    };
  });
}

/** Sum of the base-currency values; lines without a rate are left out and reported. */
function sumBase(values: (string | null)[]): bigint {
  return values.reduce<bigint>((sum, value) => (value === null ? sum : sum + toMinor(value)), 0n);
}

export function buildMonthBudget(
  snapshot: PlannerSnapshot,
  month: string,
  monthRates: RatesForMonth,
  ratesAt: RatesAtDate,
): MonthBudgetDto {
  const base = snapshot.settings.baseCurrency;
  const incomes = buildIncomeLines(snapshot, month, base, monthRates.table);
  const recurring = buildRecurringLines(snapshot, month, base, monthRates.table);
  const missing = new Set<PlannerCurrency>();

  const activeIncomes = incomes.filter((line) => line.active);
  for (const line of activeIncomes) {
    if (line.grossBase === null) missing.add(line.currency);
    else if (line.deductionsBase === null)
      for (const d of line.deductions) if (d.monthAmount === null) missing.add(d.currency);
  }
  const activeRecurring = recurring.filter((line) => line.active);
  for (const line of activeRecurring) if (line.base === null) missing.add(line.currency);

  const monthPurchases = snapshot.purchases.filter((p) => purchaseBudgetEntry(p)?.month === month);
  const purchaseBases = monthPurchases.map((p) => {
    const entry = purchaseBudgetEntry(p)!;
    const table =
      p.status === 'PURCHASED' && p.purchasedOn ? ratesAt(p.purchasedOn) : monthRates.table;
    const converted = convert(entry.amount, p.currency, base, table);
    if (converted === null) missing.add(p.currency as PlannerCurrency);
    return converted;
  });

  const savingsRateBp = snapshot.monthPlans.get(month) ?? snapshot.settings.defaultSavingsRateBp;
  const purchasesTotal = purchaseBases.reduce<bigint>((sum, value) => sum + (value ?? 0n), 0n);
  const totals = budgetTotals({
    grossIncome: sumBase(activeIncomes.map((l) => l.grossBase)),
    deductions: sumBase(activeIncomes.map((l) => l.deductionsBase)),
    recurring: sumBase(activeRecurring.map((l) => l.base)),
    purchases: purchasesTotal,
    savingsRateBp,
  });

  const byCategory = new Map<string, bigint>();
  for (const line of activeRecurring) {
    if (line.base !== null)
      byCategory.set(line.category, (byCategory.get(line.category) ?? 0n) + sumBase([line.base]));
  }
  const breakdown: BudgetBreakdownDto[] = [...byCategory.entries()]
    .filter(([, amount]) => amount > 0n)
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .map(([key, amount]) => ({ key, kind: 'recurring' as const, amount: money(amount) }));
  if (purchasesTotal > 0n)
    breakdown.push({ key: 'PURCHASES', kind: 'purchases', amount: money(purchasesTotal) });

  // Fund plans replace the savings rate once any fund part has a rule or an override this month.
  const freeBeforeSavings = totals.netIncome - totals.recurring - totals.purchases;
  const netByOwner = new Map<string | null, bigint>();
  for (const line of activeIncomes)
    if (line.netBase !== null)
      netByOwner.set(line.ownerId, (netByOwner.get(line.ownerId) ?? 0n) + toMinor(line.netBase));
  const funds = planFunds(snapshot.extras.funds, {
    month,
    base,
    rates: monthRates.table,
    netIncome: totals.netIncome,
    netByOwner,
    freeBeforeSavings,
  });
  if (funds) {
    totals.savingsTarget = toMinor(funds.total);
    totals.free = freeBeforeSavings - totals.savingsTarget;
  }
  const savingsPlan: SavingsPlanDto = funds ?? {
    source: 'RATE',
    unallocated: money(0n),
    lines: [],
    total: money(totals.savingsTarget),
    freeBeforeSavings: money(freeBeforeSavings),
    deficit: money(totals.free < 0n ? -totals.free : 0n),
    warnings:
      totals.free < 0n
        ? [
            {
              code: 'MONTH_PLAN_OVER_INCOME',
              params: { amount: money(-totals.free), currency: base },
            },
          ]
        : [],
  };

  /** Each member's month: own lines plus their share of the joint ones. */
  function ownerBudgets() {
    const members = snapshot.extras.members;
    if (members.length === 0) return [];
    const ownIncome = new Map<string, bigint>();
    for (const line of activeIncomes)
      if (line.ownerId && line.netBase !== null)
        ownIncome.set(line.ownerId, (ownIncome.get(line.ownerId) ?? 0n) + toMinor(line.netBase));
    const split = splitter(snapshot, ownIncome);
    const sums = new Map(members.map((id) => [id, { income: 0n, expenses: 0n, savings: 0n }]));
    const add = (key: 'income' | 'expenses' | 'savings', parts: Map<string, bigint>) => {
      for (const [id, amount] of parts) sums.get(id)![key] += amount;
    };
    for (const line of activeIncomes)
      if (line.netBase !== null) add('income', split(toMinor(line.netBase), line.ownerId, line.id));
    for (const line of activeRecurring)
      if (line.base !== null) add('expenses', split(toMinor(line.base), line.ownerId, line.id));
    monthPurchases.forEach((p, i) => {
      const value = purchaseBases[i];
      if (value !== null && value !== undefined) add('expenses', split(value, p.ownerId, p.id));
    });
    if (funds)
      for (const line of funds.lines)
        if (line.plannedBase !== null)
          add('savings', split(toMinor(line.plannedBase), line.ownerId, null));
    if (funds) add('savings', split(toMinor(funds.unallocated), null, null));
    if (!funds) add('savings', split(totals.savingsTarget, null, null));
    return members.map((id) => {
      const s = sums.get(id)!;
      return {
        ownerId: id,
        netIncome: money(s.income),
        expenses: money(s.expenses),
        savings: money(s.savings),
        free: money(s.income - s.expenses - s.savings),
      };
    });
  }

  return {
    month,
    baseCurrency: base,
    savingsRate: bpToPercent(savingsRateBp),
    savingsRateIsDefault: !snapshot.monthPlans.has(month),
    totals: {
      grossIncome: money(totals.grossIncome),
      deductions: money(totals.deductions),
      netIncome: money(totals.netIncome),
      recurring: money(totals.recurring),
      purchases: money(totals.purchases),
      savingsTarget: money(totals.savingsTarget),
      free: money(totals.free),
    },
    incomes,
    recurring,
    purchases: monthPurchases.map((p) => ({
      ...toPurchaseDto(p, snapshot.extras.facts),
      shares: sharesDto(snapshot, p.id),
    })),
    savingsPlan,
    byOwner: ownerBudgets(),
    fact: null,
    breakdown,
    rates: monthRates.used,
    missingRates: [...missing],
  };
}

/** Safety cap on a schedule walk (50 years of monthly payments). */
const MAX_LOAN_MONTHS = 600;

/**
 * Loans and installment plans: regular expenses marked as loans, walked month by month through
 * their schedule (interval, one-month amounts and skipped months included). Payments before
 * `current` count as made — a loan entered mid-way does not need every past month ticked off —
 * and the current month counts once it is marked paid.
 */
export function buildLoans(
  snapshot: PlannerSnapshot,
  current: string,
  base: BaseCurrency,
  rates: RateTable,
): LoanDto[] {
  const history = groupHistory(snapshot.recurringAmounts);
  const paidMonths = new Set(
    snapshot.recurringPayments.filter((p) => p.paid).map((p) => `${p.expenseId}:${p.month}`),
  );
  return snapshot.recurring
    .filter((expense) => expense.isLoan)
    .map((expense) => {
      const amounts = history.get(expense.id) ?? [];
      const currency = expense.currency as PlannerCurrency;
      // An open-ended loan is walked a year ahead only to find its next payment.
      const last = expense.endMonth ?? shiftMonth(current, 12);
      let count = 0;
      let paidCount = 0;
      let total = 0n;
      let paid = 0n;
      let lastAmount = 0n;
      let nextMonth: string | null = null;
      let nextAmount: bigint | null = null;
      let month = expense.startMonth;
      for (let i = 0; month <= last && i < MAX_LOAN_MONTHS; i++, month = shiftMonth(month, 1)) {
        const value = resolveMonthValue(
          expense,
          amounts,
          overrideFor(snapshot.recurringOverrides, expense.id, month),
          month,
        );
        if (!value.active) continue;
        const isPaid = month < current || paidMonths.has(`${expense.id}:${month}`);
        if (isPaid) {
          paidCount += 1;
          paid += value.amount;
        } else if (nextMonth === null) {
          nextMonth = month;
          nextAmount = value.amount;
        }
        if (expense.endMonth || isPaid) {
          count += 1;
          total += value.amount;
          lastAmount = value.amount;
        }
      }
      const manual = expense.loanTotalMinor !== null;
      const totalValue = manual ? BigInt(expense.loanTotalMinor!) : expense.endMonth ? total : null;
      const remaining = totalValue === null ? null : totalValue > paid ? totalValue - paid : 0n;
      const payment = nextAmount ?? (lastAmount || amountForMonth(amounts, current));
      return {
        id: expense.id,
        name: expense.name,
        currency,
        startMonth: expense.startMonth,
        endMonth: expense.endMonth,
        intervalMonths: expense.intervalMonths,
        payment: money(payment),
        paymentsTotal: expense.endMonth ? count : null,
        paymentsPaid: paidCount,
        total: moneyOrNull(totalValue),
        paid: money(paid),
        remaining: moneyOrNull(remaining),
        nextMonth: remaining === 0n ? null : nextMonth,
        totalIsManual: manual,
        paymentBase: moneyOrNull(convert(payment, currency, base, rates)),
        remainingBase:
          remaining === null ? null : moneyOrNull(convert(remaining, currency, base, rates)),
      };
    });
}

/**
 * Plan against fact of a month. Plan: the budget's net income, regular payments by category and
 * purchases, the savings plan. Fact: income and expense operations counted in that month (a linked
 * operation in its line's month), and fund deposits. Reconciliations are never facts.
 */
export function buildMonthFact(
  budget: MonthBudgetDto,
  snapshot: PlannerSnapshot,
  rates: RateTable,
): MonthFactDto {
  const base = budget.baseCurrency;
  const missing = new Set<string>();
  const inBase = (amount: bigint, currency: string) => {
    const value = convert(amount, currency, base, rates);
    if (value === null) missing.add(currency);
    return value ?? 0n;
  };
  const facts = snapshot.extras.facts.filter((f) => f.month === budget.month);
  const plan = new Map<string, bigint>();
  for (const row of budget.breakdown) plan.set(row.key, toMinor(row.amount));
  const fact = new Map<string, bigint>();
  let income = 0n;
  let unplanned = 0n;
  for (const f of facts) {
    const amount = inBase(BigInt(f.amountMinor), f.currency);
    if (f.type === 'INCOME') {
      income += amount;
      continue;
    }
    const key = f.purchaseId ? 'PURCHASES' : (f.plannerCategory ?? 'OTHER');
    fact.set(key, (fact.get(key) ?? 0n) + amount);
    if (!f.recurringExpenseId && !f.purchaseId) unplanned += amount;
  }
  let deposited = 0n;
  for (const part of snapshot.extras.funds.parts) {
    const amount = snapshot.extras.funds.deposits.get(`${part.subaccountId}:${budget.month}`);
    if (amount) deposited += inBase(BigInt(amount), part.currency);
  }
  const keys = [...new Set([...plan.keys(), ...fact.keys()])];
  const expensesFact = [...fact.values()].reduce((sum, v) => sum + v, 0n);
  return {
    income: { plan: budget.totals.netIncome, fact: money(income) },
    expenses: {
      plan: money(toMinor(budget.totals.recurring) + toMinor(budget.totals.purchases)),
      fact: money(expensesFact),
    },
    savings: { plan: budget.totals.savingsTarget, fact: money(deposited) },
    rows: keys
      .map((key) => ({
        key,
        kind: key === 'PURCHASES' ? ('purchases' as const) : ('recurring' as const),
        plan: money(plan.get(key) ?? 0n),
        fact: money(fact.get(key) ?? 0n),
      }))
      .sort((a, b) => Number(b.plan) - Number(a.plan) || Number(b.fact) - Number(a.fact)),
    unplanned: money(unplanned),
    missingRates: [...missing],
  };
}
