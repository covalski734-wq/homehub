import {
  systemOperationKindSchema,
  systemOperationParamsSchema,
  type Paginated,
  type TransactionDto,
  type TransactionPayload,
  type TransactionQuery,
} from '@homehub/shared';
import { conflict, notFound, unprocessable } from '../../lib/http-error';
import { requireScope, type ServiceContext } from '../../lib/service-context';
import type { MembersService } from '../../members/members.service';
import { formatMinor, toMinorNumber } from '../../lib/money';
import type { AccountRow, AccountsRepository } from '../repositories/accounts.repository';
import type { CategoriesRepository } from '../repositories/categories.repository';
import { planKeyOfCategory } from '../plan-categories';
import type {
  TransactionValues,
  TransactionWithRelations,
  TransactionsRepository,
} from '../repositories/transactions.repository';

interface ExistingReferences {
  accountId: string;
  toAccountId: string | null;
}

const systemKindOf = (value: string | null) => {
  const parsed = systemOperationKindSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

function systemParamsOf(value: string | null) {
  if (!value) return null;
  try {
    const parsed = systemOperationParamsSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function toTransactionDto(row: TransactionWithRelations): TransactionDto {
  const { transaction: t } = row;
  return {
    id: t.id,
    type: t.type,
    amount: formatMinor(t.amountMinor),
    currency: t.currency,
    toAmount: t.toAmountMinor === null ? null : formatMinor(t.toAmountMinor),
    toCurrency: t.toCurrency,
    description: t.description,
    occurredAt: t.occurredAt,
    account: row.account,
    toAccount: row.toAccount?.id ? { id: row.toAccount.id, name: row.toAccount.name } : null,
    category: row.category?.id
      ? {
          id: row.category.id,
          name: row.category.name,
          color: row.category.color,
          systemKey: row.category.systemKey,
        }
      : null,
    createdBy: row.createdBy,
    payerId: t.payerId,
    plannerCategory: t.plannerCategory,
    isAdjustment: t.isAdjustment,
    systemKind: systemKindOf(t.systemKind),
    systemParams: systemParamsOf(t.systemParams),
    plan: t.recurringExpenseId
      ? { kind: 'recurring', id: t.recurringExpenseId, month: t.planMonth ?? '' }
      : t.purchaseId
        ? { kind: 'purchase', id: t.purchaseId, month: t.planMonth ?? '' }
        : t.incomeSourceId
          ? { kind: 'income', id: t.incomeSourceId, month: t.planMonth ?? '' }
          : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export class TransactionsService {
  constructor(
    private readonly transactions: TransactionsRepository,
    private readonly accounts: AccountsRepository,
    private readonly categories: CategoriesRepository,
    private readonly d1: D1Database,
    private readonly members: MembersService,
  ) {}

  private assertPayer(workspaceId: string, payerId: string | null) {
    return this.members.assertMember(workspaceId, payerId);
  }

  /**
   * An operation a fund movement made is changed through the fund: editing or deleting it here
   * would leave the movement claiming money the account no longer shows.
   */
  private async assertNotFundOperation(workspaceId: string, id: string) {
    const fund = await this.d1
      .prepare(
        `SELECT p.name FROM savings_movements m JOIN savings_pots p ON p.id = m.pot_id
         WHERE m.workspace_id = ?1 AND (m.transaction_id = ?2 OR m.return_transaction_id = ?2)
         LIMIT 1`,
      )
      .bind(workspaceId, id)
      .first<{ name: string }>();
    if (fund) throw conflict('SAVINGS_FUND_OPERATION', { name: fund.name });
  }

  async list(workspaceId: string, query: TransactionQuery): Promise<Paginated<TransactionDto>> {
    const { total, rows } = await this.transactions.list(workspaceId, query);
    return {
      items: rows.map(toTransactionDto),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async create(ctx: ServiceContext, payload: TransactionPayload): Promise<TransactionDto> {
    requireScope(ctx, 'finance:write');
    if (!ctx.userId) throw new Error('An operation needs an author');
    const values = await this.resolveValues(ctx.workspaceId, payload, null);
    const id = await this.transactions.insert({
      ...values,
      workspaceId: ctx.workspaceId,
      createdById: ctx.userId,
    });
    return this.load(ctx.workspaceId, id);
  }

  async update(
    ctx: ServiceContext,
    id: string,
    payload: TransactionPayload,
  ): Promise<TransactionDto> {
    requireScope(ctx, 'finance:write');
    const existing = await this.transactions.findReferences(ctx.workspaceId, id);
    if (!existing) throw notFound('FINANCE_TRANSACTION_NOT_FOUND');
    await this.assertNotFundOperation(ctx.workspaceId, id);
    const values = await this.resolveValues(ctx.workspaceId, payload, existing);
    const updated = await this.transactions.update(ctx.workspaceId, id, values);
    if (!updated) throw notFound('FINANCE_TRANSACTION_NOT_FOUND');
    return this.load(ctx.workspaceId, id);
  }

  /** A paid planned payment whose operation is removed is no longer paid. */
  async remove(ctx: ServiceContext, id: string): Promise<void> {
    requireScope(ctx, 'finance:write');
    const { workspaceId } = ctx;
    const row = await this.transactions.findWithRelations(workspaceId, id);
    if (!row) throw notFound('FINANCE_TRANSACTION_NOT_FOUND');
    await this.assertNotFundOperation(workspaceId, id);
    const t = row.transaction;
    // The operation and the payment mark it stands for go together.
    const [deleted] = await this.d1.batch([
      this.d1
        .prepare('DELETE FROM transactions WHERE id = ? AND workspace_id = ?')
        .bind(id, workspaceId),
      ...(t.recurringExpenseId && t.planMonth
        ? [
            this.d1
              .prepare(
                'UPDATE recurring_payments SET paid = 0 WHERE expense_id = ? AND month = ? AND workspace_id = ?',
              )
              .bind(t.recurringExpenseId, t.planMonth, workspaceId),
          ]
        : []),
    ]);
    if (!deleted?.meta.changes) throw notFound('FINANCE_TRANSACTION_NOT_FOUND');
  }

  private async load(workspaceId: string, id: string): Promise<TransactionDto> {
    const row = await this.transactions.findWithRelations(workspaceId, id);
    if (!row) throw notFound('FINANCE_TRANSACTION_NOT_FOUND');
    return toTransactionDto(row);
  }

  /**
   * Validates references against the caller's workspace and derives currencies from accounts,
   * so the client can never write a currency that differs from the account's currency.
   * The same rules are enforced again by database triggers at write time, which closes the
   * gap between this check and the INSERT/UPDATE under concurrent requests.
   */
  private async resolveValues(
    workspaceId: string,
    payload: TransactionPayload,
    existing: ExistingReferences | null,
  ): Promise<TransactionValues> {
    const account = await this.findUsableAccount(
      workspaceId,
      payload.accountId,
      existing?.accountId,
    );
    await this.assertPayer(workspaceId, payload.payerId);
    const amountMinor = toMinorNumber(payload.amount);
    const base = {
      payerId: payload.payerId ?? account.ownerId,
      type: payload.type,
      accountId: account.id,
      amountMinor,
      currency: account.currency,
      description: payload.description,
      occurredAt: payload.occurredAt,
    };

    if (payload.type === 'TRANSFER') {
      const toAccount = await this.findUsableAccount(
        workspaceId,
        payload.toAccountId ?? '',
        existing?.toAccountId,
      );
      const sameCurrency = toAccount.currency === account.currency;
      if (!sameCurrency && !payload.toAmount) {
        throw unprocessable('FINANCE_TRANSFER_TO_AMOUNT', { currency: toAccount.currency });
      }
      return {
        ...base,
        plannerCategory: null,
        categoryId: null,
        toAccountId: toAccount.id,
        toAmountMinor: sameCurrency ? amountMinor : toMinorNumber(payload.toAmount ?? '0'),
        toCurrency: toAccount.currency,
      };
    }

    const category = await this.categories.findById(workspaceId, payload.categoryId ?? '');
    if (!category) throw unprocessable('FINANCE_CATEGORY_NOT_FOUND');
    if (category.kind !== payload.type) {
      throw unprocessable('FINANCE_CATEGORY_KIND');
    }
    return {
      ...base,
      plannerCategory:
        payload.type === 'EXPENSE'
          ? (payload.plannerCategory ?? planKeyOfCategory(category.systemKey))
          : null,
      categoryId: category.id,
      toAccountId: null,
      toAmountMinor: null,
      toCurrency: null,
    };
  }

  private async findUsableAccount(
    workspaceId: string,
    accountId: string,
    previouslyUsedId: string | null | undefined,
  ): Promise<AccountRow> {
    const account = await this.accounts.findById(workspaceId, accountId);
    if (!account) throw unprocessable('FINANCE_ACCOUNT_NOT_FOUND');
    // Archived accounts keep their history editable but cannot receive new operations.
    if (account.archivedAt && account.id !== previouslyUsedId) {
      throw unprocessable('FINANCE_ACCOUNT_NAMED_ARCHIVED', { name: account.name });
    }
    return account;
  }
}
