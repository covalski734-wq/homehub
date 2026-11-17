import {
  serverText,
  type SubaccountDto,
  type movementCreateSchema,
  type movementUpdateSchema,
} from '@homehub/shared';
import type { z } from 'zod';
import type { Ledger } from '../finance/ledger';
import { guard, guardedBatch } from '../lib/batch-guard';
import { dayOfMonth, currentMonth, today } from '../lib/dates';
import { conflict, unprocessable } from '../lib/http-error';
import { userLanguage } from '../lib/language';
import { formatMinor, toMinor } from '../lib/money';
import { requireScope, type ServiceContext } from '../lib/service-context';
import type { FundReturnLines, ReturnMoney } from '../planner/fund-returns';
import {
  isOpen,
  PART_BALANCE_SQL,
  type PartRow,
  type SavingsRepository,
} from './savings.repository';

type Out<T extends z.ZodType> = z.output<T>;

/**
 * Money of fund parts: deposits, withdrawals and their returns. A part kept on a real account is a
 * reservation of that account's money, so a deposit of new money or a withdrawal that leaves the
 * account also writes an account operation (through the ledger), and a deposit from another
 * account is a transfer. Each change is one batch: the movement never exists without its operation.
 */
export class MovementsService implements ReturnMoney {
  constructor(
    private readonly d1: D1Database,
    private readonly repo: SavingsRepository,
    private readonly ledger: Ledger,
    private readonly returns: FundReturnLines,
  ) {}

  private notEnough = async (workspaceId: string, part: PartRow) =>
    unprocessable('SAVINGS_PART_NOT_ENOUGH', {
      name: part.name,
      amount: formatMinor(await this.repo.partBalance(workspaceId, part.id)),
      currency: part.currency,
    });

  /**
   * A deposit or a withdrawal of a fund part. A withdrawal never takes more than the part holds
   * — checked in the same transaction that writes it, so two parallel withdrawals cannot both
   * pass. A withdrawal with `repayMonth` creates the planner payment «Вернуть в …» for that month.
   */
  async confirmPlan(ctx: ServiceContext, potId: string, part: SubaccountDto, month: string) {
    if (part.autoRules.some((r) => r.type === 'DEPOSIT' && !r.done && toMinor(r.amount) > 0n))
      throw conflict('VERSION_CONFLICT');
    const left = toMinor(part.planned) - toMinor(part.deposited);
    if (left <= 0n) return;
    return this.add(
      ctx,
      potId,
      {
        type: 'DEPOSIT',
        subaccountId: part.id,
        amount: formatMinor(left),
        date: month === currentMonth() ? today() : dayOfMonth(month, 1),
        source: 'NEW',
        fromAccountId: null,
        keepOnAccount: false,
        repayMonth: null,
        note: '',
      },
      { month, deposited: part.deposited },
    );
  }

  async add(
    ctx: ServiceContext,
    potId: string,
    input: Out<typeof movementCreateSchema>,
    expectedPlan?: { month: string; deposited: string },
  ): Promise<string> {
    requireScope(ctx, 'savings:write');
    const { workspaceId } = ctx;
    const pot = await this.repo.pot(workspaceId, potId);
    if (pot.archived_at) throw unprocessable('SAVINGS_POT_ARCHIVED');
    if (pot.kind !== 'CASH') throw unprocessable('SAVINGS_NOT_A_FUND');
    const parts = (await this.repo.parts(workspaceId, potId)).filter((s) => !s.archived_at);
    const part = input.subaccountId
      ? parts.find((s) => s.id === input.subaccountId)
      : parts.length === 1
        ? parts[0]
        : undefined;
    if (!part)
      throw unprocessable(
        input.subaccountId ? 'SAVINGS_PART_NOT_FOUND_OR_ARCHIVED' : 'SAVINGS_CHOOSE_PART',
      );
    const amount = toMinor(input.amount);
    const fund = { fund: pot.name };
    const statements: D1PreparedStatement[] = [];
    let transactionId: string | null = null;
    if (expectedPlan)
      statements.push(
        guard(
          this.d1,
          "COALESCE((SELECT SUM(amount_minor) FROM savings_movements WHERE workspace_id = ? AND subaccount_id = ? AND type = 'DEPOSIT' AND substr(occurred_on, 1, 7) = ?), 0) = ?",
          workspaceId,
          part.id,
          expectedPlan.month,
          Number(toMinor(expectedPlan.deposited)),
        ),
      );

    if (input.type === 'WITHDRAWAL')
      statements.push(
        guard(this.d1, `${PART_BALANCE_SQL} >= ?`, part.id, workspaceId, Number(amount)),
      );

    if (part.account_id && input.type === 'DEPOSIT' && input.source === 'NEW') {
      const written = this.ledger.movement({
        workspaceId,
        userId: ctx.userId,
        accountId: part.account_id,
        currency: part.currency,
        category: 'savings-in',
        amountMinor: amount,
        date: input.date,
        kind: 'FUND_DEPOSIT',
        params: fund,
        note: input.note,
      });
      transactionId = written.id;
      statements.push(...written.statements);
    } else if (part.account_id && input.type === 'WITHDRAWAL' && !input.keepOnAccount) {
      const written = this.ledger.movement({
        workspaceId,
        userId: ctx.userId,
        accountId: part.account_id,
        currency: part.currency,
        category: 'savings-out',
        amountMinor: amount,
        date: input.date,
        kind: 'FUND_WITHDRAWAL',
        params: fund,
        note: input.note,
      });
      transactionId = written.id;
      statements.push(...written.statements);
    } else if (
      input.type === 'DEPOSIT' &&
      input.source === 'ACCOUNT' &&
      input.fromAccountId &&
      input.fromAccountId !== part.account_id
    ) {
      if (!part.account_id) throw unprocessable('SAVINGS_PART_WITHOUT_ACCOUNT');
      const from = await this.repo.account(workspaceId, input.fromAccountId);
      if (!from || from.archived_at) throw unprocessable('SAVINGS_SOURCE_ACCOUNT_UNAVAILABLE');
      if (from.currency !== part.currency)
        throw unprocessable('SAVINGS_SOURCE_ACCOUNT_CURRENCY', {
          accountCurrency: from.currency,
          currency: part.currency,
        });
      const written = this.ledger.transfer({
        workspaceId,
        userId: ctx.userId,
        fromAccountId: input.fromAccountId,
        toAccountId: part.account_id,
        currency: part.currency,
        amountMinor: amount,
        date: input.date,
        kind: 'FUND_DEPOSIT',
        params: fund,
      });
      transactionId = written.id;
      statements.push(...written.statements);
    }

    const repayMonth = input.type === 'WITHDRAWAL' ? input.repayMonth : null;
    const expenseId = repayMonth ? crypto.randomUUID() : null;
    if (repayMonth && expenseId)
      statements.push(
        ...this.returns.create({
          workspaceId,
          expenseId,
          // A planner line people may rename: written in the language of who made it.
          name: serverText(await userLanguage(this.d1, ctx.userId), 'fund.returnLine', fund),
          currency: part.currency,
          month: repayMonth,
          amountMinor: amount,
          note: input.note,
          ownerId: part.owner_id,
        }),
      );
    const id = crypto.randomUUID();
    statements.push(
      this.d1
        .prepare(
          `INSERT INTO savings_movements (id, workspace_id, pot_id, subaccount_id, type, amount_minor,
             occurred_on, note, repay_month, repay_expense_id, transaction_id, created_by_id, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
        )
        .bind(
          id,
          workspaceId,
          potId,
          part.id,
          input.type,
          Number(amount),
          input.date,
          input.note,
          repayMonth,
          expenseId,
          transactionId,
          ctx.userId,
          Date.now(),
        ),
    );
    await guardedBatch(this.d1, statements, () =>
      expectedPlan ? conflict('VERSION_CONFLICT') : this.notEnough(workspaceId, part),
    );
    return id;
  }

  /**
   * Corrects a movement in place: amount, date (so its month) and comment. Its account operation
   * and, for a withdrawal to be returned, the planner payment follow. A larger withdrawal must
   * still fit the part's balance.
   */
  async update(ctx: ServiceContext, id: string, input: Out<typeof movementUpdateSchema>) {
    requireScope(ctx, 'savings:write');
    const { workspaceId } = ctx;
    const m = await this.repo.movement(workspaceId, id);
    const amount = input.amount === undefined ? BigInt(m.amount_minor) : toMinor(input.amount);
    const date = input.date ?? m.occurred_on;
    const statements: D1PreparedStatement[] = [];
    const part = m.subaccount_id ? await this.repo.part(workspaceId, m.subaccount_id) : null;
    if (m.type === 'WITHDRAWAL' && part)
      // The balance without this withdrawal must cover the new amount; the movement is unchanged.
      statements.push(
        guard(
          this.d1,
          `${PART_BALANCE_SQL} + ? >= ? AND EXISTS (SELECT 1 FROM savings_movements
             WHERE id = ? AND workspace_id = ? AND amount_minor = ?)`,
          part.id,
          workspaceId,
          m.amount_minor,
          Number(amount),
          id,
          workspaceId,
          m.amount_minor,
        ),
      );
    statements.push(
      this.d1
        .prepare(
          'UPDATE savings_movements SET amount_minor = ?1, occurred_on = ?2, note = ?3 WHERE id = ?4 AND workspace_id = ?5',
        )
        .bind(Number(amount), date, input.note ?? m.note, id, workspaceId),
      ...(m.transaction_id
        ? [this.ledger.setAmount(workspaceId, m.transaction_id, amount, date)]
        : []),
      ...(m.return_transaction_id
        ? [this.ledger.setAmount(workspaceId, m.return_transaction_id, amount)]
        : []),
      ...(m.repay_expense_id
        ? [this.returns.setAmount(workspaceId, m.repay_expense_id, amount)]
        : []),
    );
    await guardedBatch(this.d1, statements, async () =>
      part ? this.notEnough(workspaceId, part) : unprocessable('SAVINGS_MOVEMENT_NOT_FOUND'),
    );
  }

  /** Undoes a movement: its operations, its put-back and its planner payment go with it. */
  async remove(ctx: ServiceContext, id: string) {
    requireScope(ctx, 'savings:write');
    const m = await this.repo.movement(ctx.workspaceId, id);
    await this.d1.batch([
      this.d1
        .prepare('DELETE FROM savings_movements WHERE id = ? AND workspace_id = ?')
        .bind(id, ctx.workspaceId),
      ...(m.repay_expense_id ? [this.returns.remove(ctx.workspaceId, m.repay_expense_id)] : []),
      ...this.ledger.remove(
        ctx.workspaceId,
        [m.transaction_id, m.return_transaction_id].filter((t): t is string => t !== null),
      ),
    ]);
  }

  /** Ticks the planner payment of a return off (or back on), exactly as the planner does. */
  async setReturned(ctx: ServiceContext, id: string, returned: boolean) {
    requireScope(ctx, 'savings:write');
    const m = await this.repo.movement(ctx.workspaceId, id);
    if (!m.repay_month || !m.repay_expense_id) throw unprocessable('SAVINGS_NO_RETURN');
    await this.d1.batch([
      ...(await this.statements(ctx.workspaceId, m.repay_expense_id, returned, ctx.userId)),
      this.returns.setPaid(ctx.workspaceId, m.repay_expense_id, m.repay_month, returned),
    ]);
  }

  /** Moves a return that is still due to another month (e.g. it did not work out this month). */
  async moveReturn(ctx: ServiceContext, id: string, repayMonth: string) {
    requireScope(ctx, 'savings:write');
    const m = await this.repo.movement(ctx.workspaceId, id);
    if (!isOpen(m) || !m.repay_expense_id) throw unprocessable('SAVINGS_RETURN_CLOSED');
    await this.d1.batch([
      ...this.returns.move(ctx.workspaceId, m.repay_expense_id, repayMonth),
      this.d1
        .prepare('UPDATE savings_movements SET repay_month = ? WHERE id = ? AND workspace_id = ?')
        .bind(repayMonth, id, ctx.workspaceId),
    ]);
  }

  /**
   * A fund return ticked off (or back on), from savings or from the planner: when its withdrawal
   * took money off an account, the money is put back there (or the put-back is removed). The
   * statements go into the caller's batch together with the payment mark.
   */
  async statements(
    workspaceId: string,
    expenseId: string,
    paid: boolean,
    userId: string | null,
  ): Promise<D1PreparedStatement[]> {
    const m = await this.d1
      .prepare(
        `SELECT m.id, m.amount_minor, m.return_transaction_id, m.repay_month,
           t.account_id, t.currency, p.name AS pot
         FROM savings_movements m
         LEFT JOIN transactions t ON t.id = m.transaction_id AND t.workspace_id = m.workspace_id
         JOIN savings_pots p ON p.id = m.pot_id AND p.workspace_id = m.workspace_id
         WHERE m.workspace_id = ? AND m.repay_expense_id = ?`,
      )
      .bind(workspaceId, expenseId)
      .first<{
        id: string;
        amount_minor: number;
        return_transaction_id: string | null;
        repay_month: string;
        account_id: string | null;
        currency: string | null;
        pot: string;
      }>();
    if (!m) return [];
    if (!paid)
      return m.return_transaction_id
        ? [
            this.d1
              .prepare(
                'UPDATE savings_movements SET return_transaction_id = NULL WHERE id = ? AND workspace_id = ?',
              )
              .bind(m.id, workspaceId),
            ...this.ledger.remove(workspaceId, [m.return_transaction_id]),
          ]
        : [];
    if (m.return_transaction_id || !m.account_id || !m.currency) return [];
    const now = today();
    const back = this.ledger.movement({
      workspaceId,
      userId,
      accountId: m.account_id,
      currency: m.currency,
      category: 'savings-in',
      amountMinor: m.amount_minor,
      date: now.startsWith(m.repay_month) ? now : `${m.repay_month}-01`,
      kind: 'FUND_RETURN',
      params: { fund: m.pot },
    });
    return [
      ...back.statements,
      // Only once: a second tick (a double click, a parallel request) changes nothing.
      this.d1
        .prepare(
          `UPDATE savings_movements SET return_transaction_id = ?1
           WHERE id = ?2 AND workspace_id = ?3 AND return_transaction_id IS NULL`,
        )
        .bind(back.id, m.id, workspaceId),
      this.ledger.removeUnless(workspaceId, back.id, {
        sql: 'EXISTS (SELECT 1 FROM savings_movements WHERE return_transaction_id = ? AND workspace_id = ?)',
        params: [back.id, workspaceId],
      }),
    ];
  }
}
