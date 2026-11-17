import { currentMonth, shiftMonth, type SavingsOverviewDto } from '@homehub/shared';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Ledger } from '../../src/finance/ledger';
import { CRON, runScheduled } from '../../src/index';
import { AutoMovementsService } from '../../src/savings/auto.service';
import { SavingsRepository } from '../../src/savings/savings.repository';
import { call, createAccount, createMember, json, resetDb, type Member } from '../helpers';

/**
 * Automatic fund operations: idempotent runs, zero amounts (D-2), a failure between the movement
 * and its account operation (D-1) and cron isolation.
 */

beforeEach(async () => {
  await resetDb();
  await env.DB.batch(
    ['exchange_rates', 'asset_prices', 'planner_state', 'user_preferences'].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
  // A fresh price check: the cron does not fetch from CoinGecko.
  await env.DB.prepare(
    `INSERT INTO planner_state (key, value, updated_at) VALUES ('crypto.last_success_at', ?1, 0)`,
  )
    .bind(new Date().toISOString())
    .run();
});

afterEach(async () => {
  await env.DB.prepare('DROP TRIGGER IF EXISTS test_fail_auto_operation').run();
});

const NOW = currentMonth();
const START = shiftMonth(NOW, -2);
const autos = () =>
  new AutoMovementsService(env.DB, new SavingsRepository(env.DB), new Ledger(env.DB));

async function send<T>(member: Member, path: string, body?: unknown, method = 'POST') {
  return call<T>(path, { method, member, body: body === undefined ? undefined : json(body) });
}

async function ok<T>(promise: Promise<{ status: number; body: T }>): Promise<T> {
  const res = await promise;
  if (res.status >= 400) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

interface Fund {
  member: Member;
  accountId: string;
  potId: string;
  partId: string;
}

/** A fund with one part of 1 000 PLN that lives on an account of 5 000 PLN. */
async function fund(email = 'alice@example.com', member?: Member): Promise<Fund> {
  const m = member ?? (await createMember(email));
  const account = await createAccount(m, 'Счет', 'PLN', '5000');
  const created = await ok(
    send<SavingsOverviewDto>(m, `/api/savings/pots?month=${NOW}`, {
      name: 'Fund',
      kind: 'CASH',
      currency: 'PLN',
    }),
  );
  const pot = created.pots.find((p) => p.name === 'Fund');
  const partId = pot?.subaccounts[0]?.id;
  if (!pot || !partId) throw new Error('The fund has no part');
  await ok(
    send(
      m,
      `/api/savings/subaccounts/${partId}?month=${NOW}`,
      { accountId: account.id, balance: '1000' },
      'PATCH',
    ),
  );
  return { member: m, accountId: account.id, potId: pot.id, partId };
}

/** A monthly deposit of 100 from two months ago: three months are due (day 1). */
async function autoDeposit(f: Fund, type: 'DEPOSIT' | 'WITHDRAWAL' = 'DEPOSIT'): Promise<string> {
  const body = await ok(
    send<SavingsOverviewDto>(f.member, `/api/savings/subaccounts/${f.partId}/auto?month=${NOW}`, {
      type,
      amount: '100',
      day: 1,
      startMonth: START,
    }),
  );
  const part = body.pots.flatMap((p) => p.subaccounts).find((s) => s.id === f.partId);
  const rule = part?.autoRules[0];
  if (!rule) throw new Error('The rule was not created');
  if (type === 'DEPOSIT') await confirmMonths(f, rule.id);
  return rule.id;
}

async function confirmMonths(f: Fund, rule: string) {
  for (let month = START; month <= NOW; month = shiftMonth(month, 1))
    await ok(send(f.member, `/api/savings/auto/${rule}/confirm?month=${month}`));
}

async function counts(workspaceId: string) {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM savings_movements WHERE workspace_id = ?1 AND auto_rule_id IS NOT NULL) AS movements,
       (SELECT COUNT(*) FROM savings_movements WHERE workspace_id = ?1 AND auto_rule_id IS NOT NULL
          AND transaction_id IS NULL) AS without_operation,
       (SELECT COUNT(*) FROM transactions WHERE workspace_id = ?1
          AND system_kind IN ('FUND_AUTO_DEPOSIT', 'FUND_AUTO_WITHDRAWAL')) AS operations`,
  )
    .bind(workspaceId)
    .first<{ movements: number; without_operation: number; operations: number }>();
  if (!row) throw new Error('No counts');
  return row;
}

async function accountBalance(member: Member, accountId: string): Promise<string | undefined> {
  const accounts = await ok(call<{ id: string; balance: string }[]>('/api/accounts', { member }));
  return accounts.find((a) => a.id === accountId)?.balance;
}

/** Forgets the made months, so the rule is due again (as if the cron had not run yet). */
async function undoAutoRuns(workspaceId: string) {
  const made = await env.DB.prepare(
    'SELECT transaction_id FROM savings_movements WHERE workspace_id = ? AND auto_rule_id IS NOT NULL',
  )
    .bind(workspaceId)
    .all<{ transaction_id: string | null }>();
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM savings_movements WHERE workspace_id = ?1 AND auto_rule_id IS NOT NULL',
    ).bind(workspaceId),
    ...made.results.map((m) =>
      env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(m.transaction_id),
    ),
  ]);
}

/** Makes the account operation of automatic operations fail for one workspace. */
async function failAutoOperations(workspaceId: string) {
  await env.DB.prepare(
    `CREATE TRIGGER test_fail_auto_operation BEFORE INSERT ON transactions
     WHEN NEW.workspace_id = '${workspaceId}' AND NEW.system_kind LIKE 'FUND_AUTO%'
     BEGIN SELECT RAISE(ABORT, 'TEST_INJECTED_FAILURE'); END`,
  ).run();
}

const noFetch = async () => new Response('offline', { status: 503 });

async function setAmount(f: Fund, rule: string, month: string, amount: string, scope = 'MONTH') {
  return send(
    f.member,
    `/api/savings/auto/${rule}/amount?month=${NOW}`,
    { month, amount, scope },
    'PUT',
  );
}

describe('automatic fund operations: repeated runs', () => {
  it('makes each due month once, with exactly one account operation', async () => {
    const f = await fund();
    await autoDeposit(f);
    expect(await counts(f.member.workspaceId)).toEqual({
      movements: 3,
      without_operation: 0,
      operations: 3,
    });
    expect(await accountBalance(f.member, f.accountId)).toBe('5300.00');

    // Direct runs, page loads and the cron repeat nothing.
    expect(await autos().run(f.member.workspaceId)).toBe(0);
    await ok(call(`/api/savings?month=${NOW}`, { member: f.member }));
    await runScheduled(CRON.cleanup, env, noFetch);
    expect(await counts(f.member.workspaceId)).toEqual({
      movements: 3,
      without_operation: 0,
      operations: 3,
    });
    expect(await accountBalance(f.member, f.accountId)).toBe('5300.00');
  });

  it('reading the overview never makes a due movement (GET has no side effects)', async () => {
    const f = await fund();
    await autoDeposit(f);
    await undoAutoRuns(f.member.workspaceId);
    await ok(call(`/api/savings?month=${NOW}`, { member: f.member }));
    await ok(call(`/api/savings/wealth?month=${NOW}`, { member: f.member }));
    expect(await counts(f.member.workspaceId)).toMatchObject({ movements: 0, operations: 0 });
  });

  it('parallel confirmations still make each month once', async () => {
    const f = await fund();
    await autoDeposit(f);
    await undoAutoRuns(f.member.workspaceId);

    const rule = (await new SavingsRepository(env.DB).autos(f.member.workspaceId)).rules[0]!;
    await Promise.all([confirmMonths(f, rule.id), confirmMonths(f, rule.id)]);
    expect(await counts(f.member.workspaceId)).toEqual({
      movements: 3,
      without_operation: 0,
      operations: 3,
    });
    expect(await accountBalance(f.member, f.accountId)).toBe('5300.00');
  });
});

describe('automatic fund operations: amounts', () => {
  it('a zero amount for a month not made yet skips that month', async () => {
    const f = await fund();
    const rule = await autoDeposit(f);
    const res = await setAmount(f, rule, shiftMonth(NOW, 1), '0');
    expect(res.status).toBe(200);
    expect(await counts(f.member.workspaceId)).toMatchObject({ movements: 3, operations: 3 });
  });

  it('D-2: a zero amount for a month already made removes its movement and operation', async () => {
    const f = await fund();
    const rule = await autoDeposit(f);
    expect((await setAmount(f, rule, NOW, '0')).status).toBe(200);
    expect(await counts(f.member.workspaceId)).toEqual({
      movements: 2,
      without_operation: 0,
      operations: 2,
    });
    expect(await accountBalance(f.member, f.accountId)).toBe('5200.00');

    // Zeroing again changes nothing.
    expect((await setAmount(f, rule, NOW, '0')).status).toBe(200);
    expect(await counts(f.member.workspaceId)).toMatchObject({ movements: 2, operations: 2 });

    // Restoring the amount requires confirmation again.
    expect((await setAmount(f, rule, NOW, '150')).status).toBe(200);
    expect(await counts(f.member.workspaceId)).toMatchObject({ movements: 2 });
    await confirmMonths(f, rule);
    expect(await counts(f.member.workspaceId)).toEqual({
      movements: 3,
      without_operation: 0,
      operations: 3,
    });
    expect(await accountBalance(f.member, f.accountId)).toBe('5350.00');
  });

  it('a new amount «from this month on» changes the made movements and their operations', async () => {
    const f = await fund();
    const rule = await autoDeposit(f);
    expect((await setAmount(f, rule, shiftMonth(NOW, -1), '250', 'FORWARD')).status).toBe(200);
    // 100 (two months ago) + 250 + 250.
    expect(await accountBalance(f.member, f.accountId)).toBe('5600.00');
    const overview = await ok(
      call<SavingsOverviewDto>(`/api/savings?month=${NOW}`, { member: f.member }),
    );
    expect(overview.pots[0]?.balance).toBe('1600.00');

    // Zero from last month on: two movements and their operations go, one stays.
    expect((await setAmount(f, rule, shiftMonth(NOW, -1), '0', 'FORWARD')).status).toBe(200);
    expect(await counts(f.member.workspaceId)).toEqual({
      movements: 1,
      without_operation: 0,
      operations: 1,
    });
    expect(await accountBalance(f.member, f.accountId)).toBe('5100.00');
  });
});

describe('automatic fund operations: a failure between the steps', () => {
  it('D-1: a failed account operation writes nothing; the next run makes the month completely', async () => {
    const f = await fund();
    await autoDeposit(f);
    await undoAutoRuns(f.member.workspaceId);
    await failAutoOperations(f.member.workspaceId);

    const rule = (await new SavingsRepository(env.DB).autos(f.member.workspaceId)).rules[0]!;
    await expect(confirmMonths(f, rule.id)).rejects.toThrow();
    expect(await counts(f.member.workspaceId)).toEqual({
      movements: 0,
      without_operation: 0,
      operations: 0,
    });

    await env.DB.prepare('DROP TRIGGER test_fail_auto_operation').run();
    await confirmMonths(f, rule.id);
    expect(await counts(f.member.workspaceId)).toEqual({
      movements: 3,
      without_operation: 0,
      operations: 3,
    });
    expect(await accountBalance(f.member, f.accountId)).toBe('5300.00');
  });
});

describe('daily cron isolation', () => {
  for (const failing of ['first', 'second'] as const) {
    it(`a failing workspace (${failing}) does not stop the others or the price refresh`, async () => {
      const a = await fund('alice@example.com');
      const b = await fund('bob@example.com');
      await autoDeposit(a, 'WITHDRAWAL');
      await autoDeposit(b, 'WITHDRAWAL');
      await undoAutoRuns(a.member.workspaceId);
      await undoAutoRuns(b.member.workspaceId);
      const [broken, healthy] = failing === 'first' ? [a, b] : [b, a];
      await failAutoOperations(broken.member.workspaceId);

      // The failure is still reported (the cron invocation fails), after every step has run.
      await expect(runScheduled(CRON.cleanup, env, noFetch)).rejects.toThrow(
        /TEST_INJECTED_FAILURE/,
      );
      expect(await counts(healthy.member.workspaceId)).toEqual({
        movements: 3,
        without_operation: 0,
        operations: 3,
      });
      expect(await counts(broken.member.workspaceId)).toMatchObject({ movements: 0 });
      const attempt = await env.DB.prepare(
        "SELECT value FROM planner_state WHERE key = 'crypto.last_attempt_at'",
      ).first<{ value: string }>();
      expect(attempt?.value).toBeTruthy();
    });
  }
});
