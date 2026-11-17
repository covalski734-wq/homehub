import {
  type scenarioMonthSchema,
  shiftMonth,
  type MonthBudgetDto,
  type scenarioUpdateSchema,
  type ScenarioDto,
  type ScenarioKind,
  type ScenariosDto,
} from '@homehub/shared';
import type { z } from 'zod';
import { formatMinor, toMinor } from '../lib/money';
import { bpToPercent, divRound } from '../planner/calculations';
import type { PlannerService } from '../planner/planner.service';
import type { SavingsQueries } from './savings.queries';

/** Defaults until the household sets its own: −15 % income / +10 % expenses and the reverse. */
const DEFAULTS: Record<'PESSIMISTIC' | 'OPTIMISTIC', { incomeBp: number; expenseBp: number }> = {
  PESSIMISTIC: { incomeBp: -1500, expenseBp: 1000 },
  OPTIMISTIC: { incomeBp: 1500, expenseBp: -500 },
};

const signedBp = (value: string) => Math.round(Number(value) * 100);
const signedPercent = (bp: number) => (bp < 0 ? `-${bpToPercent(-bp)}` : bpToPercent(bp));
const scale = (amount: number, bp: number) =>
  Number(divRound(BigInt(amount) * BigInt(10_000 + bp), 10_000n));

/**
 * Pessimistic / base / optimistic: the same plan with incomes and expenses changed by a percentage.
 * Fund plans are recalculated from the changed money (percentages and the free remainder follow
 * the income), so the forecast shows what each scenario allows to save and when goals are met.
 */
export class ScenariosService {
  constructor(
    private readonly d1: D1Database,
    private readonly planner: PlannerService,
    private readonly savings: SavingsQueries,
  ) {}

  /** Forecasts in the display currency of one member (a new instance, nothing shared is changed). */
  forViewer(userId: string): ScenariosService {
    return new ScenariosService(this.d1, this.planner.forViewer(userId), this.savings);
  }

  private async settings(workspaceId: string) {
    const rows = await this.d1
      .prepare('SELECT kind, income_bp, expense_bp FROM planner_scenarios WHERE workspace_id = ?')
      .bind(workspaceId)
      .all<{ kind: 'PESSIMISTIC' | 'OPTIMISTIC'; income_bp: number; expense_bp: number }>();
    const stored = new Map(
      rows.results.map((r) => [r.kind, { incomeBp: r.income_bp, expenseBp: r.expense_bp }]),
    );
    return {
      PESSIMISTIC: stored.get('PESSIMISTIC') ?? DEFAULTS.PESSIMISTIC,
      BASE: { incomeBp: 0, expenseBp: 0 },
      OPTIMISTIC: stored.get('OPTIMISTIC') ?? DEFAULTS.OPTIMISTIC,
    } satisfies Record<ScenarioKind, { incomeBp: number; expenseBp: number }>;
  }

  async update(workspaceId: string, input: z.output<typeof scenarioUpdateSchema>) {
    await this.d1
      .prepare(
        `INSERT INTO planner_scenarios (workspace_id, kind, income_bp, expense_bp, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (workspace_id, kind) DO UPDATE SET income_bp = ?3, expense_bp = ?4, updated_at = ?5`,
      )
      .bind(workspaceId, input.kind, signedBp(input.income), signedBp(input.expenses), Date.now())
      .run();
  }

  async compute(workspaceId: string, from: string, count: number): Promise<ScenariosDto> {
    const [settings, funds, monthRows] = await Promise.all([
      this.settings(workspaceId),
      this.savings.fundBalances(workspaceId),
      this.d1
        .prepare(
          'SELECT kind, month, income_bp, expense_bp FROM scenario_months WHERE workspace_id = ?',
        )
        .bind(workspaceId)
        .all<{ kind: ScenarioKind; month: string; income_bp: number; expense_bp: number }>(),
    ]);
    const overrides = new Map<ScenarioKind, Map<string, { incomeBp: number; expenseBp: number }>>();
    for (const r of monthRows.results) {
      const map = overrides.get(r.kind) ?? new Map();
      map.set(r.month, { incomeBp: r.income_bp, expenseBp: r.expense_bp });
      overrides.set(r.kind, map);
    }
    let baseCurrency: ScenariosDto['baseCurrency'] = 'PLN';
    const scenarios: ScenarioDto[] = [];
    for (const kind of ['PESSIMISTIC', 'BASE', 'OPTIMISTIC'] as const) {
      const { incomeBp, expenseBp } = settings[kind];
      // Months with their own percentages are built from their own scaled snapshot.
      const own = overrides.get(kind) ?? new Map<string, { incomeBp: number; expenseBp: number }>();
      const factorOf = (month: string) => own.get(month) ?? { incomeBp, expenseBp };
      const periodMonths = Array.from({ length: count }, (_, i) => shiftMonth(from, i));
      const groups = new Map<string, { incomeBp: number; expenseBp: number }>();
      for (const m of periodMonths) {
        const fct = factorOf(m);
        groups.set(`${fct.incomeBp}:${fct.expenseBp}`, fct);
      }
      const byMonth = new Map<string, MonthBudgetDto>();
      for (const [key, fct] of groups) {
        const built = await this.scaled(workspaceId, from, count, fct.incomeBp, fct.expenseBp);
        for (const b of built)
          if (`${factorOf(b.month).incomeBp}:${factorOf(b.month).expenseBp}` === key)
            byMonth.set(b.month, b);
      }
      const budgets = periodMonths.map((m) => byMonth.get(m)!);
      baseCurrency = budgets[0]?.baseCurrency ?? baseCurrency;
      const running = new Map(funds.map((f) => [f.potId, f.balance]));
      const reach = new Map<string, string>();
      for (const f of funds)
        if (f.target !== null && f.balance >= f.target) reach.set(f.potId, from);
      let income = 0n;
      let expenses = 0n;
      let saved = 0n;
      let deficit = 0n;
      const months = budgets.map((b) => {
        for (const line of b.savingsPlan.lines) {
          const left = toMinor(line.planned) - toMinor(line.deposited);
          const fund = funds.find((f) => f.potId === line.potId);
          if (left > 0n && fund)
            running.set(
              line.potId,
              (running.get(line.potId) ?? 0n) + fund.inFund(left, line.currency),
            );
        }
        for (const f of funds)
          if (f.target !== null && !reach.has(f.potId) && (running.get(f.potId) ?? 0n) >= f.target)
            reach.set(f.potId, b.month);
        const spent = toMinor(b.totals.recurring) + toMinor(b.totals.purchases);
        const free = toMinor(b.totals.free);
        const short = free < 0n ? -free : 0n;
        income += toMinor(b.totals.netIncome);
        expenses += spent;
        saved += toMinor(b.totals.savingsTarget);
        deficit += short;
        const fct = factorOf(b.month);
        return {
          month: b.month,
          incomePercent: signedPercent(fct.incomeBp),
          expensesPercent: signedPercent(fct.expenseBp),
          custom: own.has(b.month),
          netIncome: b.totals.netIncome,
          expenses: formatMinor(spent),
          savings: b.totals.savingsTarget,
          free: b.totals.free,
          deficit: formatMinor(short),
        };
      });
      scenarios.push({
        kind,
        income: signedPercent(incomeBp),
        expenses: signedPercent(expenseBp),
        months,
        totals: {
          netIncome: formatMinor(income),
          expenses: formatMinor(expenses),
          savings: formatMinor(saved),
          deficit: formatMinor(deficit),
        },
        funds: funds.map((f) => ({
          potId: f.potId,
          name: f.name,
          color: f.color,
          currency: f.currency,
          target: f.target === null ? null : formatMinor(f.target),
          balance: formatMinor(f.balance),
          projected: formatMinor(running.get(f.potId) ?? f.balance),
          reachMonth: reach.get(f.potId) ?? null,
        })),
      });
    }
    return { baseCurrency, from, scenarios };
  }

  /** Budgets of the period with incomes and expenses changed by the given percentages. */
  private scaled(
    workspaceId: string,
    from: string,
    count: number,
    incomeBp: number,
    expenseBp: number,
  ) {
    return this.planner.budgetsFor(workspaceId, from, count, (snapshot) => {
      if (incomeBp) {
        for (const row of snapshot.incomeAmounts)
          row.amountMinor = scale(row.amountMinor, incomeBp);
        for (const row of snapshot.incomeOverrides)
          if (row.amountMinor !== null) row.amountMinor = scale(row.amountMinor, incomeBp);
      }
      if (expenseBp) {
        for (const row of snapshot.recurringAmounts)
          row.amountMinor = scale(row.amountMinor, expenseBp);
        for (const row of snapshot.recurringOverrides)
          if (row.amountMinor !== null) row.amountMinor = scale(row.amountMinor, expenseBp);
        for (const row of snapshot.purchases) {
          if (row.status === 'ACTIVE')
            row.estimatedAmountMinor = scale(row.estimatedAmountMinor, expenseBp);
        }
      }
    });
  }

  async setMonth(workspaceId: string, input: z.output<typeof scenarioMonthSchema>) {
    if (input.income === null || input.expenses === null)
      await this.d1
        .prepare('DELETE FROM scenario_months WHERE workspace_id = ? AND kind = ? AND month = ?')
        .bind(workspaceId, input.kind, input.month)
        .run();
    else
      await this.d1
        .prepare(
          `INSERT INTO scenario_months (workspace_id, kind, month, income_bp, expense_bp, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT (workspace_id, kind, month) DO UPDATE SET income_bp = ?4, expense_bp = ?5, updated_at = ?6`,
        )
        .bind(
          workspaceId,
          input.kind,
          input.month,
          signedBp(input.income),
          signedBp(input.expenses),
          Date.now(),
        )
        .run();
  }
}
