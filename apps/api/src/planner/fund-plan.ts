import type {
  NoticeDto,
  FundRuleMode,
  PercentBase,
  PlannerCurrency,
  SavingsPlanDto,
  SavingsPlanLineDto,
} from '@homehub/shared';
import { formatMinor } from '../lib/money';
import { convert, isInPeriod, percentOf, type RateTable } from './calculations';

/**
 * Monthly contributions to fund parts. Order of the money, all in the display currency:
 *
 *   free before savings = net income − regular payments − purchases
 *   1. one-month overrides, FIXED and PERCENT rules take their amounts (limits applied);
 *   2. what is left above `minFree` goes to REMAINDER rules by priority (each up to its max);
 *   3. a negative rest is the deficit — nothing is invented to cover it.
 *
 * A pool is spent once: a remainder rule never sees money another one already took.
 */

export interface FundRule {
  mode: FundRuleMode;
  amountMinor: number | null;
  percentBp: number | null;
  percentBase: PercentBase | null;
  minMinor: number | null;
  maxMinor: number | null;
  priority: number;
  startMonth: string;
  endMonth: string | null;
}

export interface FundPart {
  subaccountId: string;
  potId: string;
  potName: string;
  potPriority: number;
  name: string;
  ownerId: string | null;
  color: string | null;
  currency: PlannerCurrency;
  rule: FundRule | null;
}

export interface FundPlanInput {
  parts: FundPart[];
  /** `${subaccountId}:${month}` → amount in the fund currency. */
  overrides: Map<string, number>;
  /** `${subaccountId}:${month}` → deposited that month, fund currency. */
  deposits: Map<string, number>;
  /** Deposits minus withdrawals in the month; opening balances never enter the month budget. */
  netDeposits?: Map<string, number>;
  minFreeMinor: number;
  /** All money left above minFree is savings: what no fund takes stays «не распределено». */
  remainderMode: boolean;
}

export interface FundPlanContext {
  month: string;
  base: string;
  rates: RateTable;
  netIncome: bigint;
  /** Net income by owner (null key — joint incomes). */
  netByOwner: Map<string | null, bigint>;
  freeBeforeSavings: bigint;
}

export const ruleActive = (rule: FundRule | null, month: string): rule is FundRule =>
  rule !== null && isInPeriod(month, rule.startMonth, rule.endMonth);

function clamp(value: bigint, min: number | null, max: number | null): bigint {
  let result = value < 0n ? 0n : value;
  if (min !== null && result < BigInt(min)) result = BigInt(min);
  if (max !== null && result > BigInt(max)) result = BigInt(max);
  return result;
}

interface Planned {
  part: FundPart;
  mode: SavingsPlanLineDto['mode'];
  amount: bigint;
  base: bigint | null;
  limited: boolean;
}

/** The plan of one month; null when no part has a rule or an override (the savings rate applies). */
export function planFunds(input: FundPlanInput, ctx: FundPlanContext): SavingsPlanDto | null {
  const { month, base, rates } = ctx;
  const toBase = (amount: bigint, currency: string) => convert(amount, currency, base, rates);
  const fromBase = (amount: bigint, currency: string) => convert(amount, base, currency, rates);
  const key = (part: FundPart) => `${part.subaccountId}:${month}`;
  const deposited = (part: FundPart) =>
    BigInt(Math.max(0, (input.netDeposits ?? input.deposits).get(key(part)) ?? 0));
  const atLeastDeposited = (part: FundPart, amount: bigint) =>
    amount > deposited(part) ? amount : deposited(part);
  const live = input.parts.filter(
    (part) =>
      input.overrides.has(key(part)) || ruleActive(part.rule, month) || deposited(part) > 0n,
  );
  if (live.length === 0 && !input.remainderMode) return null;

  const warnings: NoticeDto[] = [];
  const planned: Planned[] = [];
  const remainder: FundPart[] = [];
  for (const part of live) {
    const override = input.overrides.get(key(part));
    if (override !== undefined) {
      const amount = atLeastDeposited(part, BigInt(override));
      planned.push({
        part,
        mode: 'OVERRIDE',
        amount,
        base: toBase(amount, part.currency),
        limited: false,
      });
      continue;
    }
    if (!ruleActive(part.rule, month)) {
      const amount = deposited(part);
      planned.push({
        part,
        mode: 'DEPOSIT',
        amount,
        base: toBase(amount, part.currency),
        limited: false,
      });
      continue;
    }
    const rule = part.rule;
    if (rule.mode === 'FIXED') {
      const amount = atLeastDeposited(
        part,
        clamp(BigInt(rule.amountMinor ?? 0), rule.minMinor, rule.maxMinor),
      );
      planned.push({
        part,
        mode: 'FIXED',
        amount,
        base: toBase(amount, part.currency),
        limited: false,
      });
    } else if (rule.mode === 'PERCENT') {
      const from =
        rule.percentBase === 'OWNER_INCOME'
          ? (ctx.netByOwner.get(part.ownerId) ?? 0n)
          : rule.percentBase === 'FREE'
            ? ctx.freeBeforeSavings
            : ctx.netIncome;
      const inBase = percentOf(from > 0n ? from : 0n, rule.percentBp ?? 0);
      const inCurrency = fromBase(inBase, part.currency);
      if (inCurrency === null) {
        warnings.push({
          code: 'MISSING_RATE',
          params: { currency: part.currency, fund: part.potName, part: part.name },
        });
        planned.push({ part, mode: 'PERCENT', amount: 0n, base: null, limited: true });
        continue;
      }
      const amount = atLeastDeposited(part, clamp(inCurrency, rule.minMinor, rule.maxMinor));
      planned.push({
        part,
        mode: 'PERCENT',
        amount,
        base: toBase(amount, part.currency),
        limited: false,
      });
    } else remainder.push(part);
  }

  // Reserve every existing deposit before any remainder rule consumes the shared pool.
  const taken =
    planned.reduce((sum, p) => sum + (p.base ?? 0n), 0n) +
    remainder.reduce((sum, part) => sum + (toBase(deposited(part), part.currency) ?? 0n), 0n);
  let pool = ctx.freeBeforeSavings - taken - BigInt(input.minFreeMinor);
  remainder.sort(
    (a, b) =>
      a.rule!.priority - b.rule!.priority ||
      a.potPriority - b.potPriority ||
      a.potName.localeCompare(b.potName) ||
      a.name.localeCompare(b.name),
  );
  for (const part of remainder) {
    const rule = part.rule!;
    const available = pool > 0n ? fromBase(pool, part.currency) : 0n;
    if (available === null) {
      warnings.push({
        code: 'MISSING_RATE',
        params: { currency: part.currency, fund: part.potName, part: part.name },
      });
      planned.push({ part, mode: 'REMAINDER', amount: 0n, base: null, limited: true });
      continue;
    }
    const saved = deposited(part);
    const savedBase = toBase(saved, part.currency) ?? 0n;
    let amount = available + saved;
    let limited = false;
    if (rule.maxMinor !== null && amount > BigInt(rule.maxMinor)) amount = BigInt(rule.maxMinor);
    amount = atLeastDeposited(part, amount);
    if (rule.minMinor !== null && amount < BigInt(rule.minMinor)) limited = true;
    const inBase = toBase(amount, part.currency) ?? 0n;
    // Rounding through two currencies never takes more than the pool has.
    const extra = inBase - savedBase;
    const spent = extra > pool && pool > 0n ? pool : extra;
    pool -= spent;
    planned.push({ part, mode: 'REMAINDER', amount, base: savedBase + spent, limited });
  }

  const unallocated = input.remainderMode && pool > 0n ? pool : 0n;
  const total = planned.reduce((sum, p) => sum + (p.base ?? 0n), 0n) + unallocated;
  const rest = ctx.freeBeforeSavings - total;
  const deficit = rest < 0n ? -rest : 0n;
  if (ctx.freeBeforeSavings < 0n)
    warnings.push({
      code: 'REQUIRED_OVER_INCOME',
      params: { amount: formatMinor(-ctx.freeBeforeSavings), currency: base },
    });
  if (deficit > 0n) {
    const optional = planned
      .filter((p) => p.mode !== 'REMAINDER' && p.amount > 0n)
      .map((p) => `«${p.part.potName} · ${p.part.name}»`);
    const amount = { amount: formatMinor(deficit), currency: base };
    warnings.push(
      optional.length
        ? { code: 'PLAN_OVER_MONEY_REDUCE', params: { ...amount, parts: optional.join(', ') } }
        : { code: 'PLAN_OVER_MONEY', params: amount },
    );
  }
  for (const p of planned)
    if (
      p.base === null &&
      !warnings.some((w) => w.code === 'MISSING_RATE' && w.params?.part === p.part.name)
    )
      warnings.push({
        code: 'MISSING_RATE',
        params: { currency: p.part.currency, fund: p.part.potName, part: p.part.name },
      });
  for (const p of planned)
    if (p.limited && p.mode === 'REMAINDER' && p.part.rule?.minMinor !== null)
      warnings.push({
        code: 'PART_BELOW_MINIMUM',
        params: { fund: p.part.potName, part: p.part.name },
      });

  const order = new Map(input.parts.map((part, index) => [part.subaccountId, index]));
  planned.sort((a, b) => order.get(a.part.subaccountId)! - order.get(b.part.subaccountId)!);
  return {
    source: 'FUNDS',
    lines: planned.map((p) => ({
      subaccountId: p.part.subaccountId,
      potId: p.part.potId,
      potName: p.part.potName,
      name: p.part.name,
      ownerId: p.part.ownerId,
      color: p.part.color,
      currency: p.part.currency,
      mode: p.mode,
      planned: formatMinor(p.amount),
      plannedBase: p.base === null ? null : formatMinor(p.base),
      deposited: formatMinor(input.deposits.get(key(p.part)) ?? 0),
      limited: p.limited || (p.mode !== 'REMAINDER' && deficit > 0n),
    })),
    total: formatMinor(total),
    unallocated: formatMinor(unallocated),
    freeBeforeSavings: formatMinor(ctx.freeBeforeSavings),
    deficit: formatMinor(deficit),
    warnings,
  };
}
