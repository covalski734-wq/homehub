import {
  serverText,
  type fundOverrideSchema,
  type fundRuleSchema,
  type potCreateSchema,
  type potUpdateSchema,
  type subaccountCreateSchema,
  type subaccountUpdateSchema,
} from '@homehub/shared';
import type { z } from 'zod';
import type { Ledger } from '../finance/ledger';
import { guard, guardedBatch } from '../lib/batch-guard';
import { today } from '../lib/dates';
import { conflict, unprocessable } from '../lib/http-error';
import { userLanguage } from '../lib/language';
import { toMinor } from '../lib/money';
import { requireScope, type ServiceContext } from '../lib/service-context';
import { archivedAt, partialSet } from '../lib/sql';
import type { MembersService } from '../members/members.service';
import { percentToBp } from '../planner/calculations';
import type { PartRow, SavingsRepository } from './savings.repository';

type Out<T extends z.ZodType> = z.output<T>;
const minor = (value: string | null) => (value === null ? null : Number(toMinor(value)));

/** Sum of a part's movements without the opening (binds: part, workspace). */
const MOVEMENTS_SUM_SQL = `COALESCE((SELECT SUM(CASE WHEN m.type = 'DEPOSIT' THEN m.amount_minor
    ELSE -m.amount_minor + CASE WHEN EXISTS (
      SELECT 1 FROM recurring_payments p WHERE p.expense_id = m.repay_expense_id
        AND p.month = m.repay_month AND p.paid = 1) THEN m.amount_minor ELSE 0 END END)
  FROM savings_movements m WHERE m.subaccount_id = ? AND m.workspace_id = ?), 0)`;

/** Money of a part that no operation has put on its account: the opening and set-aside deposits. */
const UNCOVERED_SQL = `(SELECT s.opening_minor + COALESCE((SELECT SUM(CASE WHEN m.type = 'DEPOSIT'
      THEN m.amount_minor ELSE -m.amount_minor + CASE WHEN EXISTS (
        SELECT 1 FROM recurring_payments p WHERE p.expense_id = m.repay_expense_id
          AND p.month = m.repay_month AND p.paid = 1) THEN m.amount_minor ELSE 0 END END)
    FROM savings_movements m WHERE m.subaccount_id = s.id AND m.workspace_id = s.workspace_id
      AND m.transaction_id IS NULL), 0)
  FROM fund_subaccounts s WHERE s.id = ? AND s.workspace_id = ?)`;

/**
 * Funds (CASH pots) and portfolios as containers, and the parts of a fund: whose money, on which
 * account, with which plan rule. Money itself moves in MovementsService.
 */
export class FundsService {
  constructor(
    private readonly d1: D1Database,
    private readonly repo: SavingsRepository,
    private readonly ledger: Ledger,
    private readonly members: MembersService,
  ) {}

  /** A part's account must be this household's, active, and in the part's currency. */
  private async assertAccount(workspaceId: string, accountId: string | null, currency: string) {
    if (!accountId) return;
    const row = await this.repo.account(workspaceId, accountId);
    if (!row) throw unprocessable('SAVINGS_ACCOUNT_NOT_FOUND');
    if (row.archived_at) throw unprocessable('SAVINGS_ACCOUNT_ARCHIVED');
    if (row.currency !== currency)
      throw unprocessable('SAVINGS_ACCOUNT_CURRENCY', { accountCurrency: row.currency, currency });
  }

  async createPot(ctx: ServiceContext, input: Out<typeof potCreateSchema>): Promise<string> {
    requireScope(ctx, 'savings:write');
    await this.members.assertMember(ctx.workspaceId, input.ownerId);
    const now = Date.now();
    const id = crypto.randomUUID();
    // A fund starts with one part of its owner (named after them), holding what is already saved.
    const jointName = serverText(await userLanguage(this.d1, ctx.userId), 'fund.jointPart');
    await this.d1.batch([
      this.d1
        .prepare(
          `INSERT INTO savings_pots (id, workspace_id, name, kind, currency, owner_id, target_minor,
             target_date, priority, icon, color, description, note, created_at, updated_at,
             exclude_from_total)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, ?15)`,
        )
        .bind(
          id,
          ctx.workspaceId,
          input.name,
          input.kind,
          input.currency,
          input.ownerId,
          minor(input.target),
          input.targetDate,
          input.priority,
          input.icon,
          input.color,
          input.description,
          input.note,
          now,
          input.excludeFromTotal ? 1 : 0,
        ),
      ...(input.kind === 'CASH'
        ? [
            this.d1
              .prepare(
                `INSERT INTO fund_subaccounts (id, workspace_id, pot_id, name, owner_id, color,
                   opening_minor, created_at, updated_at)
                 VALUES (?1, ?2, ?3,
                   COALESCE((SELECT name FROM members WHERE id = ?4 AND workspace_id = ?2), ?5),
                   ?4, NULL, ?6, ?7, ?7)`,
              )
              .bind(
                crypto.randomUUID(),
                ctx.workspaceId,
                id,
                input.ownerId,
                jointName,
                Number(toMinor(input.balance)),
                now,
              ),
          ]
        : []),
      this.d1
        .prepare(
          "INSERT INTO fund_part_events (id, workspace_id, pot_id, subaccount_id, account_id, part_name, type, created_at) SELECT ?, workspace_id, pot_id, id, account_id, name, 'ADDED', created_at FROM fund_subaccounts WHERE pot_id = ? AND workspace_id = ?",
        )
        .bind(crypto.randomUUID(), id, ctx.workspaceId),
    ]);
    return id;
  }

  async updatePot(
    ctx: ServiceContext,
    id: string,
    input: Out<typeof potUpdateSchema>,
  ): Promise<void> {
    requireScope(ctx, 'savings:write');
    const pot = await this.repo.pot(ctx.workspaceId, id);
    await this.members.assertMember(ctx.workspaceId, input.ownerId);
    const set = partialSet({
      name: input.name,
      currency: input.currency,
      archived_at: archivedAt(input.archived),
      owner_id: input.ownerId,
      target_minor: input.target === undefined ? undefined : minor(input.target),
      target_date: input.targetDate,
      priority: input.priority,
      icon: input.icon,
      color: input.color,
      description: input.description,
      note: input.note,
      exclude_from_total:
        input.excludeFromTotal === undefined ? undefined : input.excludeFromTotal ? 1 : 0,
    });
    const currencyChanges =
      input.currency !== undefined && input.currency !== pot.currency && pot.kind === 'CASH';
    await guardedBatch(
      this.d1,
      [
        // The currency of a fund with money history or accounts stays (checked in the batch).
        guard(
          this.d1,
          `NOT (? AND EXISTS (SELECT 1 FROM savings_movements WHERE pot_id = ? AND workspace_id = ?
             UNION SELECT 1 FROM fund_subaccounts WHERE pot_id = ? AND workspace_id = ?
               AND account_id IS NOT NULL))`,
          currencyChanges ? 1 : 0,
          id,
          ctx.workspaceId,
          id,
          ctx.workspaceId,
        ),
        this.d1
          .prepare(
            `UPDATE savings_pots SET ${set.sql ? `${set.sql}, ` : ''}updated_at = ?
             WHERE id = ? AND workspace_id = ?`,
          )
          .bind(...set.params, Date.now(), id, ctx.workspaceId),
      ],
      () => unprocessable('SAVINGS_POT_CURRENCY_LOCKED'),
    );
  }

  /**
   * Deletes the pot with its history. Its operations go too (both the withdrawals and the
   * put-backs of returned ones, so the accounts end up as if the fund never existed), and returns
   * still due disappear from the planner.
   */
  async deletePot(ctx: ServiceContext, id: string): Promise<void> {
    requireScope(ctx, 'savings:write');
    await this.repo.pot(ctx.workspaceId, id);
    const own = await this.repo.movementsOf(ctx.workspaceId, { potId: id });
    const operations = own.flatMap((m) =>
      [m.transaction_id, m.return_transaction_id].filter((t): t is string => t !== null),
    );
    await this.d1.batch([
      ...own
        .filter((m) => m.repay_expense_id && !m.returned)
        .map((m) =>
          this.d1
            .prepare('DELETE FROM recurring_expenses WHERE id = ? AND workspace_id = ?')
            .bind(m.repay_expense_id, ctx.workspaceId),
        ),
      this.d1
        .prepare('DELETE FROM savings_pots WHERE id = ? AND workspace_id = ?')
        .bind(id, ctx.workspaceId),
      ...this.ledger.remove(ctx.workspaceId, operations),
    ]);
  }

  // ---- fund parts -----------------------------------------------------------------------------

  async partHistory(ctx: ServiceContext, potId: string) {
    requireScope(ctx, 'savings:read');
    await this.repo.pot(ctx.workspaceId, potId);
    const result = await this.d1
      .prepare(
        'SELECT id, subaccount_id, account_id, part_name, type, created_at FROM fund_part_events WHERE workspace_id = ? AND pot_id = ? ORDER BY created_at DESC, rowid DESC',
      )
      .bind(ctx.workspaceId, potId)
      .all<{
        id: string;
        subaccount_id: string;
        account_id: string | null;
        part_name: string;
        type: 'ADDED' | 'REMOVED' | 'RESTORED';
        created_at: number;
      }>();
    return result.results.map((r) => ({
      id: r.id,
      subaccountId: r.subaccount_id,
      accountId: r.account_id,
      partName: r.part_name,
      type: r.type,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  private partEvent(
    ctx: ServiceContext,
    part: { id: string; pot_id: string; account_id: string | null; name: string },
    type: 'ADDED' | 'REMOVED' | 'RESTORED',
    now: number,
  ) {
    return this.d1
      .prepare(
        'INSERT INTO fund_part_events (id, workspace_id, pot_id, subaccount_id, account_id, part_name, type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        crypto.randomUUID(),
        ctx.workspaceId,
        part.pot_id,
        part.id,
        part.account_id,
        part.name,
        type,
        now,
      );
  }

  async createPart(
    ctx: ServiceContext,
    potId: string,
    input: Out<typeof subaccountCreateSchema>,
  ): Promise<void> {
    requireScope(ctx, 'savings:write');
    const pot = await this.repo.pot(ctx.workspaceId, potId);
    if (pot.archived_at) throw unprocessable('SAVINGS_POT_ARCHIVED');
    if (pot.kind !== 'CASH') throw unprocessable('SAVINGS_NOT_A_FUND');
    await this.members.assertMember(ctx.workspaceId, input.ownerId);
    const currency = input.currency ?? pot.currency;
    await this.assertAccount(ctx.workspaceId, input.accountId, currency);
    const now = Date.now();
    const id = crypto.randomUUID();
    await this.d1.batch([
      this.d1
        .prepare(
          `INSERT INTO fund_subaccounts (id, workspace_id, pot_id, name, owner_id, color, account_id,
           opening_minor, note, currency, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?11,
           (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM fund_subaccounts
            WHERE pot_id = ?3 AND workspace_id = ?2), ?10, ?10)`,
        )
        .bind(
          id,
          ctx.workspaceId,
          potId,
          input.name,
          input.ownerId,
          input.color,
          input.accountId,
          Number(toMinor(input.balance)),
          input.note,
          now,
          currency,
        ),
      this.partEvent(
        ctx,
        { id, pot_id: potId, account_id: input.accountId, name: input.name },
        'ADDED',
        now,
      ),
    ]);
  }

  /**
   * Changes a part. A new balance sets the opening so that opening + movements equals it. Moving
   * the part to another account moves its money too: its deposits, withdrawals and returns go to
   * the new account, and money without its own operations (the opening, set-aside deposits) is
   * transferred. Everything is one batch, checked against the state it was planned from.
   */
  async updatePart(
    ctx: ServiceContext,
    id: string,
    input: Out<typeof subaccountUpdateSchema>,
  ): Promise<void> {
    requireScope(ctx, 'savings:write');
    const { workspaceId } = ctx;
    const part = await this.repo.part(workspaceId, id);
    await this.members.assertMember(workspaceId, input.ownerId);
    const currency = input.currency ?? part.currency;
    const accountId = input.accountId === undefined ? part.account_id : input.accountId;
    if (accountId && accountId !== part.account_id)
      await this.assertAccount(workspaceId, accountId, currency);
    const now = Date.now();
    const moves = part.account_id && accountId && accountId !== part.account_id;
    const statements: D1PreparedStatement[] = [
      // The part is still on the account (and in the currency) this change was planned from, and
      // a currency change needs a part without history.
      guard(
        this.d1,
        `EXISTS (SELECT 1 FROM fund_subaccounts s JOIN savings_pots p ON p.id = s.pot_id
           WHERE s.id = ? AND s.workspace_id = ? AND s.account_id IS ?
             AND COALESCE(s.currency, p.currency) = ?)
         AND NOT (? AND EXISTS (SELECT 1 FROM savings_movements WHERE subaccount_id = ? AND workspace_id = ?))`,
        id,
        workspaceId,
        part.account_id,
        part.currency,
        currency !== part.currency ? 1 : 0,
        id,
        workspaceId,
      ),
    ];
    if (moves) statements.push(...(await this.moveMoney(ctx, part, accountId)));
    const set = partialSet({
      name: input.name,
      owner_id: input.ownerId,
      color: input.color,
      account_id: input.accountId,
      note: input.note,
      archived_at: archivedAt(input.archived, now),
      currency: input.currency,
    });
    statements.push(
      this.d1
        .prepare(
          `UPDATE fund_subaccounts SET ${set.sql ? `${set.sql}, ` : ''}
             opening_minor = CASE WHEN ? THEN ? - ${MOVEMENTS_SUM_SQL} ELSE opening_minor END,
             updated_at = ?
           WHERE id = ? AND workspace_id = ?`,
        )
        .bind(
          ...set.params,
          input.balance === undefined ? 0 : 1,
          input.balance === undefined ? 0 : Number(toMinor(input.balance)),
          id,
          workspaceId,
          now,
          id,
          workspaceId,
        ),
    );
    if (input.accountId !== undefined && input.accountId !== part.account_id) {
      if (part.account_id) statements.push(this.partEvent(ctx, part, 'REMOVED', now));
      if (input.accountId)
        statements.push(
          this.partEvent(
            ctx,
            { ...part, account_id: input.accountId, name: input.name ?? part.name },
            'ADDED',
            now,
          ),
        );
    }
    if (input.archived !== undefined && input.archived !== Boolean(part.archived_at)) {
      statements.push(this.partEvent(ctx, part, input.archived ? 'REMOVED' : 'RESTORED', now));
    }
    await guardedBatch(this.d1, statements, async () => {
      const fresh = await this.repo.part(workspaceId, id);
      if (
        currency !== fresh.currency &&
        (await this.repo.hasMovements(workspaceId, { partId: id }))
      )
        return unprocessable('SAVINGS_PART_CURRENCY_LOCKED');
      return conflict('VERSION_CONFLICT');
    });
  }

  /** Statements that move a part's money from its account to `to` (see updatePart). */
  private async moveMoney(
    ctx: ServiceContext,
    part: PartRow,
    to: string,
  ): Promise<D1PreparedStatement[]> {
    const { workspaceId } = ctx;
    const from = part.account_id;
    const uncovered = await this.d1
      .prepare(`SELECT ${UNCOVERED_SQL} AS amount`)
      .bind(part.id, workspaceId)
      .first<{ amount: number | null }>();
    const rest = BigInt(uncovered?.amount ?? 0);
    const own = await this.repo.movementsOf(workspaceId, { partId: part.id });
    const operations = own.flatMap((m) =>
      [m.transaction_id, m.return_transaction_id].filter((t): t is string => t !== null),
    );
    return [
      // What is moved is still what the part holds: the same movements, the same amount outside
      // their operations.
      guard(
        this.d1,
        `${UNCOVERED_SQL} = ? AND (SELECT COUNT(*) FROM savings_movements
           WHERE subaccount_id = ? AND workspace_id = ?) = ?`,
        part.id,
        workspaceId,
        Number(rest),
        part.id,
        workspaceId,
        own.length,
      ),
      ...(from ? this.ledger.moveToAccount(workspaceId, operations, from, to) : []),
      ...(rest > 0n && from
        ? this.ledger.transfer({
            workspaceId,
            userId: ctx.userId,
            fromAccountId: from,
            toAccountId: to,
            currency: part.currency,
            amountMinor: rest,
            date: today(),
            kind: 'FUND_PART_MOVED',
            params: { part: part.name },
          }).statements
        : []),
    ];
  }

  /** Removing releases the reservation; account operations and history stay intact. */
  async deletePart(ctx: ServiceContext, id: string): Promise<void> {
    await this.updatePart(ctx, id, { archived: true });
  }

  async setRule(ctx: ServiceContext, id: string, input: Out<typeof fundRuleSchema>) {
    requireScope(ctx, 'savings:write');
    await this.repo.part(ctx.workspaceId, id);
    const now = Date.now();
    await this.d1.batch([
      this.d1
        .prepare('DELETE FROM fund_rules WHERE subaccount_id = ? AND workspace_id = ?')
        .bind(id, ctx.workspaceId),
      this.d1
        .prepare(
          `INSERT INTO fund_rules (id, workspace_id, subaccount_id, mode, amount_minor, percent_bp,
             percent_base, min_minor, max_minor, priority, start_month, end_month, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)`,
        )
        .bind(
          crypto.randomUUID(),
          ctx.workspaceId,
          id,
          input.mode,
          input.mode === 'FIXED' ? minor(input.amount) : null,
          input.mode === 'PERCENT' && input.percent !== null ? percentToBp(input.percent) : null,
          input.mode === 'PERCENT' ? input.percentBase : null,
          minor(input.min),
          minor(input.max),
          input.priority,
          input.startMonth,
          input.endMonth,
          now,
        ),
    ]);
  }

  async deleteRule(ctx: ServiceContext, id: string) {
    requireScope(ctx, 'savings:write');
    await this.repo.part(ctx.workspaceId, id);
    await this.d1
      .prepare('DELETE FROM fund_rules WHERE subaccount_id = ? AND workspace_id = ?')
      .bind(id, ctx.workspaceId)
      .run();
  }

  /** One month's planned amount (or back to the rule with null). */
  async setOverride(ctx: ServiceContext, id: string, input: Out<typeof fundOverrideSchema>) {
    requireScope(ctx, 'savings:write');
    await this.repo.part(ctx.workspaceId, id);
    await (
      input.amount === null
        ? this.d1
            .prepare(
              'DELETE FROM fund_plan_overrides WHERE subaccount_id = ? AND month = ? AND workspace_id = ?',
            )
            .bind(id, input.month, ctx.workspaceId)
        : this.d1
            .prepare(
              `INSERT INTO fund_plan_overrides (workspace_id, subaccount_id, month, amount_minor, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5)
               ON CONFLICT (subaccount_id, month) DO UPDATE SET amount_minor = ?4, updated_at = ?5`,
            )
            .bind(ctx.workspaceId, id, input.month, Number(toMinor(input.amount)), Date.now())
    ).run();
  }
}
