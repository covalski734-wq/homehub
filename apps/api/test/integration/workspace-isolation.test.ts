import { currentMonth } from '@homehub/shared';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { call, createAccount, createMember, json, resetDb, type Member } from '../helpers';

/**
 * Workspace isolation of the household resources added after the first release (fund parts,
 * automatic rules, movements, positions, members, shares, scenarios). Most of these tables have
 * no composite (id, workspace_id) foreign keys, so the service checks are the only barrier: every
 * foreign id must answer 404 (or be rejected) and leave the owner's data exactly as it was.
 */

const M = currentMonth();

beforeEach(async () => {
  await resetDb();
  await env.DB.batch(
    ['exchange_rates', 'asset_prices', 'planner_state', 'user_preferences'].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
  const today = new Date().toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO asset_prices (asset, price_date, price_pln_micros, change_24h_bp, fetched_at)
       VALUES ('bitcoin', ?1, 400000000000, NULL, 0)`,
    ).bind(today),
    env.DB.prepare(
      `INSERT INTO planner_state (key, value, updated_at) VALUES ('crypto.last_success_at', ?1, 0)`,
    ).bind(new Date().toISOString()),
  ]);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function send<T = any>(member: Member, path: string, body?: unknown, method = 'POST') {
  return call<T>(path, { method, member, body: body === undefined ? undefined : json(body) });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ok<T = any>(promise: Promise<{ status: number; body: T }>): Promise<T> {
  const res = await promise;
  if (res.status >= 400) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Everything Alice's household owns, as Alice sees it. */
async function snapshot(alice: Member) {
  const [savings, wealth, members, accounts, planner, scenarios] = await Promise.all(
    [
      `/api/savings?month=${M}`,
      `/api/savings/wealth?month=${M}`,
      '/api/members',
      '/api/accounts',
      `/api/planner/months/${M}`,
      `/api/scenarios?from=${M}&months=3`,
    ].map((path) => ok(call(path, { member: alice }))),
  );
  return { savings, wealth, members, accounts, planner, scenarios };
}

async function aliceHousehold() {
  const alice = await createMember('alice@example.com');
  const account = await createAccount(alice, 'Alice card', 'PLN', '5000');
  const members = await ok(send(alice, '/api/members', { name: 'Алиса', color: '#8b5cf6' }));
  const member = members.find((m: { name: string }) => m.name === 'Алиса');

  const created = await ok(
    send(alice, `/api/savings/pots?month=${M}`, { name: 'Fund', kind: 'CASH', currency: 'PLN' }),
  );
  const pot = created.pots.find((p: { name: string }) => p.name === 'Fund');
  const part = pot.subaccounts[0].id as string;
  await ok(
    send(
      alice,
      `/api/savings/subaccounts/${part}?month=${M}`,
      { accountId: account.id, balance: '1000' },
      'PATCH',
    ),
  );
  const withAuto = await ok(
    send(alice, `/api/savings/subaccounts/${part}/auto?month=${M}`, {
      type: 'DEPOSIT',
      amount: '100',
      day: 28,
      startMonth: M,
    }),
  );
  const autoRule = withAuto.pots
    .flatMap((p: { subaccounts: unknown[] }) => p.subaccounts)
    .find((s: { id: string }) => s.id === part).autoRules[0].id as string;
  const moved = await ok(
    send(alice, `/api/savings/pots/${pot.id}/movements?month=${M}`, {
      type: 'WITHDRAWAL',
      amount: '50',
      date: `${M}-01`,
      subaccountId: part,
    }),
  );
  const movement = moved.pots.find((p: { id: string }) => p.id === pot.id).movements[0]
    .id as string;

  const portfolio = await ok(
    send(alice, `/api/savings/pots?month=${M}`, {
      name: 'Crypto',
      kind: 'PORTFOLIO',
      currency: 'PLN',
    }),
  );
  const portfolioId = portfolio.pots.find((p: { name: string }) => p.name === 'Crypto').id;
  const withPosition = await ok(
    send(alice, `/api/savings/pots/${portfolioId}/positions`, {
      asset: { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', image: null },
      quantity: '1',
    }),
  );
  const position = withPosition.pots.find((p: { id: string }) => p.id === portfolioId).positions[0]
    .id as string;

  const rent = await ok(
    send(alice, `/api/planner/recurring?month=${M}`, {
      name: 'Rent',
      amount: '2000',
      startMonth: M,
    }),
  );

  return {
    alice,
    account: account.id,
    member: member.id as string,
    pot: pot.id as string,
    part,
    autoRule,
    movement,
    position,
    rent: rent.id as string,
  };
}

describe('workspace isolation of household resources', () => {
  it("another household cannot read, change or delete Alice's funds and members", async () => {
    const a = await aliceHousehold();
    const before = await snapshot(a.alice);
    const bob = await createMember('bob@example.com');

    // Bob sees nothing of Alice.
    expect((await ok(call(`/api/savings?month=${M}`, { member: bob }))).pots).toEqual([]);
    expect(
      (await ok(call('/api/members', { member: bob }))).map((m: { name: string }) => m.name),
    ).not.toContain('Алиса');
    expect((await call(`/api/savings/pots/${a.pot}/movements`, { member: bob })).status).toBe(404);

    const attempts: [string, string, unknown][] = [
      ['PATCH', `/api/savings/subaccounts/${a.part}`, { name: 'Bob' }],
      ['DELETE', `/api/savings/subaccounts/${a.part}`, undefined],
      [
        'PUT',
        `/api/savings/subaccounts/${a.part}/rule`,
        { mode: 'FIXED', amount: '10', startMonth: M },
      ],
      ['DELETE', `/api/savings/subaccounts/${a.part}/rule`, undefined],
      ['PUT', `/api/savings/subaccounts/${a.part}/plan`, { month: M, amount: '10' }],
      [
        'POST',
        `/api/savings/subaccounts/${a.part}/auto`,
        { type: 'WITHDRAWAL', amount: '10', day: 1, startMonth: M },
      ],
      ['PATCH', `/api/savings/auto/${a.autoRule}`, { day: 2 }],
      ['PUT', `/api/savings/auto/${a.autoRule}/amount`, { month: M, amount: '1', scope: 'MONTH' }],
      ['DELETE', `/api/savings/auto/${a.autoRule}`, undefined],
      ['PATCH', `/api/savings/movements/${a.movement}`, { amount: '1' }],
      ['PUT', `/api/savings/movements/${a.movement}/returned`, { returned: true }],
      ['PUT', `/api/savings/movements/${a.movement}/repay-month`, { repayMonth: M }],
      ['DELETE', `/api/savings/movements/${a.movement}`, undefined],
      ['PATCH', `/api/savings/positions/${a.position}`, { quantity: '5' }],
      ['DELETE', `/api/savings/positions/${a.position}`, undefined],
      ['POST', `/api/savings/pots/${a.pot}/subaccounts`, { name: 'Bob part' }],
      ['PATCH', `/api/members/${a.member}`, { name: 'Bob' }],
      ['PUT', `/api/planner/shares/${a.rent}?month=${M}`, { shares: [] }],
    ];
    // The bodies are valid, so every answer comes from the ownership lookup: 404, never 2xx/5xx.
    const unexpected: string[] = [];
    for (const [method, path, body] of attempts) {
      const res = await send(
        bob,
        `${path}${path.includes('?') ? '' : `?month=${M}`}`,
        body,
        method,
      );
      if (res.status !== 404)
        unexpected.push(`${method} ${path.replace(/[0-9a-f-]{36}/g, ':id')} → ${res.status}`);
    }
    expect(unexpected).toEqual([]);

    expect(await snapshot(a.alice)).toEqual(before);
  });

  it("another household cannot attach Alice's account or member to its own fund", async () => {
    const a = await aliceHousehold();
    const before = await snapshot(a.alice);
    const bob = await createMember('bob@example.com');
    const created = await ok(
      send(bob, `/api/savings/pots?month=${M}`, {
        name: 'Bob fund',
        kind: 'CASH',
        currency: 'PLN',
      }),
    );
    const bobPart = created.pots[0].subaccounts[0].id;

    const attach = await send(
      bob,
      `/api/savings/subaccounts/${bobPart}?month=${M}`,
      { accountId: a.account },
      'PATCH',
    );
    const own = await send(
      bob,
      `/api/savings/subaccounts/${bobPart}?month=${M}`,
      { ownerId: a.member },
      'PATCH',
    );
    const newPart = await send(
      bob,
      `/api/savings/pots/${created.pots[0].id}/subaccounts?month=${M}`,
      {
        name: 'Stolen',
        accountId: a.account,
        ownerId: a.member,
      },
    );
    for (const res of [attach, own, newPart]) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    const bobPot = (await ok(call(`/api/savings?month=${M}`, { member: bob }))).pots[0];
    expect(bobPot.subaccounts).toHaveLength(1);
    expect(bobPot.subaccounts[0]).toMatchObject({ accountId: null, ownerId: null });
    expect(await snapshot(a.alice)).toEqual(before);
  });

  it("scenario settings of another household do not change Alice's scenarios", async () => {
    const a = await aliceHousehold();
    const before = await snapshot(a.alice);
    const bob = await createMember('bob@example.com');
    await ok(
      send(
        bob,
        `/api/scenarios?from=${M}&months=3`,
        { kind: 'PESSIMISTIC', income: '-90', expenses: '50' },
        'PUT',
      ),
    );
    await ok(
      send(
        bob,
        `/api/scenarios/months?from=${M}&months=3`,
        { kind: 'OPTIMISTIC', month: M, income: '50', expenses: '0' },
        'PUT',
      ),
    );
    expect(await snapshot(a.alice)).toEqual(before);
  });
});
