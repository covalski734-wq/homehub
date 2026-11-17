import {
  JOINT_COLOR,
  type AccountDto,
  type BaseCurrency,
  type FundRuleDto,
  type MovementDto,
  type PlannerCurrency,
  type PositionDto,
  type PotDto,
  type SavingsOverviewDto,
  type SavingsPlanDto,
  type SubaccountDto,
  type WealthDto,
  type WealthOwnerDto,
} from '@homehub/shared';
import { currentMonth, today } from '../lib/dates';
import { formatMinor, toMinor } from '../lib/money';
import { requireScope, type ServiceContext } from '../lib/service-context';
import type { AccountsService } from '../finance/services/accounts.service';
import type { MembersService } from '../members/members.service';
import { bpToPercent, convert, type RateTable } from '../planner/calculations';
import type { PlannerService } from '../planner/planner.service';
import type { RatesService } from '../planner/rates.service';
import { change24h, valueMinor, type AssetPrice, type AssetPricesService } from './asset-prices';
import { autoRuleDto } from './auto.service';
import { formatMicros } from './portfolio.service';
import {
  balanceOf,
  isOpen,
  type AutosData,
  type MovementRow,
  type PartRow,
  type PositionRow,
  type PotRow,
  type RuleRow,
  type SavingsData,
  type SavingsRepository,
} from './savings.repository';

/** Months the fund forecast looks ahead. */
const FORECAST_MONTHS = 36;
const STALE_DAYS = 2;

const money = (value: bigint | number) => formatMinor(value);

function ruleDto(r: RuleRow | undefined): FundRuleDto | null {
  if (!r) return null;
  return {
    mode: r.mode,
    amount: r.amount_minor === null ? null : money(r.amount_minor),
    percent: r.percent_bp === null ? null : bpToPercent(r.percent_bp),
    percentBase: r.percent_base,
    min: r.min_minor === null ? null : money(r.min_minor),
    max: r.max_minor === null ? null : money(r.max_minor),
    priority: r.priority,
    startMonth: r.start_month,
    endMonth: r.end_month,
  };
}

function toMovementDto(m: MovementRow, currency: PlannerCurrency, month: string): MovementDto {
  const now = currentMonth();
  return {
    id: m.id,
    type: m.type,
    amount: money(m.amount_minor),
    currency,
    date: m.occurred_on,
    note: m.note,
    repayment:
      m.type === 'WITHDRAWAL' && m.repay_month
        ? {
            month: m.repay_month,
            expenseId: m.repay_expense_id,
            returned: Boolean(m.returned),
            overdue: isOpen(m) && m.repay_month < (month > now ? month : now),
          }
        : null,
    subaccountId: m.subaccount_id,
    transactionId: m.transaction_id,
    auto: m.auto_rule_id !== null,
    createdAt: new Date(m.created_at).toISOString(),
  };
}

function toPositionDto(
  p: PositionRow,
  price: AssetPrice | undefined,
  currency: string,
  rates: RateTable,
): PositionDto {
  const unit = price ? convert(price.pricePlnMicros, 'PLN', currency, rates) : null;
  const value = unit === null ? null : valueMinor(p.quantity, unit);
  const change = value === null ? null : change24h(value, price?.change24hBp ?? null);
  const cost =
    p.avg_price_micros === null ? null : valueMinor(p.quantity, BigInt(p.avg_price_micros));
  const stale =
    !price || Date.now() - Date.parse(`${price.priceDate}T00:00:00Z`) > STALE_DAYS * 86_400_000;
  return {
    id: p.id,
    asset: { id: p.asset, symbol: p.symbol, name: p.name, image: p.image },
    quantity: p.quantity,
    price: unit === null ? null : formatMicros(unit),
    value: value === null ? null : money(value),
    // A 24-hour change of an old price is not today's change.
    change24h: change === null || stale ? null : money(change),
    priceDate: price?.priceDate ?? null,
    stale: price !== undefined && stale,
    avgPrice: p.avg_price_micros === null ? null : formatMicros(BigInt(p.avg_price_micros)),
    cost: cost === null ? null : money(cost),
    profit: cost === null || value === null ? null : money(value - cost),
  };
}

/** First month the balance plus the plans not yet deposited reaches the target. */
function reachMonth(
  potId: string,
  balance: bigint,
  target: bigint,
  plans: { month: string; plan: SavingsPlanDto }[],
  inFund: (amount: bigint, currency: string) => bigint,
): string | null {
  if (balance >= target) return currentMonth();
  let running = balance;
  for (const { month, plan } of plans) {
    for (const line of plan.lines)
      if (line.potId === potId) {
        const left = toMinor(line.planned) - toMinor(line.deposited);
        if (left > 0n) running += inFund(left, line.currency);
      }
    if (running >= target) return month;
  }
  return null;
}

interface View {
  data: SavingsData;
  autos: AutosData;
  prices: Map<string, AssetPrice>;
  base: BaseCurrency;
  rates: RateTable;
  month: string;
  shown: SavingsPlanDto;
  plans: { month: string; plan: SavingsPlanDto }[];
}

function toPartDto(
  s: PartRow,
  movements: MovementRow[],
  fundCurrency: string,
  view: View,
): SubaccountDto {
  const { month, shown, rates, autos, data } = view;
  const own = movements.filter((m) => m.subaccount_id === s.id);
  const balance = balanceOf(s.opening_minor, own);
  const deposited = own
    .filter((m) => m.type === 'DEPOSIT' && m.occurred_on.startsWith(month))
    .reduce((sum, m) => sum + BigInt(m.amount_minor), 0n);
  const line = shown.lines.find((l) => l.subaccountId === s.id);
  const autoRules = autos.rules
    .filter(
      (r) =>
        r.subaccount_id === s.id &&
        r.start_month <= month &&
        (!r.end_month || r.end_month >= month),
    )
    .map((r) => autoRuleDto(r, autos, month));
  const pendingAuto = autoRules
    .filter((r) => r.type === 'DEPOSIT' && !r.done)
    .reduce((sum, r) => sum + toMinor(r.amount), 0n);
  const rulePlan = line ? toMinor(line.planned) : 0n;
  const planned = rulePlan > deposited + pendingAuto ? rulePlan : deposited + pendingAuto;
  // The plan is not money: the forecast adds only what is still to be deposited.
  const left = month >= currentMonth() && planned > deposited ? planned - deposited : 0n;
  const valueInFund = convert(balance, s.currency, fundCurrency, rates);
  return {
    id: s.id,
    name: s.name,
    currency: s.currency,
    valueInFund: valueInFund === null ? null : money(valueInFund),
    autoRules,
    ownerId: s.owner_id,
    color: s.color,
    accountId: s.account_id,
    balance: money(balance),
    owed: money(own.filter(isOpen).reduce((sum, m) => sum + BigInt(m.amount_minor), 0n)),
    note: s.note,
    archived: s.archived_at !== null,
    planned: money(planned),
    deposited: money(deposited),
    forecast: money(balance + left),
    rule: ruleDto(data.rules.get(s.id)),
    overridden: data.overridden.has(s.id),
  };
}

function toPotDto(pot: PotRow, view: View): PotDto {
  const { data, prices, base, rates, month, plans } = view;
  // Parts may be in other currencies: fund totals are in the fund's currency at today's rate.
  const inFund = (amount: bigint, currency: string) =>
    convert(amount, currency, pot.currency, rates) ?? 0n;
  const movements = data.movements.filter((m) => m.pot_id === pot.id);
  const positions = data.positions
    .filter((p) => p.pot_id === pot.id)
    .map((p) => toPositionDto(p, prices.get(p.asset), pot.currency, rates))
    .sort((a, b) => Number(b.value ?? -1) - Number(a.value ?? -1));
  const isCash = pot.kind === 'CASH';
  const parts = isCash
    ? data.parts
        .filter((s) => s.pot_id === pot.id)
        .map((s) => toPartDto(s, movements, pot.currency, view))
    : [];
  const liveParts = parts.filter((s) => !s.archived);
  const sumParts = (pick: (s: SubaccountDto) => string) =>
    liveParts.reduce((sum, s) => sum + inFund(toMinor(pick(s)), s.currency), 0n);
  const balance = isCash
    ? sumParts((s) => s.balance)
    : positions.reduce((sum, p) => sum + (p.value === null ? 0n : toMinor(p.value)), 0n);
  const change =
    !isCash && positions.some((p) => p.change24h !== null)
      ? positions.reduce((sum, p) => sum + (p.change24h ? toMinor(p.change24h) : 0n), 0n)
      : null;
  const priced = positions.flatMap((p) =>
    p.cost !== null && p.value !== null ? [{ cost: toMinor(p.cost), value: toMinor(p.value) }] : [],
  );
  const withdrawn = movements
    .filter((m) => m.type === 'WITHDRAWAL' && m.occurred_on.startsWith(month))
    .reduce((sum, m) => {
      const part = parts.find((p) => p.id === m.subaccount_id);
      return sum + inFund(BigInt(m.amount_minor), part?.currency ?? pot.currency);
    }, 0n);
  const target = pot.target_minor === null ? null : BigInt(pot.target_minor);
  const value = convert(balance, pot.currency, base, rates);
  return {
    id: pot.id,
    name: pot.name,
    kind: pot.kind,
    currency: pot.currency,
    archived: pot.archived_at !== null,
    balance: money(balance),
    value: value === null ? null : money(value),
    change24h: change === null ? null : money(change),
    owed: money(sumParts((s) => s.owed)),
    positions,
    movements: movements
      // The shown month's movements and every withdrawal still to be returned; the full
      // history is `history()`.
      .filter((m) => m.occurred_on.startsWith(month) || isOpen(m))
      .map((m) =>
        toMovementDto(
          m,
          parts.find((p) => p.id === m.subaccount_id)?.currency ?? pot.currency,
          month,
        ),
      ),
    ownerId: pot.owner_id,
    color: pot.color,
    icon: pot.icon,
    target: target === null ? null : money(target),
    targetDate: pot.target_date,
    priority: pot.priority,
    description: pot.description,
    note: pot.note,
    excludeFromTotal: Boolean(pot.exclude_from_total),
    progress:
      target && target > 0n
        ? Math.min(100, Math.round(Number((balance * 10000n) / target)) / 100)
        : null,
    subaccounts: parts,
    planned: money(sumParts((s) => s.planned)),
    deposited: money(sumParts((s) => s.deposited)),
    withdrawn: money(withdrawn),
    forecast: money(sumParts((s) => s.forecast)),
    forecastMonth: isCash && target ? reachMonth(pot.id, balance, target, plans, inFund) : null,
    cost: priced.length ? money(priced.reduce((s, p) => s + p.cost, 0n)) : null,
    profit: priced.length ? money(priced.reduce((s, p) => s + p.value - p.cost, 0n)) : null,
  };
}

/**
 * Read side of funds and portfolios. Reading has no side effects: automatic operations are made
 * by cron and right after a rule changes, prices are refreshed by cron, by a purchase and by the
 * «обновить курс» button; the overview shows the stored prices with their date.
 */
export class SavingsQueries {
  constructor(
    private readonly repo: SavingsRepository,
    private readonly planner: PlannerService,
    private readonly rates: RatesService,
    private readonly prices: AssetPricesService,
    private readonly accounts: AccountsService,
    private readonly members: MembersService,
  ) {}

  /** Savings plans from `month` on, or none for a past month (its plan no longer forecasts). */
  private async plansFrom(ctx: ServiceContext, month: string) {
    const planner = this.planner.forViewer(ctx.userId);
    const start = month < currentMonth() ? currentMonth() : month;
    const [plans, shown] = await Promise.all([
      planner.savingsPlans(ctx.workspaceId, start, FORECAST_MONTHS),
      month < start ? planner.savingsPlans(ctx.workspaceId, month, 1) : null,
    ]);
    const first = (shown ?? plans)[0];
    if (!first) throw new Error('A savings plan of at least one month is expected');
    return { plans, shown: first.plan };
  }

  async overview(ctx: ServiceContext, month: string): Promise<SavingsOverviewDto> {
    requireScope(ctx, 'savings:read');
    const [data, autos, prices, { plans, shown }, nowRates, status, settings] = await Promise.all([
      this.repo.load(ctx.workspaceId, month),
      this.repo.autos(ctx.workspaceId),
      this.prices.latest(),
      this.plansFrom(ctx, month),
      this.rates.tableForDate(today()),
      this.prices.status(),
      this.planner.forViewer(ctx.userId).settings(ctx.workspaceId),
    ]);
    const base = settings.baseCurrency;
    const view: View = { data, autos, prices, base, rates: nowRates.table, month, shown, plans };
    const pots = data.pots.map((pot) => toPotDto(pot, view));
    const live = pots.filter((p) => !p.archived);
    // «Не учитывать в общем»: such funds count in the month, not in the totals.
    const counted = live.filter((p) => !p.excludeFromTotal);
    const sumBase = (pick: (pot: PotDto) => string | null, list = counted) =>
      list.reduce((sum, p) => {
        const value = pick(p);
        return value === null
          ? sum
          : sum + (convert(toMinor(value), p.currency, base, nowRates.table) ?? 0n);
      }, 0n);
    return {
      month,
      baseCurrency: base,
      pots,
      total: money(sumBase((p) => p.balance)),
      owed: money(sumBase((p) => p.owed)),
      savingsTarget: shown.total,
      deposited: money(sumBase((p) => p.deposited, live)),
      withdrawn: money(sumBase((p) => p.withdrawn, live)),
      distributed: money(toMinor(shown.total) - toMinor(shown.unallocated)),
      unallocated: shown.unallocated,
      prices: status,
      plan: shown,
    };
  }

  /** Every movement of a fund, newest first (the card shows only the month). */
  async history(ctx: ServiceContext, potId: string): Promise<MovementDto[]> {
    requireScope(ctx, 'savings:read');
    const pot = await this.repo.pot(ctx.workspaceId, potId);
    const [parts, movements] = await Promise.all([
      this.repo.parts(ctx.workspaceId, potId),
      this.repo.movementsOf(ctx.workspaceId, { potId }),
    ]);
    const month = currentMonth();
    return movements.map((m) =>
      toMovementDto(
        m,
        parts.find((p) => p.id === m.subaccount_id)?.currency ?? pot.currency,
        month,
      ),
    );
  }

  /**
   * What the household has, each thing counted once: accounts (fund money on them is a part of
   * their balance, shown as reserved), fund money kept outside accounts, investments. Warnings are
   * codes with parameters, translated by the client.
   */
  async wealth(ctx: ServiceContext, month: string): Promise<WealthDto> {
    const [overview, accounts, members, nowRates] = await Promise.all([
      this.overview(ctx, month),
      this.accounts.list(ctx.workspaceId),
      this.members.list(ctx.workspaceId),
      this.rates.tableForDate(today()),
    ]);
    const base = overview.baseCurrency;
    const missing = new Set<string>();
    const inBase = (amount: bigint, currency: string) => {
      const value = convert(amount, currency, base, nowRates.table);
      if (value === null) missing.add(currency);
      return value ?? 0n;
    };
    type Sums = { accounts: bigint; reserved: bigint; investments: bigint; outside: bigint };
    const empty = (): Sums => ({ accounts: 0n, reserved: 0n, investments: 0n, outside: 0n });
    const owners = new Map<string | null, Sums>();
    const owner = (id: string | null) => {
      const key = id !== null && members.some((m) => m.id === id) ? id : null;
      let entry = owners.get(key);
      if (!entry) owners.set(key, (entry = empty()));
      return entry;
    };
    const warnings: WealthDto['warnings'] = [];
    const live: AccountDto[] = accounts.filter((a) => !a.archived);
    for (const a of live) {
      owner(a.ownerId).accounts += inBase(toMinor(a.balance), a.currency);
      if (toMinor(a.available) < 0n)
        warnings.push({
          code: 'ACCOUNT_OVER_RESERVED',
          params: { account: a.name, amount: money(-toMinor(a.available)), currency: a.currency },
        });
    }
    const pots = overview.pots.filter((p) => !p.archived);
    for (const pot of pots) {
      if (pot.kind === 'PORTFOLIO') {
        owner(pot.ownerId).investments += inBase(toMinor(pot.balance), pot.currency);
        if (pot.positions.some((p) => p.value === null)) missing.add(pot.name);
        continue;
      }
      for (const part of pot.subaccounts.filter((s) => !s.archived)) {
        const amount = inBase(toMinor(part.balance), part.currency);
        const entry = owner(part.ownerId ?? pot.ownerId);
        if (part.accountId && live.some((a) => a.id === part.accountId)) entry.reserved += amount;
        else entry.outside += amount;
      }
    }
    const sum = (pick: (e: Sums) => bigint) =>
      [...owners.values()].reduce((s, e) => s + pick(e), 0n);
    const ownerDtos: WealthOwnerDto[] = [
      ...members
        .filter((m) => !m.archived || owners.has(m.id))
        .map((m) => ({ id: m.id as string | null, name: m.name, color: m.color })),
      // The joint owner has no name of its own: the client shows «Совместные» in its language.
      { id: null, name: '', color: JOINT_COLOR },
    ].map(({ id, name, color }) => {
      const e = owners.get(id) ?? empty();
      return {
        ownerId: id,
        name,
        color,
        accounts: money(e.accounts),
        reserved: money(e.reserved),
        investments: money(e.investments),
        outside: money(e.outside),
        total: money(e.accounts + e.investments + e.outside),
      };
    });
    const accountsTotal = sum((e) => e.accounts);
    const reserved = sum((e) => e.reserved);
    return {
      month,
      baseCurrency: base,
      capital: money(accountsTotal + sum((e) => e.outside) + sum((e) => e.investments)),
      accounts: money(accountsTotal),
      reserved: money(reserved),
      free: money(accountsTotal - reserved),
      outside: money(sum((e) => e.outside)),
      investments: money(sum((e) => e.investments)),
      owners: ownerDtos,
      goals: pots
        .filter((p) => p.kind === 'CASH')
        .map((p) => ({
          potId: p.id,
          name: p.name,
          icon: p.icon,
          color: p.color,
          currency: p.currency,
          balance: p.balance,
          target: p.target,
          progress: p.progress,
          targetDate: p.targetDate,
          planned: p.planned,
          deposited: p.deposited,
          forecastMonth: p.forecastMonth,
        })),
      warnings,
      missingRates: [...missing],
    };
  }

  /** Current balances of active funds (for scenario forecasts). */
  async fundBalances(workspaceId: string) {
    const [data, nowRates] = await Promise.all([
      this.repo.load(workspaceId, currentMonth()),
      this.rates.tableForDate(today()),
    ]);
    const rates = nowRates.table;
    return data.pots
      .filter((p) => p.kind === 'CASH' && !p.archived_at)
      .map((p) => ({
        potId: p.id,
        name: p.name,
        color: p.color,
        currency: p.currency,
        target: p.target_minor === null ? null : BigInt(p.target_minor),
        /** A part's amount in this fund's currency. */
        inFund: (amount: bigint, currency: string) =>
          convert(amount, currency, p.currency, rates) ?? 0n,
        balance: data.parts
          .filter((s) => s.pot_id === p.id && !s.archived_at)
          .reduce(
            (sum, s) =>
              sum +
              (convert(
                balanceOf(
                  s.opening_minor,
                  data.movements.filter((m) => m.subaccount_id === s.id),
                ),
                s.currency,
                p.currency,
                rates,
              ) ?? 0n),
            0n,
          ),
      }));
  }
}
