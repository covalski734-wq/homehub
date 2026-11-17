/**
 * HTTP-level tests of the Worker against a local D1 database inside workerd.
 * Ported one-to-one from the former NestJS/PostgreSQL integration suite.
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { call, categoryId, createAccount, createMember, json, resetDb } from '../helpers';

beforeEach(resetDb);

describe('authentication', () => {
  it('serves health without a session', async () => {
    const res = await call('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
  });

  it.each([
    '/api/auth/me',
    '/api/accounts',
    '/api/transactions',
    '/api/categories',
    '/api/budgets?month=2026-10',
  ])('rejects %s without a session', async (url) => {
    expect((await call(url)).status).toBe(401);
  });

  it('rejects a forged session cookie', async () => {
    const res = await call('/api/accounts', { headers: { Cookie: 'hh_session=forged' } });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('SESSION_EXPIRED');
  });

  it('rejects and deletes an expired session', async () => {
    const member = await createMember('alice@example.com', undefined, -1000);
    const res = await call('/api/auth/me', { member });
    expect(res.status).toBe(401);
    const { count } = (await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions').first<{
      count: number;
    }>())!;
    expect(count).toBe(0);
  });

  it('rejects a session of an email that is not on the allowlist', async () => {
    const member = await createMember('mallory@example.com');
    const res = await call('/api/accounts', { member });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('ACCESS_REVOKED');
  });

  it('returns the profile and CSRF token for a valid session', async () => {
    const member = await createMember('alice@example.com');
    const res = await call('/api/auth/me', { member });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user: { email: 'alice@example.com' },
      csrfToken: member.csrf,
    });
  });

  it('logs out by deleting the server session', async () => {
    const member = await createMember('alice@example.com');
    expect((await call('/api/auth/logout', { method: 'POST', member })).status).toBe(204);
    expect((await call('/api/auth/me', { member })).status).toBe(401);
  });

  it('answers unknown API routes with a JSON 404', async () => {
    const res = await call('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ statusCode: 404, error: 'NOT_FOUND' });
  });

  it('sends security headers on API responses', async () => {
    const res = await call('/api/health');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('CSRF protection', () => {
  const account = json({ name: 'Card', type: 'CARD', currency: 'RUB' });

  it('rejects mutations without the CSRF header', async () => {
    const member = await createMember('alice@example.com');
    const res = await call('/api/accounts', { method: 'POST', member, csrf: null, body: account });
    expect(res.status).toBe(403);
  });

  it('rejects mutations from a foreign origin', async () => {
    const member = await createMember('alice@example.com');
    const res = await call('/api/accounts', {
      method: 'POST',
      member,
      origin: 'https://evil.example',
      body: account,
    });
    expect(res.status).toBe(403);
  });

  it('does not accept another session CSRF token', async () => {
    const alice = await createMember('alice@example.com');
    const bob = await createMember('bob@example.com', alice.workspaceId);
    const res = await call('/api/accounts', {
      method: 'POST',
      member: alice,
      csrf: bob.csrf,
      body: account,
    });
    expect(res.status).toBe(403);
  });
});

describe('workspace isolation', () => {
  it('shares data between members of the same workspace', async () => {
    const alice = await createMember('alice@example.com');
    const bob = await createMember('bob@example.com', alice.workspaceId);
    await createAccount(alice, 'Общая карта');
    expect((await call('/api/accounts', { member: bob })).body).toHaveLength(1);
  });

  it('never exposes or modifies data of another workspace', async () => {
    const alice = await createMember('alice@example.com');
    const eve = await createMember('eve@example.com');
    const account = await createAccount(alice, 'Alice card');
    const created = await call('/api/transactions', {
      method: 'POST',
      member: alice,
      body: json({
        type: 'EXPENSE',
        accountId: account.id,
        categoryId: await categoryId(alice.workspaceId, 'groceries'),
        amount: '100',
        occurredAt: '2026-10-01',
      }),
    });
    expect(created.status).toBe(201);
    const txId = created.body.id as string;
    const eveGroceries = await categoryId(eve.workspaceId, 'groceries');

    expect((await call('/api/accounts', { member: eve })).body).toEqual([]);
    expect((await call('/api/transactions', { member: eve })).body.total).toBe(0);
    expect(
      (
        await call(`/api/accounts/${account.id}`, {
          method: 'PATCH',
          member: eve,
          body: json({ name: 'pwned' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(`/api/transactions/${txId}`, { method: 'DELETE', member: eve })).status,
    ).toBe(404);

    const foreignOperation = json({
      type: 'EXPENSE',
      accountId: account.id,
      categoryId: eveGroceries,
      amount: '1',
      occurredAt: '2026-10-01',
    });
    expect(
      (
        await call(`/api/transactions/${txId}`, {
          method: 'PUT',
          member: eve,
          body: foreignOperation,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call('/api/transactions', { method: 'POST', member: eve, body: foreignOperation }))
        .status,
    ).toBe(422);

    const stillThere = await env.DB.prepare('SELECT amount_minor FROM transactions WHERE id = ?1')
      .bind(txId)
      .first<{ amount_minor: number }>();
    expect(stillThere?.amount_minor).toBe(10000);
  });

  it('rejects a category of another workspace', async () => {
    const alice = await createMember('alice@example.com');
    const eve = await createMember('eve@example.com');
    const account = await createAccount(alice, 'Card');
    const res = await call('/api/transactions', {
      method: 'POST',
      member: alice,
      body: json({
        type: 'EXPENSE',
        accountId: account.id,
        categoryId: await categoryId(eve.workspaceId, 'groceries'),
        amount: '10',
        occurredAt: '2026-10-01',
      }),
    });
    expect(res.status).toBe(422);
  });

  it('cannot reference a foreign account even when bypassing the API (composite FK)', async () => {
    const alice = await createMember('alice@example.com');
    const eve = await createMember('eve@example.com');
    const eveAccount = await createAccount(eve, 'Eve card');
    const insert = env.DB.prepare(
      `INSERT INTO transactions (id, workspace_id, account_id, category_id, created_by_id, type, amount_minor, currency, occurred_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'EXPENSE', 100, 'RUB', '2026-10-01', 0, 0)`,
    ).bind(
      crypto.randomUUID(),
      alice.workspaceId,
      eveAccount.id,
      await categoryId(alice.workspaceId, 'groceries'),
      alice.userId,
    );
    await expect(insert.run()).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe('finance', () => {
  it('validates input with shared schemas', async () => {
    const alice = await createMember('alice@example.com');
    const res = await call('/api/transactions', {
      method: 'POST',
      member: alice,
      body: json({ type: 'EXPENSE', amount: '-5' }),
    });
    expect(res.status).toBe(400);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it('rejects malformed JSON and ids', async () => {
    const alice = await createMember('alice@example.com');
    expect(
      (await call('/api/transactions', { method: 'POST', member: alice, body: '{' })).status,
    ).toBe(400);
    expect(
      (await call('/api/transactions/not-a-uuid', { method: 'DELETE', member: alice })).status,
    ).toBe(400);
  });

  it('excludes transfers from income/expense and keeps currencies separate', async () => {
    const alice = await createMember('alice@example.com');
    const card = await createAccount(alice, 'Card', 'RUB', '1000');
    const savings = await createAccount(alice, 'Savings', 'RUB');
    const usd = await createAccount(alice, 'USD cash', 'USD');
    const salary = await categoryId(alice.workspaceId, 'salary');
    const food = await categoryId(alice.workspaceId, 'groceries');

    const ops = [
      {
        type: 'INCOME',
        accountId: card.id,
        categoryId: salary,
        amount: '50000',
        occurredAt: '2026-10-01',
      },
      {
        type: 'EXPENSE',
        accountId: card.id,
        categoryId: food,
        amount: '1500.50',
        occurredAt: '2026-10-02',
      },
      {
        type: 'TRANSFER',
        accountId: card.id,
        toAccountId: savings.id,
        amount: '20000',
        occurredAt: '2026-10-03',
      },
      {
        type: 'EXPENSE',
        accountId: usd.id,
        categoryId: food,
        amount: '12.30',
        occurredAt: '2026-10-04',
      },
      {
        type: 'EXPENSE',
        accountId: card.id,
        categoryId: food,
        amount: '999',
        occurredAt: '2026-09-30',
      },
    ];
    for (const op of ops) {
      expect(
        (await call('/api/transactions', { method: 'POST', member: alice, body: json(op) })).status,
      ).toBe(201);
    }

    const summary = await call('/api/finance/summary?month=2026-10', { member: alice });
    expect(summary.status).toBe(200);
    expect(summary.body.totals).toEqual([
      { currency: 'RUB', income: '50000.00', expense: '1500.50', net: '48499.50' },
      { currency: 'USD', income: '0.00', expense: '12.30', net: '-12.30' },
    ]);
    expect(summary.body.balances).toEqual([
      { currency: 'RUB', total: '48500.50' },
      { currency: 'USD', total: '-12.30' },
    ]);
    expect(summary.body.trend).toHaveLength(12);
    expect(summary.body.byCategory[0]).toMatchObject({
      currency: 'RUB',
      amount: '1500.50',
      share: 1,
    });

    const accounts = await call<{ name: string; balance: string }[]>('/api/accounts', {
      member: alice,
    });
    expect(Object.fromEntries(accounts.body.map((a) => [a.name, a.balance]))).toEqual({
      Card: '28500.50',
      Savings: '20000.00',
      'USD cash': '-12.30',
    });
    expect((await call('/api/accounts/totals', { member: alice })).body).toEqual(
      summary.body.balances,
    );

    const october = await call('/api/transactions?month=2026-10&type=EXPENSE', { member: alice });
    expect(october.body.total).toBe(2);
    const bySavings = await call(`/api/transactions?accountId=${savings.id}`, { member: alice });
    expect(bySavings.body.items.map((t: { type: string }) => t.type)).toEqual(['TRANSFER']);
  });

  it('requires the credited amount for cross-currency transfers', async () => {
    const alice = await createMember('alice@example.com');
    const rub = await createAccount(alice, 'RUB', 'RUB');
    const usd = await createAccount(alice, 'USD', 'USD');
    const base = {
      type: 'TRANSFER',
      accountId: rub.id,
      toAccountId: usd.id,
      amount: '9000',
      occurredAt: '2026-10-05',
    };
    expect(
      (await call('/api/transactions', { method: 'POST', member: alice, body: json(base) })).status,
    ).toBe(422);
    const ok = await call('/api/transactions', {
      method: 'POST',
      member: alice,
      body: json({ ...base, toAmount: '100' }),
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ currency: 'RUB', toAmount: '100.00', toCurrency: 'USD' });
  });

  it('paginates and sorts transactions', async () => {
    const alice = await createMember('alice@example.com');
    const card = await createAccount(alice, 'Card');
    const food = await categoryId(alice.workspaceId, 'groceries');
    for (const amount of ['10', '30', '20']) {
      await call('/api/transactions', {
        method: 'POST',
        member: alice,
        body: json({
          type: 'EXPENSE',
          accountId: card.id,
          categoryId: food,
          amount,
          occurredAt: '2026-10-01',
        }),
      });
    }
    const res = await call('/api/transactions?sortBy=amount&sortDir=desc&pageSize=2&page=1', {
      member: alice,
    });
    expect(res.body.total).toBe(3);
    expect(res.body.items.map((t: { amount: string }) => t.amount)).toEqual(['30.00', '20.00']);
    // Regression guard: joined columns with equal names (id, name) must map to the right relation.
    expect(res.body.items[0]).toMatchObject({
      account: { id: card.id, name: 'Card' },
      category: { id: food, name: 'Продукты', color: '#ea580c' },
      createdBy: { id: alice.userId, email: 'alice@example.com' },
      toAccount: null,
    });
    const second = await call('/api/transactions?sortBy=amount&sortDir=desc&pageSize=2&page=2', {
      member: alice,
    });
    expect(second.body.items.map((t: { amount: string }) => t.amount)).toEqual(['10.00']);
  });

  it('updates and deletes an operation with the full DTO shape', async () => {
    const alice = await createMember('alice@example.com');
    const card = await createAccount(alice, 'Card');
    const food = await categoryId(alice.workspaceId, 'groceries');
    const cafe = await categoryId(alice.workspaceId, 'cafe');
    const created = await call('/api/transactions', {
      method: 'POST',
      member: alice,
      body: json({
        type: 'EXPENSE',
        accountId: card.id,
        categoryId: food,
        amount: '10,5',
        occurredAt: '2026-10-01',
      }),
    });
    expect(created.body).toMatchObject({
      amount: '10.50',
      currency: 'RUB',
      account: { id: card.id, name: 'Card' },
      toAccount: null,
      category: { id: food, name: 'Продукты' },
      createdBy: { email: 'alice@example.com' },
      occurredAt: '2026-10-01',
    });
    const updated = await call(`/api/transactions/${created.body.id}`, {
      method: 'PUT',
      member: alice,
      body: json({
        type: 'EXPENSE',
        accountId: card.id,
        categoryId: cafe,
        amount: '99.99',
        description: 'Обед',
        occurredAt: '2026-10-02',
      }),
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      amount: '99.99',
      description: 'Обед',
      category: { id: cafe },
    });
    expect(
      (await call(`/api/transactions/${created.body.id}`, { method: 'DELETE', member: alice }))
        .status,
    ).toBe(204);
    expect(
      (await call(`/api/transactions/${created.body.id}`, { method: 'DELETE', member: alice }))
        .status,
    ).toBe(404);
  });

  it('archives accounts and blocks new operations on them', async () => {
    const alice = await createMember('alice@example.com');
    const card = await createAccount(alice, 'Card');
    const archived = await call(`/api/accounts/${card.id}`, {
      method: 'PATCH',
      member: alice,
      body: json({ archived: true }),
    });
    expect(archived.body.archived).toBe(true);
    const res = await call('/api/transactions', {
      method: 'POST',
      member: alice,
      body: json({
        type: 'EXPENSE',
        accountId: card.id,
        categoryId: await categoryId(alice.workspaceId, 'groceries'),
        amount: '1',
        occurredAt: '2026-10-01',
      }),
    });
    expect(res.status).toBe(422);
  });

  it('tracks budgets and copies them to another month atomically', async () => {
    const alice = await createMember('alice@example.com');
    const card = await createAccount(alice, 'Card');
    const food = await categoryId(alice.workspaceId, 'groceries');
    const salary = await categoryId(alice.workspaceId, 'salary');
    await call('/api/transactions', {
      method: 'POST',
      member: alice,
      body: json({
        type: 'EXPENSE',
        accountId: card.id,
        categoryId: food,
        amount: '750',
        occurredAt: '2026-10-10',
      }),
    });

    const upsert = await call('/api/budgets', {
      method: 'PUT',
      member: alice,
      body: json({ month: '2026-10', categoryId: food, currency: 'RUB', limit: '1000' }),
    });
    expect(upsert.status).toBe(200);
    expect(upsert.body).toMatchObject({ spent: '750.00', remaining: '250.00', progress: 0.75 });

    const changed = await call('/api/budgets', {
      method: 'PUT',
      member: alice,
      body: json({ month: '2026-10', categoryId: food, currency: 'RUB', limit: '500' }),
    });
    expect(changed.body).toMatchObject({
      id: upsert.body.id,
      limit: '500.00',
      remaining: '-250.00',
      progress: 1.5,
    });

    const incomeBudget = await call('/api/budgets', {
      method: 'PUT',
      member: alice,
      body: json({ month: '2026-10', categoryId: salary, currency: 'RUB', limit: '1000' }),
    });
    expect(incomeBudget.status).toBe(422);

    const copy = await call('/api/budgets/copy', {
      method: 'POST',
      member: alice,
      body: json({ fromMonth: '2026-10', toMonth: '2026-11' }),
    });
    expect(copy.status).toBe(201);
    expect(copy.body).toEqual({ copied: 1 });
    const november = await call('/api/budgets?month=2026-11', { member: alice });
    expect(november.body).toHaveLength(1);
    expect(november.body[0]).toMatchObject({ limit: '500.00', spent: '0.00' });

    expect(
      (await call(`/api/budgets/${november.body[0].id}`, { method: 'DELETE', member: alice }))
        .status,
    ).toBe(204);
  });

  it('prevents changing the currency of an account with operations', async () => {
    const alice = await createMember('alice@example.com');
    const card = await createAccount(alice, 'Card');
    expect(
      (
        await call(`/api/accounts/${card.id}`, {
          method: 'PATCH',
          member: alice,
          body: json({ currency: 'EUR' }),
        })
      ).status,
    ).toBe(200);
    await call('/api/transactions', {
      method: 'POST',
      member: alice,
      body: json({
        type: 'INCOME',
        accountId: card.id,
        categoryId: await categoryId(alice.workspaceId, 'salary'),
        amount: '1',
        occurredAt: '2026-10-01',
      }),
    });
    const res = await call(`/api/accounts/${card.id}`, {
      method: 'PATCH',
      member: alice,
      body: json({ currency: 'USD' }),
    });
    expect(res.status).toBe(409);
    expect(
      (
        await call(`/api/accounts/${card.id}`, {
          method: 'PATCH',
          member: alice,
          body: json({ name: 'Renamed' }),
        })
      ).status,
    ).toBe(200);
  });
});
