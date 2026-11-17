import { currentMonth, type SavingsOverviewDto } from '@homehub/shared';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  balances,
  call,
  categoryId,
  createAccount,
  createMember,
  json,
  resetDb,
  type Member,
} from '../helpers';

/**
 * Money under repetition and concurrency: idempotent retries, parallel withdrawals, repeated
 * reconciliations, a return ticked twice, and fund operations that only the fund may change.
 */

beforeEach(resetDb);

const NOW = currentMonth();
const TODAY = new Date().toISOString().slice(0, 10);

async function send<T>(member: Member, path: string, body: unknown, method = 'POST', key?: string) {
  return call<T>(path, {
    method,
    member,
    body: json(body),
    headers: key ? { 'Idempotency-Key': key } : undefined,
  });
}

/** A fund «Fund» whose only part holds 1 000 PLN on the account «Card» (5 000 PLN). */
async function fund(member: Member) {
  const account = await createAccount(member, 'Card', 'PLN', '5000');
  const created = await send<SavingsOverviewDto>(member, `/api/savings/pots?month=${NOW}`, {
    name: 'Fund',
    kind: 'CASH',
    currency: 'PLN',
  });
  const pot = created.body.pots[0];
  const partId = pot?.subaccounts[0]?.id;
  if (!pot || !partId) throw new Error('No fund part');
  await send(
    member,
    `/api/savings/subaccounts/${partId}?month=${NOW}`,
    {
      accountId: account.id,
      balance: '1000',
    },
    'PATCH',
  );
  return { accountId: account.id, potId: pot.id, partId };
}

async function partBalance(member: Member) {
  const overview = await call<SavingsOverviewDto>(`/api/savings?month=${NOW}`, { member });
  return overview.body.pots[0]?.subaccounts[0]?.balance;
}

async function count(sql: string, ...params: unknown[]) {
  const row = await env.DB.prepare(sql)
    .bind(...params)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe('idempotent writes', () => {
  it('a retried operation with the same key is written once and answered with the first response', async () => {
    const alice = await createMember('alice@example.com');
    const account = await createAccount(alice, 'Card', 'PLN', '100');
    const body = {
      type: 'EXPENSE',
      accountId: account.id,
      categoryId: await categoryId(alice.workspaceId, 'groceries'),
      amount: '10.00',
      occurredAt: TODAY,
      description: 'Bread',
    };
    const first = await send<{ id: string }>(
      alice,
      '/api/transactions',
      body,
      'POST',
      'retry-key-0001',
    );
    const again = await send<{ id: string }>(
      alice,
      '/api/transactions',
      body,
      'POST',
      'retry-key-0001',
    );
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(again.headers.get('Idempotent-Replayed')).toBe('true');
    expect((await balances(alice)).Card).toBe('90.00');

    // The same key for another request is refused, not replayed.
    const other = await send(
      alice,
      '/api/transactions',
      { ...body, amount: '20.00' },
      'POST',
      'retry-key-0001',
    );
    expect(other.status).toBe(422);
    expect(other.body).toMatchObject({ error: 'IDEMPOTENCY_KEY_REUSED' });
    expect((await balances(alice)).Card).toBe('90.00');
  });

  it('keys are per workspace: another household with the same key writes its own operation', async () => {
    const alice = await createMember('alice@example.com');
    const bob = await createMember('bob@example.com');
    for (const member of [alice, bob]) {
      const account = await createAccount(member, 'Card', 'PLN', '100');
      const res = await send(
        member,
        '/api/transactions',
        {
          type: 'EXPENSE',
          accountId: account.id,
          categoryId: await categoryId(member.workspaceId, 'groceries'),
          amount: '5.00',
          occurredAt: TODAY,
          description: '',
        },
        'POST',
        'shared-key-0001',
      );
      expect(res.status).toBe(201);
      expect(res.headers.get('Idempotent-Replayed')).toBeNull();
    }
  });
});

describe('parallel fund withdrawals', () => {
  it('two withdrawals that together exceed the part: one passes, one is refused, never negative', async () => {
    const alice = await createMember('alice@example.com');
    const f = await fund(alice);
    const withdraw = () =>
      send(alice, `/api/savings/pots/${f.potId}/movements?month=${NOW}`, {
        type: 'WITHDRAWAL',
        amount: '700',
        date: TODAY,
      });
    const results = await Promise.all([withdraw(), withdraw()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    const refused = results.find((r) => r.status === 422);
    expect(refused?.body).toMatchObject({
      error: 'SAVINGS_PART_NOT_ENOUGH',
      params: { amount: '300.00' },
    });
    expect(await partBalance(alice)).toBe('300.00');
    expect((await balances(alice)).Card).toBe('4300.00');
  });

  it('a corrected withdrawal still has to fit the part', async () => {
    const alice = await createMember('alice@example.com');
    const f = await fund(alice);
    const made = await send<SavingsOverviewDto>(
      alice,
      `/api/savings/pots/${f.potId}/movements?month=${NOW}`,
      {
        type: 'WITHDRAWAL',
        amount: '400',
        date: TODAY,
      },
    );
    const movement = made.body.pots[0]?.movements[0];
    if (!movement) throw new Error('No movement');
    const tooMuch = await send(
      alice,
      `/api/savings/movements/${movement.id}?month=${NOW}`,
      { amount: '1200' },
      'PATCH',
    );
    expect(tooMuch.status).toBe(422);
    const fits = await send(
      alice,
      `/api/savings/movements/${movement.id}?month=${NOW}`,
      { amount: '1000' },
      'PATCH',
    );
    expect(fits.status).toBe(200);
    expect(await partBalance(alice)).toBe('0.00');
    expect((await balances(alice)).Card).toBe('4000.00');
  });
});

describe('reconciliation', () => {
  it('a repeated or parallel reconciliation to the same balance adds one adjustment', async () => {
    const alice = await createMember('alice@example.com');
    const account = await createAccount(alice, 'Card', 'PLN', '100');
    const reconcile = () =>
      send(alice, `/api/accounts/${account.id}/reconcile`, { balance: '150', date: TODAY });
    const results = await Promise.all([reconcile(), reconcile()]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect((await reconcile()).status).toBe(200);
    expect((await balances(alice)).Card).toBe('150.00');
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM transactions WHERE workspace_id = ? AND system_kind = 'RECONCILIATION'",
        alice.workspaceId,
      ),
    ).toBe(1);
  });
});

describe('fund returns and fund operations', () => {
  it('a return ticked twice (or at once) puts the money back once', async () => {
    const alice = await createMember('alice@example.com');
    const f = await fund(alice);
    const made = await send<SavingsOverviewDto>(
      alice,
      `/api/savings/pots/${f.potId}/movements?month=${NOW}`,
      {
        type: 'WITHDRAWAL',
        amount: '200',
        date: TODAY,
        repayMonth: NOW,
      },
    );
    const movement = made.body.pots[0]?.movements[0];
    if (!movement) throw new Error('No movement');
    expect((await balances(alice)).Card).toBe('4800.00');
    const tick = () =>
      send(
        alice,
        `/api/savings/movements/${movement.id}/returned?month=${NOW}`,
        { returned: true },
        'PUT',
      );
    await Promise.all([tick(), tick()]);
    await tick();
    expect((await balances(alice)).Card).toBe('5000.00');
    expect(await partBalance(alice)).toBe('1000.00');
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM transactions WHERE workspace_id = ? AND system_kind = 'FUND_RETURN'",
        alice.workspaceId,
      ),
    ).toBe(1);

    // Unticking takes the put-back away again.
    await send(
      alice,
      `/api/savings/movements/${movement.id}/returned?month=${NOW}`,
      { returned: false },
      'PUT',
    );
    expect((await balances(alice)).Card).toBe('4800.00');
  });

  it('an operation a fund made can only be changed through the fund', async () => {
    const alice = await createMember('alice@example.com');
    const f = await fund(alice);
    const made = await send<SavingsOverviewDto>(
      alice,
      `/api/savings/pots/${f.potId}/movements?month=${NOW}`,
      {
        type: 'DEPOSIT',
        amount: '50',
        date: TODAY,
      },
    );
    const operation = made.body.pots[0]?.movements[0]?.transactionId;
    if (!operation) throw new Error('No operation');
    const removed = await call(`/api/transactions/${operation}`, {
      method: 'DELETE',
      member: alice,
    });
    expect(removed.status).toBe(409);
    expect(removed.body).toMatchObject({
      error: 'SAVINGS_FUND_OPERATION',
      params: { name: 'Fund' },
    });
    expect((await balances(alice)).Card).toBe('5050.00');

    const list = await call<{
      items: { id: string; systemKind: string | null; description: string }[];
    }>('/api/transactions?page=1&pageSize=50', { member: alice });
    const item = list.body.items.find((t) => t.id === operation);
    // Stored as a kind with parameters, not as a Russian sentence.
    expect(item).toMatchObject({ systemKind: 'FUND_DEPOSIT', description: '' });
  });
});

describe('workspace isolation of fund parts, rules and movements', () => {
  it('another household gets 404 for every fund write and changes nothing', async () => {
    const alice = await createMember('alice@example.com');
    const bob = await createMember('bob@example.com');
    const f = await fund(alice);
    await send(alice, `/api/savings/subaccounts/${f.partId}/auto?month=${NOW}`, {
      type: 'DEPOSIT',
      amount: '10',
      day: 28,
      startMonth: NOW,
    });
    const rule = await env.DB.prepare('SELECT id FROM fund_auto_rules WHERE workspace_id = ?')
      .bind(alice.workspaceId)
      .first<{ id: string }>();
    const before = await partBalance(alice);
    const attempts = await Promise.all([
      send(bob, `/api/savings/subaccounts/${f.partId}?month=${NOW}`, { balance: '1' }, 'PATCH'),
      send(bob, `/api/savings/subaccounts/${f.partId}/auto?month=${NOW}`, {
        type: 'DEPOSIT',
        amount: '10',
        day: 1,
        startMonth: NOW,
      }),
      send(
        bob,
        `/api/savings/auto/${rule?.id}/amount?month=${NOW}`,
        { month: NOW, amount: '0', scope: 'MONTH' },
        'PUT',
      ),
      call(`/api/savings/auto/${rule?.id}?month=${NOW}`, { method: 'DELETE', member: bob }),
      send(bob, `/api/savings/pots/${f.potId}/movements?month=${NOW}`, {
        type: 'WITHDRAWAL',
        amount: '1',
        date: TODAY,
        subaccountId: f.partId,
      }),
      call(`/api/savings/pots/${f.potId}?month=${NOW}`, { method: 'DELETE', member: bob }),
    ]);
    expect(attempts.map((a) => a.status)).toEqual([404, 404, 404, 404, 404, 404]);
    expect(await partBalance(alice)).toBe(before);
    expect(
      await count(
        'SELECT COUNT(*) AS n FROM fund_auto_rules WHERE workspace_id = ?',
        alice.workspaceId,
      ),
    ).toBe(1);
  });
});
