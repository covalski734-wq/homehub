/**
 * Fund money set aside on real accounts: per account, the sum of the balances of active fund parts
 * kept there (opening + deposits − withdrawals + returned withdrawals). A part's currency is its
 * fund's and equals its account's, so no conversion is needed.
 */
export async function reservedByAccount(
  d1: D1Database,
  workspaceId: string,
): Promise<Map<string, bigint>> {
  const rows = await d1
    .prepare(
      `SELECT s.account_id,
         SUM(s.opening_minor + COALESCE((
           SELECT SUM(CASE WHEN m.type = 'DEPOSIT' THEN m.amount_minor
             ELSE -m.amount_minor + CASE WHEN EXISTS (
               SELECT 1 FROM recurring_payments p WHERE p.expense_id = m.repay_expense_id
                 AND p.month = m.repay_month AND p.paid = 1) THEN m.amount_minor ELSE 0 END END)
           FROM savings_movements m WHERE m.subaccount_id = s.id AND m.workspace_id = s.workspace_id), 0)) AS reserved
       FROM fund_subaccounts s JOIN savings_pots p ON p.id = s.pot_id
       WHERE s.workspace_id = ? AND s.account_id IS NOT NULL AND s.archived_at IS NULL
         AND p.archived_at IS NULL
       GROUP BY s.account_id`,
    )
    .bind(workspaceId)
    .all<{ account_id: string; reserved: number }>();
  return new Map(rows.results.map((r) => [r.account_id, BigInt(r.reserved ?? 0)]));
}
