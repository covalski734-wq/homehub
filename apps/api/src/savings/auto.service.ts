import {
  shiftMonth,
  type AutoRuleDto,
  type autoAmountSchema,
  type autoRuleCreateSchema,
  type autoRuleUpdateSchema,
} from '@homehub/shared';
import type { z } from 'zod';
import type { Ledger } from '../finance/ledger';
import { guard, isGuardFailure } from '../lib/batch-guard';
import { currentMonth, dayOfMonth, today } from '../lib/dates';
import { unprocessable } from '../lib/http-error';
import { formatMinor, toMinor } from '../lib/money';
import { requireScope, type ServiceContext } from '../lib/service-context';
import {
  PART_BALANCE_SQL,
  type AutoAmountRow,
  type AutoRuleRow,
  type AutosData,
  type SavingsRepository,
} from './savings.repository';

type Out<T extends z.ZodType> = z.output<T>;

/** Months caught up at most when a rule starts in the past. */
const CATCH_UP_MONTHS = 24;

/**
 * A rule's amount for a month: its one-month amount, else the latest «с этого месяца» amount.
 */
export function amountFor(
  amounts: AutoAmountRow[],
  ruleId: string,
  month: string,
): { amount: bigint; overridden: boolean } {
  const own = amounts.filter((a) => a.rule_id === ruleId);
  const one = own.find((a) => a.one_month && a.month === month);
  if (one) return { amount: BigInt(one.amount_minor), overridden: true };
  const forward = own
    .filter((a) => !a.one_month && a.month <= month)
    .sort((a, b) => b.month.localeCompare(a.month))[0];
  return { amount: BigInt(forward?.amount_minor ?? 0), overridden: false };
}

export function autoRuleDto(rule: AutoRuleRow, autos: AutosData, month: string): AutoRuleDto {
  const { amount, overridden } = amountFor(autos.amounts, rule.id, month);
  return {
    id: rule.id,
    type: rule.type,
    amount: formatMinor(amount),
    overridden,
    day: rule.day,
    startMonth: rule.start_month,
    endMonth: rule.end_month,
    note: rule.note,
    done: autos.done.has(`${rule.id}:${month}`),
  };
}

/**
 * Automatic monthly deposits and withdrawals of fund parts. Each month's movement is made once
 * (unique rule + month), on the rule's day, together with its account operation in one batch; a
 * withdrawal larger than the part's balance waits. Withdrawals run from cron and rule changes;
 * deposits require explicit confirmation. Reading never moves money.
 */
export class AutoMovementsService {
  constructor(
    private readonly d1: D1Database,
    private readonly repo: SavingsRepository,
    private readonly ledger: Ledger,
  ) {}

  async create(ctx: ServiceContext, partId: string, input: Out<typeof autoRuleCreateSchema>) {
    requireScope(ctx, 'savings:write');
    const part = await this.repo.part(ctx.workspaceId, partId);
    if (part.archived_at) throw unprocessable('SAVINGS_PART_ARCHIVED');
    const id = crypto.randomUUID();
    await this.d1.batch([
      this.d1
        .prepare(
          `INSERT INTO fund_auto_rules (id, workspace_id, subaccount_id, type, day, start_month, end_month,
             note, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
        )
        .bind(
          id,
          ctx.workspaceId,
          partId,
          input.type,
          input.day,
          input.startMonth,
          input.endMonth,
          input.note,
          Date.now(),
        ),
      this.d1
        .prepare(
          `INSERT INTO fund_auto_amounts (workspace_id, rule_id, month, one_month, amount_minor)
           VALUES (?1, ?2, ?3, 0, ?4)`,
        )
        .bind(ctx.workspaceId, id, input.startMonth, Number(toMinor(input.amount))),
    ]);
    await this.run(ctx.workspaceId);
  }

  async update(ctx: ServiceContext, id: string, input: Out<typeof autoRuleUpdateSchema>) {
    requireScope(ctx, 'savings:write');
    await this.repo.autoRule(ctx.workspaceId, id);
    await this.d1
      .prepare(
        `UPDATE fund_auto_rules SET day = COALESCE(?1, day),
           end_month = CASE WHEN ?2 = 1 THEN ?3 ELSE end_month END,
           note = COALESCE(?4, note), updated_at = ?5 WHERE id = ?6 AND workspace_id = ?7`,
      )
      .bind(
        input.day ?? null,
        input.endMonth === undefined ? 0 : 1,
        input.endMonth ?? null,
        input.note ?? null,
        Date.now(),
        id,
        ctx.workspaceId,
      )
      .run();
    await this.run(ctx.workspaceId);
  }

  /**
   * A new amount «только в этом месяце» (MONTH) or «в этом и последующих» (FORWARD). Movements
   * already made for those months take the new amount, and their operations follow. An amount of
   * 0 means «not this month»: the made movements and their operations are removed first, then the
   * rest is updated — a movement of 0 never exists, not even inside the batch (CHECK amount > 0).
   */
  async setAmount(ctx: ServiceContext, id: string, input: Out<typeof autoAmountSchema>) {
    requireScope(ctx, 'savings:write');
    const { workspaceId } = ctx;
    await this.repo.autoRule(workspaceId, id);
    const amount = Number(toMinor(input.amount));
    const months = input.scope === 'MONTH' ? 'auto_month = ?' : 'auto_month >= ?';
    const affected = await this.d1
      .prepare(
        `SELECT id, transaction_id FROM savings_movements
         WHERE auto_rule_id = ? AND workspace_id = ? AND ${months}`,
      )
      .bind(id, workspaceId, input.month)
      .all<{ id: string; transaction_id: string | null }>();
    const amounts =
      input.scope === 'MONTH'
        ? [
            this.d1
              .prepare(
                `INSERT INTO fund_auto_amounts (workspace_id, rule_id, month, one_month, amount_minor)
                 VALUES (?1, ?2, ?3, 1, ?4)
                 ON CONFLICT (rule_id, month, one_month) DO UPDATE SET amount_minor = ?4`,
              )
              .bind(workspaceId, id, input.month, amount),
          ]
        : [
            this.d1
              .prepare(
                'DELETE FROM fund_auto_amounts WHERE rule_id = ? AND workspace_id = ? AND month >= ?',
              )
              .bind(id, workspaceId, input.month),
            this.d1
              .prepare(
                `INSERT INTO fund_auto_amounts (workspace_id, rule_id, month, one_month, amount_minor)
                 VALUES (?1, ?2, ?3, 0, ?4)`,
              )
              .bind(workspaceId, id, input.month, amount),
          ];
    const movements =
      amount === 0
        ? [
            this.d1
              .prepare(
                `DELETE FROM savings_movements WHERE auto_rule_id = ? AND workspace_id = ? AND ${months}`,
              )
              .bind(id, workspaceId, input.month),
            ...this.ledger.remove(
              workspaceId,
              affected.results.flatMap((m) => (m.transaction_id ? [m.transaction_id] : [])),
            ),
          ]
        : [
            this.d1
              .prepare(
                `UPDATE savings_movements SET amount_minor = ?
                 WHERE auto_rule_id = ? AND workspace_id = ? AND ${months}`,
              )
              .bind(amount, id, workspaceId, input.month),
            // The account operations follow their movements.
            ...affected.results
              .filter((m) => m.transaction_id)
              .map((m) => this.ledger.setAmount(workspaceId, m.transaction_id ?? '', amount)),
          ];
    // The movements are still the ones read above (a parallel run may have made a new one).
    const check = guard(
      this.d1,
      `(SELECT COUNT(*) FROM savings_movements WHERE auto_rule_id = ? AND workspace_id = ? AND ${months}) = ?`,
      id,
      workspaceId,
      input.month,
      affected.results.length,
    );
    await this.d1.batch([check, ...amounts, ...movements]);
    await this.run(workspaceId);
  }

  /** Stops the operation; movements already made stay in the history. */
  async remove(ctx: ServiceContext, id: string) {
    requireScope(ctx, 'savings:write');
    await this.repo.autoRule(ctx.workspaceId, id);
    await this.d1
      .prepare('DELETE FROM fund_auto_rules WHERE id = ? AND workspace_id = ?')
      .bind(id, ctx.workspaceId)
      .run();
  }

  /**
   * Makes the movements that are due by today and not made yet. Idempotent: a movement and its
   * operation are written in one batch that first checks the month is still not made (and, for a
   * withdrawal, that the part holds the amount); a parallel run that got there first makes the
   * batch abort without writing anything. Returns how many were made.
   */
  async run(workspaceId: string): Promise<number> {
    const autos = await this.repo.autos(workspaceId);
    if (autos.rules.length === 0) return 0;
    const now = currentMonth();
    const date = today();
    let made = 0;
    for (const rule of autos.rules) {
      if (rule.type === 'DEPOSIT') continue;
      const first =
        rule.start_month > shiftMonth(now, -CATCH_UP_MONTHS)
          ? rule.start_month
          : shiftMonth(now, -CATCH_UP_MONTHS);
      for (
        let month = first;
        month <= now && (!rule.end_month || month <= rule.end_month);
        month = shiftMonth(month, 1)
      ) {
        const day = dayOfMonth(month, rule.day);
        if (day > date || autos.done.has(`${rule.id}:${month}`)) continue;
        const { amount } = amountFor(autos.amounts, rule.id, month);
        if (amount <= 0n) continue;
        if (await this.make(workspaceId, rule, month, day, amount)) made += 1;
        autos.done.add(`${rule.id}:${month}`);
      }
    }
    return made;
  }

  async confirm(ctx: ServiceContext, id: string, month: string) {
    requireScope(ctx, 'savings:write');
    await this.repo.autoRule(ctx.workspaceId, id);
    const autos = await this.repo.autos(ctx.workspaceId);
    const rule = autos.rules.find((r) => r.id === id);
    if (!rule) throw unprocessable('SAVINGS_PART_ARCHIVED');
    if (month < rule.start_month || (rule.end_month && month > rule.end_month))
      throw unprocessable('SAVINGS_PART_NOT_FOUND_OR_ARCHIVED');
    const { amount } = amountFor(autos.amounts, id, month);
    if (amount <= 0n || autos.done.has(id + ':' + month)) return;
    await this.make(ctx.workspaceId, rule, month, dayOfMonth(month, rule.day), amount);
  }

  private async make(
    workspaceId: string,
    rule: AutoRuleRow,
    month: string,
    date: string,
    amount: bigint,
  ): Promise<boolean> {
    const deposit = rule.type === 'DEPOSIT';
    // Like a manual one: the money arrives on / leaves the part's account.
    const operation = rule.account_id
      ? this.ledger.movement({
          workspaceId,
          userId: null,
          accountId: rule.account_id,
          currency: rule.currency,
          category: deposit ? 'savings-in' : 'savings-out',
          amountMinor: amount,
          date,
          kind: deposit ? 'FUND_AUTO_DEPOSIT' : 'FUND_AUTO_WITHDRAWAL',
          params: { fund: rule.pot_name },
        })
      : null;
    try {
      await this.d1.batch([
        guard(
          this.d1,
          `NOT EXISTS (SELECT 1 FROM savings_movements WHERE auto_rule_id = ? AND auto_month = ?)
           AND (? OR ${PART_BALANCE_SQL} >= ?)`,
          rule.id,
          month,
          deposit ? 1 : 0,
          rule.subaccount_id,
          workspaceId,
          Number(amount),
        ),
        ...(operation?.statements ?? []),
        this.d1
          .prepare(
            `INSERT INTO savings_movements (id, workspace_id, pot_id, subaccount_id, type, amount_minor,
               occurred_on, note, auto_rule_id, auto_month, transaction_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
          )
          .bind(
            crypto.randomUUID(),
            workspaceId,
            rule.pot_id,
            rule.subaccount_id,
            rule.type,
            Number(amount),
            date,
            // The rule's own note; without one the client shows «Автопополнение» in its language.
            rule.note,
            rule.id,
            month,
            operation?.id ?? null,
            Date.now(),
          ),
      ]);
      return true;
    } catch (error) {
      // Made meanwhile, or a withdrawal the part cannot cover yet: nothing was written.
      if (isGuardFailure(error)) return false;
      throw error;
    }
  }
}
