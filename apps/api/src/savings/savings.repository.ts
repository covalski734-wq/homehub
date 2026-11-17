import type { FundRuleDto, PlannerCurrency } from '@homehub/shared';
import { notFound } from '../lib/http-error';

/**
 * Reads of the savings tables and the SQL fragments writers share. Every query is filtered by
 * workspace; writers in this module build their statements themselves so a whole change goes
 * into one `d1.batch`.
 */

export interface PotRow {
  id: string;
  name: string;
  kind: 'CASH' | 'PORTFOLIO';
  currency: PlannerCurrency;
  archived_at: number | null;
  owner_id: string | null;
  target_minor: number | null;
  target_date: string | null;
  priority: number;
  icon: string | null;
  color: string | null;
  description: string;
  note: string;
  exclude_from_total: number;
}

export interface PartRow {
  id: string;
  pot_id: string;
  name: string;
  owner_id: string | null;
  color: string | null;
  account_id: string | null;
  /** Its own currency (the fund's for parts made before migration 0021). */
  currency: PlannerCurrency;
  opening_minor: number;
  note: string;
  archived_at: number | null;
}

export interface RuleRow {
  subaccount_id: string;
  mode: FundRuleDto['mode'];
  amount_minor: number | null;
  percent_bp: number | null;
  percent_base: FundRuleDto['percentBase'];
  min_minor: number | null;
  max_minor: number | null;
  priority: number;
  start_month: string;
  end_month: string | null;
}

export interface PositionRow {
  id: string;
  pot_id: string;
  asset: string;
  symbol: string;
  name: string;
  image: string | null;
  quantity: string;
  avg_price_micros: number | null;
  updated_at: number;
}

export interface MovementRow {
  id: string;
  pot_id: string;
  subaccount_id: string | null;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amount_minor: number;
  occurred_on: string;
  note: string;
  repay_month: string | null;
  repay_expense_id: string | null;
  transaction_id: string | null;
  return_transaction_id: string | null;
  auto_rule_id: string | null;
  created_at: number;
  /** The planner payment of the return is ticked off in its month. */
  returned: number;
}

export interface AutoRuleRow {
  id: string;
  subaccount_id: string;
  pot_id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  day: number;
  start_month: string;
  end_month: string | null;
  note: string;
  account_id: string | null;
  currency: string;
  pot_name: string;
}

export interface AutoAmountRow {
  rule_id: string;
  month: string;
  one_month: number;
  amount_minor: number;
}

export type SavingsData = Awaited<ReturnType<SavingsRepository['load']>>;
export type AutosData = Awaited<ReturnType<SavingsRepository['autos']>>;

const SELECT_POT = `SELECT id, name, kind, currency, archived_at, owner_id, target_minor, target_date,
  priority, icon, color, description, note, exclude_from_total FROM savings_pots`;

const SELECT_PART = `SELECT s.id, s.pot_id, s.name, s.owner_id, s.color, s.account_id,
  COALESCE(s.currency, p.currency) AS currency, s.opening_minor, s.note, s.archived_at
  FROM fund_subaccounts s JOIN savings_pots p ON p.id = s.pot_id AND p.workspace_id = s.workspace_id`;

const SELECT_MOVEMENT = `SELECT m.id, m.pot_id, m.subaccount_id, m.type, m.amount_minor, m.occurred_on,
  m.note, m.repay_month, m.repay_expense_id, m.transaction_id, m.return_transaction_id,
  m.auto_rule_id, m.created_at,
  EXISTS (SELECT 1 FROM recurring_payments p WHERE p.expense_id = m.repay_expense_id
    AND p.month = m.repay_month AND p.paid = 1 AND p.workspace_id = m.workspace_id) AS returned
  FROM savings_movements m`;

/**
 * A part's balance as SQL: opening + deposits − withdrawals + returned withdrawals. Binds: part
 * id, workspace id. Used both for reads and as the condition of a withdrawal, so a check and its
 * write see the same number inside one batch.
 */
export const PART_BALANCE_SQL = `(SELECT s.opening_minor + COALESCE((
    SELECT SUM(CASE WHEN m.type = 'DEPOSIT' THEN m.amount_minor
      ELSE -m.amount_minor + CASE WHEN EXISTS (
        SELECT 1 FROM recurring_payments p WHERE p.expense_id = m.repay_expense_id
          AND p.month = m.repay_month AND p.paid = 1) THEN m.amount_minor ELSE 0 END END)
    FROM savings_movements m WHERE m.subaccount_id = s.id AND m.workspace_id = s.workspace_id), 0)
  FROM fund_subaccounts s WHERE s.id = ? AND s.workspace_id = ?)`;

export const isOpen = (m: MovementRow) =>
  m.type === 'WITHDRAWAL' && m.repay_month !== null && m.repay_expense_id !== null && !m.returned;

/** Opening balance plus deposits, minus withdrawals, plus the returned withdrawals. */
export function balanceOf(opening: number, movements: MovementRow[]): bigint {
  return movements.reduce((sum, m) => {
    const amount = BigInt(m.amount_minor);
    if (m.type === 'DEPOSIT') return sum + amount;
    return sum - amount + (m.returned ? amount : 0n);
  }, BigInt(opening));
}

const rows = <T>(r: D1Result | undefined) => (r?.results ?? []) as unknown as T[];

export class SavingsRepository {
  constructor(private readonly d1: D1Database) {}

  /** Everything the overview of a month needs, in one round trip. */
  async load(workspaceId: string, month: string) {
    const [pots, parts, rules, overrides, positions, movements] = await this.d1.batch([
      this.d1
        .prepare(
          `${SELECT_POT} WHERE workspace_id = ? ORDER BY archived_at IS NOT NULL, kind, priority, created_at`,
        )
        .bind(workspaceId),
      this.d1
        .prepare(`${SELECT_PART} WHERE s.workspace_id = ? ORDER BY s.sort_order, s.created_at`)
        .bind(workspaceId),
      this.d1
        .prepare(
          `SELECT subaccount_id, mode, amount_minor, percent_bp, percent_base, min_minor, max_minor,
             priority, start_month, end_month FROM fund_rules WHERE workspace_id = ?`,
        )
        .bind(workspaceId),
      this.d1
        .prepare(
          'SELECT subaccount_id FROM fund_plan_overrides WHERE workspace_id = ? AND month = ?',
        )
        .bind(workspaceId, month),
      this.d1
        .prepare(
          `SELECT id, pot_id, asset, symbol, name, image, quantity, avg_price_micros, updated_at
           FROM savings_positions WHERE workspace_id = ? ORDER BY created_at`,
        )
        .bind(workspaceId),
      this.d1
        .prepare(
          `${SELECT_MOVEMENT} WHERE m.workspace_id = ? ORDER BY m.occurred_on DESC, m.created_at DESC`,
        )
        .bind(workspaceId),
    ]);
    return {
      pots: rows<PotRow>(pots),
      parts: rows<PartRow>(parts),
      rules: new Map(rows<RuleRow>(rules).map((r) => [r.subaccount_id, r])),
      overridden: new Set(rows<{ subaccount_id: string }>(overrides).map((r) => r.subaccount_id)),
      positions: rows<PositionRow>(positions),
      movements: rows<MovementRow>(movements),
    };
  }

  /** Automatic operations with their amounts and the months already made. */
  async autos(workspaceId: string) {
    const [rules, amounts, done] = await this.d1.batch([
      this.d1
        .prepare(
          `SELECT r.id, r.subaccount_id, s.pot_id, r.type, r.day, r.start_month, r.end_month, r.note,
             s.account_id, COALESCE(s.currency, p.currency) AS currency, p.name AS pot_name
           FROM fund_auto_rules r
           JOIN fund_subaccounts s ON s.id = r.subaccount_id AND s.workspace_id = r.workspace_id
           JOIN savings_pots p ON p.id = s.pot_id AND p.workspace_id = r.workspace_id
           WHERE r.workspace_id = ? AND s.archived_at IS NULL AND p.archived_at IS NULL ORDER BY r.created_at`,
        )
        .bind(workspaceId),
      this.d1
        .prepare(
          'SELECT rule_id, month, one_month, amount_minor FROM fund_auto_amounts WHERE workspace_id = ?',
        )
        .bind(workspaceId),
      this.d1
        .prepare(
          `SELECT auto_rule_id, auto_month FROM savings_movements
           WHERE workspace_id = ? AND auto_rule_id IS NOT NULL`,
        )
        .bind(workspaceId),
    ]);
    return {
      rules: rows<AutoRuleRow>(rules),
      amounts: rows<AutoAmountRow>(amounts),
      done: new Set(
        rows<{ auto_rule_id: string; auto_month: string }>(done).map(
          (r) => `${r.auto_rule_id}:${r.auto_month}`,
        ),
      ),
    };
  }

  async pot(workspaceId: string, id: string): Promise<PotRow> {
    const row = await this.d1
      .prepare(`${SELECT_POT} WHERE id = ? AND workspace_id = ?`)
      .bind(id, workspaceId)
      .first<PotRow>();
    if (!row) throw notFound('SAVINGS_POT_NOT_FOUND');
    return row;
  }

  async part(workspaceId: string, id: string): Promise<PartRow> {
    const row = await this.d1
      .prepare(`${SELECT_PART} WHERE s.id = ? AND s.workspace_id = ?`)
      .bind(id, workspaceId)
      .first<PartRow>();
    if (!row) throw notFound('SAVINGS_PART_NOT_FOUND');
    return row;
  }

  async parts(workspaceId: string, potId: string): Promise<PartRow[]> {
    const result = await this.d1
      .prepare(`${SELECT_PART} WHERE s.pot_id = ? AND s.workspace_id = ? ORDER BY s.sort_order`)
      .bind(potId, workspaceId)
      .all<PartRow>();
    return result.results;
  }

  async movement(workspaceId: string, id: string): Promise<MovementRow> {
    const row = await this.d1
      .prepare(`${SELECT_MOVEMENT} WHERE m.id = ? AND m.workspace_id = ?`)
      .bind(id, workspaceId)
      .first<MovementRow>();
    if (!row) throw notFound('SAVINGS_MOVEMENT_NOT_FOUND');
    return row;
  }

  async movementsOf(workspaceId: string, filter: { potId?: string; partId?: string }) {
    const column = filter.partId ? 'm.subaccount_id' : 'm.pot_id';
    const result = await this.d1
      .prepare(
        `${SELECT_MOVEMENT} WHERE ${column} = ? AND m.workspace_id = ?
         ORDER BY m.occurred_on DESC, m.created_at DESC`,
      )
      .bind(filter.partId ?? filter.potId ?? '', workspaceId)
      .all<MovementRow>();
    return result.results;
  }

  async partBalance(workspaceId: string, partId: string): Promise<bigint> {
    const row = await this.d1
      .prepare(`SELECT ${PART_BALANCE_SQL} AS balance`)
      .bind(partId, workspaceId)
      .first<{ balance: number | null }>();
    return BigInt(row?.balance ?? 0);
  }

  async hasMovements(workspaceId: string, filter: { potId?: string; partId?: string }) {
    const column = filter.partId ? 'subaccount_id' : 'pot_id';
    const row = await this.d1
      .prepare(`SELECT 1 FROM savings_movements WHERE ${column} = ? AND workspace_id = ? LIMIT 1`)
      .bind(filter.partId ?? filter.potId ?? '', workspaceId)
      .first();
    return row !== null;
  }

  /** An account usable for a fund part or a deposit (this household's). */
  async account(workspaceId: string, id: string) {
    return this.d1
      .prepare(
        'SELECT id, name, currency, archived_at FROM accounts WHERE id = ? AND workspace_id = ?',
      )
      .bind(id, workspaceId)
      .first<{ id: string; name: string; currency: string; archived_at: number | null }>();
  }

  async autoRule(workspaceId: string, id: string) {
    const row = await this.d1
      .prepare(
        'SELECT id, subaccount_id, type, day FROM fund_auto_rules WHERE id = ? AND workspace_id = ?',
      )
      .bind(id, workspaceId)
      .first<{ id: string; subaccount_id: string; type: 'DEPOSIT' | 'WITHDRAWAL'; day: number }>();
    if (!row) throw notFound('SAVINGS_AUTO_NOT_FOUND');
    return row;
  }

  async position(workspaceId: string, id: string) {
    const row = await this.d1
      .prepare(
        'SELECT quantity, avg_price_micros, updated_at FROM savings_positions WHERE id = ? AND workspace_id = ?',
      )
      .bind(id, workspaceId)
      .first<{ quantity: string; avg_price_micros: number | null; updated_at: number }>();
    if (!row) throw notFound('SAVINGS_POSITION_NOT_FOUND');
    return row;
  }

  async positionOf(workspaceId: string, potId: string, asset: string) {
    return this.d1
      .prepare(
        `SELECT id, quantity, avg_price_micros, updated_at FROM savings_positions
         WHERE pot_id = ? AND asset = ? AND workspace_id = ?`,
      )
      .bind(potId, asset, workspaceId)
      .first<{
        id: string;
        quantity: string;
        avg_price_micros: number | null;
        updated_at: number;
      }>();
  }
}
