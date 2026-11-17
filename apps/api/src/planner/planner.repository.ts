import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { DEFAULT_DASHBOARD_LAYOUT } from '@homehub/shared';
import type { Db } from '../db/client';
import { EMPTY_EXTRAS, type PlanExtras } from './extras.repository';
import {
  incomeAmounts,
  incomeDeductions,
  incomeOverrides,
  incomeSources,
  monthPlans,
  plannerSettings,
  purchases,
  recurringAmounts,
  recurringExpenses,
  recurringOverrides,
  recurringPayments,
  userPreferences,
} from '../db/planner-schema';

export type IncomeSourceRow = typeof incomeSources.$inferSelect;
export type DeductionRow = typeof incomeDeductions.$inferSelect;
export type RecurringRow = typeof recurringExpenses.$inferSelect;
export type PurchaseRow = typeof purchases.$inferSelect;
export type AmountRow = { itemId: string; effectiveMonth: string; amountMinor: number };
export type OverrideRow = {
  itemId: string;
  month: string;
  amountMinor: number | null;
  skipped: boolean;
};

export interface PlannerSnapshot {
  settings: { baseCurrency: 'PLN' | 'EUR'; defaultSavingsRateBp: number };
  monthPlans: Map<string, number>;
  incomes: IncomeSourceRow[];
  incomeAmounts: AmountRow[];
  incomeOverrides: OverrideRow[];
  deductions: DeductionRow[];
  recurring: RecurringRow[];
  recurringAmounts: AmountRow[];
  recurringOverrides: OverrideRow[];
  recurringPayments: { expenseId: string; month: string; paid: boolean }[];
  purchases: PurchaseRow[];
  /** Facts and fund plans, loaded by the service (empty when not needed). */
  extras: PlanExtras;
}

export const DEFAULT_SETTINGS = { baseCurrency: 'PLN' as const, defaultSavingsRateBp: 2000 };

export class PlannerRepository {
  constructor(private readonly db: Db) {}

  /**
   * Everything needed to compute budgets for [from, to], as one D1 batch (one consistent
   * snapshot). Only single-table selects: drizzle maps batched JOIN rows incorrectly.
   */
  async snapshot(workspaceId: string, from: string, to: string): Promise<PlannerSnapshot> {
    const ws = workspaceId;
    const [
      settings,
      plans,
      incomes,
      incAmounts,
      incOverrides,
      deductions,
      recurring,
      recAmounts,
      recOverrides,
      purchaseRows,
      payments,
    ] = await this.db.batch([
      this.db.select().from(plannerSettings).where(eq(plannerSettings.workspaceId, ws)),
      this.db
        .select()
        .from(monthPlans)
        .where(
          and(
            eq(monthPlans.workspaceId, ws),
            gte(monthPlans.month, from),
            lte(monthPlans.month, to),
          ),
        ),
      this.db
        .select()
        .from(incomeSources)
        .where(eq(incomeSources.workspaceId, ws))
        .orderBy(asc(incomeSources.sortOrder), asc(incomeSources.createdAt)),
      this.db
        .select({
          itemId: incomeAmounts.incomeId,
          effectiveMonth: incomeAmounts.effectiveMonth,
          amountMinor: incomeAmounts.amountMinor,
        })
        .from(incomeAmounts)
        .where(eq(incomeAmounts.workspaceId, ws)),
      this.db
        .select({
          itemId: incomeOverrides.incomeId,
          month: incomeOverrides.month,
          amountMinor: incomeOverrides.amountMinor,
          skipped: incomeOverrides.skipped,
        })
        .from(incomeOverrides)
        .where(
          and(
            eq(incomeOverrides.workspaceId, ws),
            gte(incomeOverrides.month, from),
            lte(incomeOverrides.month, to),
          ),
        ),
      this.db
        .select()
        .from(incomeDeductions)
        .where(eq(incomeDeductions.workspaceId, ws))
        .orderBy(asc(incomeDeductions.sortOrder), asc(incomeDeductions.createdAt)),
      this.db
        .select()
        .from(recurringExpenses)
        .where(eq(recurringExpenses.workspaceId, ws))
        .orderBy(asc(recurringExpenses.sortOrder), asc(recurringExpenses.createdAt)),
      this.db
        .select({
          itemId: recurringAmounts.expenseId,
          effectiveMonth: recurringAmounts.effectiveMonth,
          amountMinor: recurringAmounts.amountMinor,
        })
        .from(recurringAmounts)
        .where(eq(recurringAmounts.workspaceId, ws)),
      this.db
        .select({
          itemId: recurringOverrides.expenseId,
          month: recurringOverrides.month,
          amountMinor: recurringOverrides.amountMinor,
          skipped: recurringOverrides.skipped,
        })
        .from(recurringOverrides)
        .where(
          and(
            eq(recurringOverrides.workspaceId, ws),
            gte(recurringOverrides.month, from),
            lte(recurringOverrides.month, to),
          ),
        ),
      this.db
        .select()
        .from(purchases)
        .where(
          and(
            eq(purchases.workspaceId, ws),
            or(
              and(gte(purchases.plannedMonth, from), lte(purchases.plannedMonth, to)),
              and(
                isNull(purchases.plannedMonth),
                isNotNull(purchases.purchasedOn),
                sql`substr(${purchases.purchasedOn}, 1, 7) BETWEEN ${from} AND ${to}`,
              ),
            ),
          ),
        )
        .orderBy(asc(purchases.plannedMonth), asc(purchases.createdAt)),
      this.db
        .select()
        .from(recurringPayments)
        .where(
          and(
            eq(recurringPayments.workspaceId, ws),
            gte(recurringPayments.month, from),
            lte(recurringPayments.month, to),
          ),
        ),
    ]);

    return {
      settings: settings[0] ?? DEFAULT_SETTINGS,
      monthPlans: new Map(plans.map((plan) => [plan.month, plan.savingsRateBp])),
      incomes,
      incomeAmounts: incAmounts,
      incomeOverrides: incOverrides,
      deductions,
      recurring,
      recurringAmounts: recAmounts,
      recurringOverrides: recOverrides,
      recurringPayments: payments,
      purchases: purchaseRows,
      extras: EMPTY_EXTRAS,
    };
  }

  async settings(workspaceId: string) {
    const [row] = await this.db
      .select()
      .from(plannerSettings)
      .where(eq(plannerSettings.workspaceId, workspaceId));
    return row ?? DEFAULT_SETTINGS;
  }

  /** Earliest month any plan refers to (drives how far back exchange rates are needed). */
  async earliestMonth(workspaceId: string): Promise<string | null> {
    const row = await this.db.get<{ month: string | null }>(sql`
      SELECT MIN(m) AS month FROM (
        SELECT MIN(start_month) AS m FROM income_sources WHERE workspace_id = ${workspaceId}
        UNION ALL SELECT MIN(start_month) FROM recurring_expenses WHERE workspace_id = ${workspaceId}
        UNION ALL SELECT MIN(planned_month) FROM purchases WHERE workspace_id = ${workspaceId}
      )`);
    return row?.month ?? null;
  }

  /** Earliest planner month across all workspaces (for the shared rates backfill). */
  async earliestMonthOverall(): Promise<string | null> {
    const row = await this.db.get<{ month: string | null }>(sql`
      SELECT MIN(m) AS month FROM (
        SELECT MIN(start_month) AS m FROM income_sources
        UNION ALL SELECT MIN(start_month) FROM recurring_expenses
        UNION ALL SELECT MIN(planned_month) FROM purchases
      )`);
    return row?.month ?? null;
  }

  /**
   * Changing the default savings rate must not rewrite past budgets: months before `currentMonth`
   * that relied on the old default get it frozen into an explicit month plan, in the same batch.
   */
  async updateSettings(
    workspaceId: string,
    changes: { baseCurrency?: 'PLN' | 'EUR'; defaultSavingsRateBp?: number },
    freezeMonths: string[],
    previousRateBp: number,
  ): Promise<void> {
    const now = new Date();
    const freeze = freezeMonths.map((month) =>
      this.db
        .insert(monthPlans)
        .values({ workspaceId, month, savingsRateBp: previousRateBp, updatedAt: now })
        .onConflictDoNothing(),
    );
    const upsert = this.db
      .insert(plannerSettings)
      .values({ ...DEFAULT_SETTINGS, ...changes, workspaceId, updatedAt: now })
      .onConflictDoUpdate({
        target: plannerSettings.workspaceId,
        set: { ...changes, updatedAt: now },
      });
    await this.db.batch([upsert, ...freeze]);
  }

  async setMonthRate(workspaceId: string, month: string, rateBp: number | null): Promise<void> {
    if (rateBp === null) {
      await this.db
        .delete(monthPlans)
        .where(and(eq(monthPlans.workspaceId, workspaceId), eq(monthPlans.month, month)));
      return;
    }
    const now = new Date();
    await this.db
      .insert(monthPlans)
      .values({ workspaceId, month, savingsRateBp: rateBp, updatedAt: now })
      .onConflictDoUpdate({
        target: [monthPlans.workspaceId, monthPlans.month],
        set: { savingsRateBp: rateBp, updatedAt: now },
      });
  }

  async layout(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ layout: userPreferences.dashboardLayout })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    return row?.layout ?? null;
  }

  async saveLayout(userId: string, layout: string): Promise<void> {
    const now = new Date();
    await this.db
      .insert(userPreferences)
      .values({ userId, dashboardLayout: layout, updatedAt: now })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { dashboardLayout: layout, updatedAt: now },
      });
  }

  async userCurrency(userId: string): Promise<'PLN' | 'EUR' | null> {
    const [row] = await this.db
      .select({ currency: userPreferences.baseCurrency })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    return row?.currency ?? null;
  }

  /** The row may not exist yet: a new one starts with the default dashboard layout. */
  async setUserCurrency(userId: string, currency: 'PLN' | 'EUR'): Promise<void> {
    const now = new Date();
    await this.db
      .insert(userPreferences)
      .values({
        userId,
        dashboardLayout: JSON.stringify(DEFAULT_DASHBOARD_LAYOUT),
        baseCurrency: currency,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { baseCurrency: currency, updatedAt: now },
      });
  }

  async purchasesByIds(workspaceId: string, ids: string[]) {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(purchases)
      .where(and(eq(purchases.workspaceId, workspaceId), inArray(purchases.id, ids)));
  }
}
