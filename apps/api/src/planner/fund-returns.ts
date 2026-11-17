/**
 * The planner side of a fund withdrawal to be returned: a required one-month regular payment
 * («Вернуть в …») in the month of the return, ticked off when the money is back. The planner owns
 * these rows; the savings module asks for the statements and puts them into its own batch.
 */
export interface ReturnLine {
  workspaceId: string;
  expenseId: string;
  name: string;
  currency: string;
  month: string;
  amountMinor: bigint | number;
  note: string;
  ownerId: string | null;
}

export class FundReturnLines {
  constructor(private readonly d1: D1Database) {}

  create(line: ReturnLine): D1PreparedStatement[] {
    const now = Date.now();
    return [
      this.d1
        .prepare(
          `INSERT INTO recurring_expenses (id, workspace_id, name, is_required, category, currency,
             interval_months, start_month, end_month, note, owner_id, sort_order, created_at, updated_at)
           VALUES (?1, ?2, ?3, 1, 'OTHER', ?4, 1, ?5, ?5, ?6, ?7,
             (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM recurring_expenses WHERE workspace_id = ?2),
             ?8, ?8)`,
        )
        .bind(
          line.expenseId,
          line.workspaceId,
          line.name,
          line.currency,
          line.month,
          line.note,
          line.ownerId,
          now,
        ),
      this.d1
        .prepare(
          `INSERT INTO recurring_amounts (workspace_id, expense_id, effective_month, amount_minor)
           VALUES (?1, ?2, ?3, ?4)`,
        )
        .bind(line.workspaceId, line.expenseId, line.month, Number(line.amountMinor)),
    ];
  }

  /** The return now owes `amountMinor` (its withdrawal was corrected). */
  setAmount(workspaceId: string, expenseId: string, amountMinor: bigint | number) {
    return this.d1
      .prepare(
        'UPDATE recurring_amounts SET amount_minor = ?1 WHERE expense_id = ?2 AND workspace_id = ?3',
      )
      .bind(Number(amountMinor), expenseId, workspaceId);
  }

  /** Moves a return still due to another month; its payment marks start over. */
  move(workspaceId: string, expenseId: string, month: string): D1PreparedStatement[] {
    return [
      this.d1
        .prepare(
          `UPDATE recurring_expenses SET start_month = ?1, end_month = ?1, version = version + 1,
             updated_at = ?2 WHERE id = ?3 AND workspace_id = ?4`,
        )
        .bind(month, Date.now(), expenseId, workspaceId),
      this.d1
        .prepare(
          'UPDATE recurring_amounts SET effective_month = ?1 WHERE expense_id = ?2 AND workspace_id = ?3',
        )
        .bind(month, expenseId, workspaceId),
      this.d1
        .prepare('DELETE FROM recurring_overrides WHERE expense_id = ? AND workspace_id = ?')
        .bind(expenseId, workspaceId),
      this.d1
        .prepare('DELETE FROM recurring_payments WHERE expense_id = ? AND workspace_id = ?')
        .bind(expenseId, workspaceId),
    ];
  }

  remove(workspaceId: string, expenseId: string): D1PreparedStatement {
    return this.d1
      .prepare('DELETE FROM recurring_expenses WHERE id = ? AND workspace_id = ?')
      .bind(expenseId, workspaceId);
  }

  /** Ticks the payment of a month off (or back on). */
  setPaid(workspaceId: string, expenseId: string, month: string, paid: boolean) {
    return this.d1
      .prepare(
        `INSERT INTO recurring_payments (workspace_id, expense_id, month, paid, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (expense_id, month) DO UPDATE SET paid = ?4, updated_at = ?5`,
      )
      .bind(workspaceId, expenseId, month, paid ? 1 : 0, Date.now());
  }
}

/**
 * What happens to money when a fund return is ticked off in the planner: the savings module puts
 * it back on its account. Injected into the planner, so the planner does not import savings.
 */
export interface ReturnMoney {
  statements(
    workspaceId: string,
    expenseId: string,
    paid: boolean,
    userId: string | null,
  ): Promise<D1PreparedStatement[]>;
}
