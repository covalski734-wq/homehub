import type {
  AccountCreatePayload,
  AccountDto,
  AccountUpdatePayload,
  BalanceDto,
} from '@homehub/shared';
import { guard, guardedBatch } from '../../lib/batch-guard';
import { conflict, notFound, unprocessable } from '../../lib/http-error';
import { formatMinor, minorFromSql, toMinorNumber } from '../../lib/money';
import { requireScope, type ServiceContext } from '../../lib/service-context';
import type { MembersService } from '../../members/members.service';
import { ACCOUNT_BALANCE_SQL, type Ledger } from '../ledger';
import {
  collectAccountFlows,
  computeBalance,
  emptyAccountFlows,
  sumBalancesByCurrency,
} from '../calculations';
import type {
  AccountChanges,
  AccountFlowRows,
  AccountRow,
  AccountsRepository,
} from '../repositories/accounts.repository';

interface AccountWithBalance {
  account: AccountRow;
  balance: bigint;
  transactionCount: number;
}

/** A reconciliation that finds the balance already as requested. */
class AlreadyDone extends Error {}

/** Balances are never stored: they are derived from the initial balance and all operations. */
export function withBalances({
  accounts,
  outgoing,
  incoming,
}: AccountFlowRows): AccountWithBalance[] {
  const flows = collectAccountFlows(
    outgoing.map((row) => ({
      accountId: row.accountId,
      type: row.type,
      amount: minorFromSql(row.total),
    })),
    incoming
      .filter((row): row is typeof row & { toAccountId: string } => row.toAccountId !== null)
      .map((row) => ({ toAccountId: row.toAccountId, amount: minorFromSql(row.total) })),
  );
  const counts = new Map<string, number>();
  for (const row of outgoing)
    counts.set(row.accountId, (counts.get(row.accountId) ?? 0) + row.count);
  for (const row of incoming) {
    if (row.toAccountId)
      counts.set(row.toAccountId, (counts.get(row.toAccountId) ?? 0) + row.count);
  }
  return accounts.map((account) => ({
    account,
    balance: computeBalance(
      BigInt(account.initialBalanceMinor),
      flows.get(account.id) ?? emptyAccountFlows(),
    ),
    transactionCount: counts.get(account.id) ?? 0,
  }));
}

export function balancesByCurrency(rows: AccountFlowRows): BalanceDto[] {
  return sumBalancesByCurrency(
    withBalances(rows).map(({ account, balance }) => ({ currency: account.currency, balance })),
  );
}

function toDto(
  { account, balance, transactionCount }: AccountWithBalance,
  reserved = 0n,
): AccountDto {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    initialBalance: formatMinor(account.initialBalanceMinor),
    balance: formatMinor(balance),
    archived: account.archivedAt !== null,
    transactionCount,
    ownerId: account.ownerId,
    color: account.color,
    note: account.note,
    reserved: formatMinor(reserved),
    available: formatMinor(balance - reserved),
    createdAt: account.createdAt.toISOString(),
  };
}

/** Fund money set aside on each account (provided by the savings module, which owns funds). */
export type ReservedByAccount = (workspaceId: string) => Promise<Map<string, bigint>>;

export class AccountsService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly d1: D1Database,
    private readonly ledger: Ledger,
    private readonly members: MembersService,
    private readonly reserved: ReservedByAccount,
  ) {}

  private assertOwner(workspaceId: string, ownerId: string | null | undefined) {
    return this.members.assertMember(workspaceId, ownerId);
  }

  async list(workspaceId: string): Promise<AccountDto[]> {
    const [rows, reserved] = await Promise.all([
      this.accounts.loadWithFlows(workspaceId),
      this.reserved(workspaceId),
    ]);
    return withBalances(rows).map((row) => toDto(row, reserved.get(row.account.id)));
  }

  /**
   * Sets the real balance seen in the bank: the difference becomes a reconciliation operation
   * (never income or spending), so history stays and the balance matches.
   */
  async reconcile(
    ctx: ServiceContext,
    id: string,
    balance: string,
    date: string,
  ): Promise<AccountDto> {
    requireScope(ctx, 'finance:write');
    const { workspaceId } = ctx;
    const [account] = withBalances(await this.accounts.loadWithFlows(workspaceId, id));
    if (!account) throw notFound('FINANCE_ACCOUNT_NOT_FOUND');
    if (account.account.archivedAt) throw unprocessable('FINANCE_ACCOUNT_ARCHIVED');
    const diff = BigInt(toMinorNumber(balance)) - account.balance;
    if (diff !== 0n) {
      const written = this.ledger.movement({
        workspaceId,
        userId: ctx.userId,
        accountId: id,
        currency: account.account.currency,
        category: diff > 0n ? 'adjustment-in' : 'adjustment-out',
        amountMinor: diff > 0n ? diff : -diff,
        date,
        kind: 'RECONCILIATION',
      });
      // The difference is right only for the balance it was computed from: a repeated or
      // parallel reconciliation to the same amount adds nothing (D-3).
      await guardedBatch(
        this.d1,
        [
          guard(this.d1, `${ACCOUNT_BALANCE_SQL} = ?`, workspaceId, id, Number(account.balance)),
          ...written.statements,
        ],
        async () => {
          const [now] = withBalances(await this.accounts.loadWithFlows(workspaceId, id));
          // Already at the requested balance (a double click): nothing to do.
          return now && now.balance === BigInt(toMinorNumber(balance))
            ? new AlreadyDone()
            : conflict('FINANCE_BALANCE_CHANGED');
        },
      ).catch((error: unknown) => {
        if (!(error instanceof AlreadyDone)) throw error;
      });
    }
    return this.one(workspaceId, id);
  }

  /** Money put on the account from outside the plan; kept in its history, not income. */
  async topup(
    ctx: ServiceContext,
    id: string,
    input: { amount: string; date: string; note: string },
  ): Promise<AccountDto> {
    requireScope(ctx, 'finance:write');
    const { workspaceId } = ctx;
    const [account] = withBalances(await this.accounts.loadWithFlows(workspaceId, id));
    if (!account) throw notFound('FINANCE_ACCOUNT_NOT_FOUND');
    if (account.account.archivedAt) throw unprocessable('FINANCE_ACCOUNT_ARCHIVED');
    await this.d1.batch(
      this.ledger.movement({
        workspaceId,
        userId: ctx.userId,
        accountId: id,
        currency: account.account.currency,
        category: 'account-in',
        amountMinor: toMinorNumber(input.amount),
        date: input.date,
        kind: 'ACCOUNT_TOPUP',
        note: input.note,
      }).statements,
    );
    return this.one(workspaceId, id);
  }

  private async one(workspaceId: string, id: string): Promise<AccountDto> {
    const [account] = withBalances(await this.accounts.loadWithFlows(workspaceId, id));
    if (!account) throw notFound('FINANCE_ACCOUNT_NOT_FOUND');
    return toDto(account, (await this.reserved(workspaceId)).get(id));
  }

  async totals(workspaceId: string): Promise<BalanceDto[]> {
    return balancesByCurrency(await this.accounts.loadWithFlows(workspaceId));
  }

  async create(workspaceId: string, payload: AccountCreatePayload): Promise<AccountDto> {
    await this.assertOwner(workspaceId, payload.ownerId);
    const account = await this.accounts.insert({
      workspaceId,
      name: payload.name,
      type: payload.type,
      currency: payload.currency,
      initialBalanceMinor: toMinorNumber(payload.initialBalance),
      ownerId: payload.ownerId,
      color: payload.color,
      note: payload.note,
    });
    return toDto({ account, balance: BigInt(account.initialBalanceMinor), transactionCount: 0 });
  }

  async update(
    workspaceId: string,
    id: string,
    payload: AccountUpdatePayload,
  ): Promise<AccountDto> {
    await this.assertOwner(workspaceId, payload.ownerId);
    const changes: AccountChanges = {
      name: payload.name,
      type: payload.type,
      currency: payload.currency,
      initialBalanceMinor:
        payload.initialBalance === undefined ? undefined : toMinorNumber(payload.initialBalance),
      archivedAt: payload.archived === undefined ? undefined : payload.archived ? new Date() : null,
      ownerId: payload.ownerId,
      color: payload.color,
      note: payload.note,
    };
    const updated = await this.accounts.update(workspaceId, id, changes);
    if (!updated) throw notFound('FINANCE_ACCOUNT_NOT_FOUND');

    return this.one(workspaceId, id);
  }
}
