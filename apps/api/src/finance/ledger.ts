import {
  LEDGER_CATEGORIES,
  SYSTEM_CATEGORIES,
  type LedgerCategoryKey,
  type SystemOperationKind,
  type SystemOperationParams,
} from '@homehub/shared';
import { notFound, unprocessable } from '../lib/http-error';

/**
 * The one writer of operations (`transactions`) that other modules create: fund money, account
 * top-ups, reconciliations and the facts of planned lines. It returns prepared statements instead
 * of running them, so the caller puts the operation into the same `d1.batch` as its own rows: the
 * batch is one transaction, and a failure leaves nothing half-written.
 */

const CATEGORY_DEFINITIONS = [...SYSTEM_CATEGORIES, ...LEDGER_CATEGORIES];

/** Signed balance of one account from its operations, as SQL (binds: workspace, account). */
export const ACCOUNT_BALANCE_SQL = `(SELECT a.initial_balance_minor + COALESCE((
    SELECT SUM(CASE
      WHEN t.account_id = a.id AND t.type = 'INCOME' THEN t.amount_minor
      WHEN t.account_id = a.id THEN -t.amount_minor
      ELSE 0 END
      + CASE WHEN t.to_account_id = a.id THEN COALESCE(t.to_amount_minor, 0) ELSE 0 END)
    FROM transactions t WHERE t.workspace_id = a.workspace_id
      AND (t.account_id = a.id OR t.to_account_id = a.id)), 0)
  FROM accounts a WHERE a.workspace_id = ? AND a.id = ?)`;

/** Who stands as the author of an automatic operation: the first member of the household. */
const HOUSEHOLD_USER_SQL =
  '(SELECT user_id FROM workspace_members WHERE workspace_id = ? ORDER BY created_at LIMIT 1)';

export interface Movement {
  workspaceId: string;
  /** The acting user; null for automatic operations (the household's first member). */
  userId: string | null;
  accountId: string;
  currency: string;
  category: LedgerCategoryKey;
  amountMinor: bigint | number;
  date: string;
  kind: SystemOperationKind;
  params?: SystemOperationParams;
  /** The user's own note; the client shows the kind's text when it is empty. */
  note?: string;
  id?: string;
}

export interface Transfer {
  workspaceId: string;
  userId: string | null;
  fromAccountId: string;
  toAccountId: string;
  currency: string;
  amountMinor: bigint | number;
  date: string;
  kind: SystemOperationKind;
  params?: SystemOperationParams;
  note?: string;
  id?: string;
}

export interface Fact {
  workspaceId: string;
  userId: string;
  accountId: string;
  currency: string;
  /** A finance category key from SYSTEM_CATEGORIES. */
  categoryKey: string;
  type: 'INCOME' | 'EXPENSE';
  amountMinor: bigint | number;
  date: string;
  description: string;
  payerId: string | null;
  plannerCategory: string | null;
  link: FactLink;
  itemId: string;
  month: string;
  id?: string;
}

export type FactLink = 'recurring' | 'purchase' | 'income';
const LINK_COLUMN: Record<FactLink, string> = {
  recurring: 'recurring_expense_id',
  purchase: 'purchase_id',
  income: 'income_source_id',
};

export interface Written {
  id: string;
  statements: D1PreparedStatement[];
}

export class Ledger {
  constructor(private readonly d1: D1Database) {}

  /** The system category row, created on first use (idempotent; part of the caller's batch). */
  ensureCategory(workspaceId: string, key: string): D1PreparedStatement {
    const definition = CATEGORY_DEFINITIONS.find((c) => c.key === key);
    if (!definition) throw new Error(`Unknown system category ${key}`);
    return this.d1
      .prepare(
        `INSERT INTO categories (id, workspace_id, system_key, name, kind, color, is_system, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7) ON CONFLICT (workspace_id, system_key) DO NOTHING`,
      )
      .bind(
        crypto.randomUUID(),
        workspaceId,
        key,
        definition.name,
        definition.kind,
        definition.color,
        Date.now(),
      );
  }

  /**
   * Money arriving on or leaving one account without being income or spending of the plan
   * (`is_adjustment`): fund deposits and withdrawals, top-ups, reconciliations.
   */
  movement(move: Movement): Written {
    const id = move.id ?? crypto.randomUUID();
    const kind = CATEGORY_DEFINITIONS.find((c) => c.key === move.category)?.kind;
    const now = Date.now();
    return {
      id,
      statements: [
        this.ensureCategory(move.workspaceId, move.category),
        this.d1
          .prepare(
            `INSERT INTO transactions (id, workspace_id, account_id, category_id, created_by_id, type,
               amount_minor, currency, description, occurred_at, is_adjustment, system_kind,
               system_params, created_at, updated_at)
             VALUES (?, ?, ?, (SELECT id FROM categories WHERE workspace_id = ? AND system_key = ?),
               COALESCE(?, ${HOUSEHOLD_USER_SQL}), ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            move.workspaceId,
            move.accountId,
            move.workspaceId,
            move.category,
            move.userId,
            move.workspaceId,
            kind,
            Number(move.amountMinor),
            move.currency,
            move.note ?? '',
            move.date,
            move.kind,
            move.params ? JSON.stringify(move.params) : null,
            now,
            now,
          ),
      ],
    };
  }

  /** Money moved between two accounts of the same currency. */
  transfer(transfer: Transfer): Written {
    const id = transfer.id ?? crypto.randomUUID();
    const now = Date.now();
    const amount = Number(transfer.amountMinor);
    return {
      id,
      statements: [
        this.d1
          .prepare(
            `INSERT INTO transactions (id, workspace_id, account_id, to_account_id, created_by_id, type,
               amount_minor, currency, to_amount_minor, to_currency, description, occurred_at,
               system_kind, system_params, created_at, updated_at)
             VALUES (?, ?, ?, ?, COALESCE(?, ${HOUSEHOLD_USER_SQL}), 'TRANSFER', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            transfer.workspaceId,
            transfer.fromAccountId,
            transfer.toAccountId,
            transfer.userId,
            transfer.workspaceId,
            amount,
            transfer.currency,
            amount,
            transfer.currency,
            transfer.note ?? '',
            transfer.date,
            transfer.kind,
            transfer.params ? JSON.stringify(transfer.params) : null,
            now,
            now,
          ),
      ],
    };
  }

  /**
   * The fact of a planned line for a month: replaces an earlier one (one operation per line and
   * month). The amount is in the account's currency — what really left or reached the account.
   */
  fact(fact: Fact): Written {
    const id = fact.id ?? crypto.randomUUID();
    const now = Date.now();
    return {
      id,
      statements: [
        this.ensureCategory(fact.workspaceId, fact.categoryKey),
        this.removeFact(fact.workspaceId, fact.link, fact.itemId, fact.month),
        this.d1
          .prepare(
            `INSERT INTO transactions (id, workspace_id, account_id, category_id, created_by_id, type,
               amount_minor, currency, description, occurred_at, payer_id, planner_category,
               ${LINK_COLUMN[fact.link]}, plan_month, created_at, updated_at)
             VALUES (?, ?, ?, (SELECT id FROM categories WHERE workspace_id = ? AND system_key = ?),
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            fact.workspaceId,
            fact.accountId,
            fact.workspaceId,
            fact.categoryKey,
            fact.userId,
            fact.type,
            Number(fact.amountMinor),
            fact.currency,
            fact.description,
            fact.date,
            fact.payerId,
            fact.plannerCategory,
            fact.itemId,
            fact.month,
            now,
            now,
          ),
      ],
    };
  }

  /** Removes the fact of a line (of one month, or of every month). */
  removeFact(
    workspaceId: string,
    link: FactLink,
    itemId: string,
    month?: string,
  ): D1PreparedStatement {
    return this.d1
      .prepare(
        `DELETE FROM transactions WHERE workspace_id = ? AND ${LINK_COLUMN[link]} = ?
           ${month ? 'AND plan_month = ?' : ''}`,
      )
      .bind(workspaceId, itemId, ...(month ? [month] : []));
  }

  /** Removes operations by id (within the workspace). */
  remove(workspaceId: string, ids: string[]): D1PreparedStatement[] {
    return ids.map((id) =>
      this.d1
        .prepare('DELETE FROM transactions WHERE id = ? AND workspace_id = ?')
        .bind(id, workspaceId),
    );
  }

  /** A new amount (and date) of an operation; a transfer gets the same amount on both sides. */
  setAmount(workspaceId: string, id: string, amountMinor: bigint | number, date?: string) {
    return this.d1
      .prepare(
        `UPDATE transactions SET amount_minor = ?1,
           to_amount_minor = CASE WHEN type = 'TRANSFER' THEN ?1 ELSE to_amount_minor END,
           occurred_at = COALESCE(?2, occurred_at), updated_at = ?3
         WHERE id = ?4 AND workspace_id = ?5`,
      )
      .bind(Number(amountMinor), date ?? null, Date.now(), id, workspaceId);
  }

  /**
   * Moves operations from one account to another: their own side for incomes and expenses, the
   * receiving side for transfers (a transfer from the new account itself stays as it is).
   */
  moveToAccount(
    workspaceId: string,
    ids: string[],
    from: string,
    to: string,
  ): D1PreparedStatement[] {
    const list = JSON.stringify(ids);
    const now = Date.now();
    return [
      this.d1
        .prepare(
          `UPDATE transactions SET account_id = ?1, updated_at = ?3
           WHERE account_id = ?2 AND workspace_id = ?4 AND type <> 'TRANSFER'
             AND id IN (SELECT value FROM json_each(?5))`,
        )
        .bind(to, from, now, workspaceId, list),
      this.d1
        .prepare(
          `UPDATE transactions SET to_account_id = ?1, updated_at = ?3
           WHERE to_account_id = ?2 AND workspace_id = ?4 AND type = 'TRANSFER' AND account_id <> ?1
             AND id IN (SELECT value FROM json_each(?5))`,
        )
        .bind(to, from, now, workspaceId, list),
    ];
  }

  /**
   * Removes an operation unless `keep` holds — for an operation written in the same batch that
   * turned out not to be needed (a parallel request linked its own first).
   */
  removeUnless(workspaceId: string, id: string, keep: { sql: string; params: unknown[] }) {
    return this.d1
      .prepare(`DELETE FROM transactions WHERE id = ? AND workspace_id = ? AND NOT (${keep.sql})`)
      .bind(id, workspaceId, ...keep.params);
  }

  /** An account that can receive a new operation: this household's and not archived. */
  async usableAccount(workspaceId: string, id: string) {
    const row = await this.d1
      .prepare(
        'SELECT id, currency, owner_id, archived_at FROM accounts WHERE id = ? AND workspace_id = ?',
      )
      .bind(id, workspaceId)
      .first<{
        id: string;
        currency: string;
        owner_id: string | null;
        archived_at: number | null;
      }>();
    if (!row) throw notFound('FINANCE_ACCOUNT_NOT_FOUND');
    if (row.archived_at) throw unprocessable('FINANCE_ACCOUNT_ARCHIVED');
    return row;
  }

  /** Whether an operation with this id exists now (after the batch). */
  async exists(workspaceId: string, id: string): Promise<boolean> {
    const row = await this.d1
      .prepare('SELECT 1 FROM transactions WHERE id = ? AND workspace_id = ?')
      .bind(id, workspaceId)
      .first();
    return row !== null;
  }
}
