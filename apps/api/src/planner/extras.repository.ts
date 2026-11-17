import type { FundPart, FundPlanInput, FundRule } from './fund-plan';

/** An income or expense operation, the fact side of a month plan. */
export interface FactRow {
  id: string;
  type: 'INCOME' | 'EXPENSE';
  amountMinor: number;
  currency: string;
  occurredAt: string;
  accountId: string;
  payerId: string | null;
  plannerCategory: string | null;
  recurringExpenseId: string | null;
  purchaseId: string | null;
  incomeSourceId: string | null;
  /** The plan month it counts in: the linked line's month, else the month it happened. */
  month: string;
}

/** What the month budget needs besides the planner tables: facts and fund plans. */
export interface PlanExtras {
  facts: FactRow[];
  /** Regular expenses that are «Вернуть в …» of a fund withdrawal. */
  fundReturnIds: Set<string>;
  funds: FundPlanInput;
  /** Active members in their order; own shares of joint lines; the default split. */
  members: string[];
  shares: Map<string, { memberId: string; shareBp: number }[]>;
  jointSplit: 'EQUAL' | 'INCOME';
}

export const EMPTY_EXTRAS: PlanExtras = {
  facts: [],
  fundReturnIds: new Set(),
  funds: {
    parts: [],
    overrides: new Map(),
    deposits: new Map(),
    minFreeMinor: 0,
    remainderMode: false,
  },
  members: [],
  shares: new Map(),
  jointSplit: 'EQUAL',
};

/** Raw D1 reads, one batch: facts of the period, fund parts with their rules, deposits. */
export class ExtrasRepository {
  constructor(private readonly d1: D1Database) {}

  async load(workspaceId: string, from: string, to: string): Promise<PlanExtras> {
    const [facts, returns, parts, rules, overrides, deposits, settings, members, shares] =
      await this.d1.batch([
        this.d1
          .prepare(
            `SELECT id, type, amount_minor, currency, occurred_at, account_id, payer_id, planner_category,
             recurring_expense_id, purchase_id, income_source_id,
             COALESCE(plan_month, substr(occurred_at, 1, 7)) AS month
           FROM transactions
           WHERE workspace_id = ?1 AND type IN ('INCOME', 'EXPENSE') AND is_adjustment = 0
             AND COALESCE(plan_month, substr(occurred_at, 1, 7)) BETWEEN ?2 AND ?3`,
          )
          .bind(workspaceId, from, to),
        this.d1
          .prepare(
            `SELECT DISTINCT repay_expense_id AS id FROM savings_movements
           WHERE workspace_id = ? AND repay_expense_id IS NOT NULL`,
          )
          .bind(workspaceId),
        this.d1
          .prepare(
            `SELECT s.id, s.pot_id, p.name AS pot_name, p.priority, s.name, s.owner_id,
             COALESCE(s.color, p.color) AS color, COALESCE(s.currency, p.currency) AS currency
           FROM fund_subaccounts s JOIN savings_pots p ON p.id = s.pot_id
           WHERE s.workspace_id = ? AND s.archived_at IS NULL AND p.archived_at IS NULL AND p.kind = 'CASH'
           ORDER BY p.priority, p.created_at, s.sort_order, s.created_at`,
          )
          .bind(workspaceId),
        this.d1
          .prepare(
            `SELECT subaccount_id, mode, amount_minor, percent_bp, percent_base, min_minor, max_minor,
             priority, start_month, end_month FROM fund_rules WHERE workspace_id = ?`,
          )
          .bind(workspaceId),
        this.d1
          .prepare(
            `SELECT subaccount_id, month, amount_minor FROM fund_plan_overrides
           WHERE workspace_id = ?1 AND month BETWEEN ?2 AND ?3`,
          )
          .bind(workspaceId, from, to),
        this.d1
          .prepare(
            `SELECT subaccount_id, substr(occurred_on, 1, 7) AS month,
             SUM(CASE WHEN type = 'DEPOSIT' THEN amount_minor ELSE 0 END) AS amount,
             SUM(CASE WHEN type = 'DEPOSIT' THEN amount_minor ELSE -amount_minor END) AS net_amount
           FROM savings_movements
           WHERE workspace_id = ?1 AND subaccount_id IS NOT NULL
             AND substr(occurred_on, 1, 7) BETWEEN ?2 AND ?3
           GROUP BY subaccount_id, substr(occurred_on, 1, 7)`,
          )
          .bind(workspaceId, from, to),
        this.d1
          .prepare(
            'SELECT min_free_minor, joint_split, savings_mode FROM planner_settings WHERE workspace_id = ?',
          )
          .bind(workspaceId),
        this.d1
          .prepare(
            'SELECT id FROM members WHERE workspace_id = ? AND archived_at IS NULL ORDER BY sort_order, created_at',
          )
          .bind(workspaceId),
        this.d1
          .prepare('SELECT item_id, member_id, share_bp FROM item_shares WHERE workspace_id = ?')
          .bind(workspaceId),
      ]);
    type Row = Record<string, unknown>;
    const rows = (result: D1Result | undefined) => (result?.results ?? []) as Row[];
    const ruleOf = new Map<string, FundRule>(
      rows(rules).map((r) => [
        r.subaccount_id as string,
        {
          mode: r.mode as FundRule['mode'],
          amountMinor: r.amount_minor as number | null,
          percentBp: r.percent_bp as number | null,
          percentBase: r.percent_base as FundRule['percentBase'],
          minMinor: r.min_minor as number | null,
          maxMinor: r.max_minor as number | null,
          priority: r.priority as number,
          startMonth: r.start_month as string,
          endMonth: r.end_month as string | null,
        },
      ]),
    );
    return {
      facts: rows(facts).map((r) => ({
        id: r.id as string,
        type: r.type as FactRow['type'],
        amountMinor: r.amount_minor as number,
        currency: r.currency as string,
        occurredAt: r.occurred_at as string,
        accountId: r.account_id as string,
        payerId: r.payer_id as string | null,
        plannerCategory: r.planner_category as string | null,
        recurringExpenseId: r.recurring_expense_id as string | null,
        purchaseId: r.purchase_id as string | null,
        incomeSourceId: r.income_source_id as string | null,
        month: r.month as string,
      })),
      fundReturnIds: new Set(rows(returns).map((r) => r.id as string)),
      funds: {
        parts: rows(parts).map((r): FundPart => ({
          subaccountId: r.id as string,
          potId: r.pot_id as string,
          potName: r.pot_name as string,
          potPriority: r.priority as number,
          name: r.name as string,
          ownerId: r.owner_id as string | null,
          color: r.color as string | null,
          currency: r.currency as FundPart['currency'],
          rule: ruleOf.get(r.id as string) ?? null,
        })),
        overrides: new Map(
          rows(overrides).map((r) => [`${r.subaccount_id}:${r.month}`, r.amount_minor as number]),
        ),
        deposits: new Map(
          rows(deposits).map((r) => [`${r.subaccount_id}:${r.month}`, Number(r.amount)]),
        ),
        netDeposits: new Map(
          rows(deposits).map((r) => [`${r.subaccount_id}:${r.month}`, Number(r.net_amount)]),
        ),
        minFreeMinor: Number(rows(settings)[0]?.min_free_minor ?? 0),
        remainderMode: rows(settings)[0]?.savings_mode === 'REMAINDER',
      },
      members: rows(members).map((r) => r.id as string),
      shares: rows(shares).reduce((map, r) => {
        const list = map.get(r.item_id as string) ?? [];
        list.push({ memberId: r.member_id as string, shareBp: r.share_bp as number });
        return map.set(r.item_id as string, list);
      }, new Map<string, { memberId: string; shareBp: number }[]>()),
      jointSplit: rows(settings)[0]?.joint_split === 'INCOME' ? 'INCOME' : 'EQUAL',
    };
  }
}
