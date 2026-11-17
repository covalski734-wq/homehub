import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { call, createMember, json, resetDb, type Member } from '../helpers';

beforeEach(async () => {
  await resetDb();
  await env.DB.batch(
    ['exchange_rates', 'asset_prices', 'planner_state', 'user_preferences'].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function send<T = any>(member: Member, path: string, body?: unknown, method = 'POST') {
  return call<T>(path, { method, member, body: body === undefined ? undefined : json(body) });
}

/**
 * USD at 4.00 PLN; BTC at 400 000 PLN (−1 % in 24 h) and NVIDIA xStock at 800 PLN, with a fresh
 * price check so nothing is fetched.
 */
async function seedPrices() {
  const today = new Date().toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO exchange_rates (currency, effective_date, rate_micros, table_no, fetched_at)
       VALUES ('USD', ?1, 4000000, '1/A/NBP', 0)`,
    ).bind(today),
    env.DB.prepare(
      `INSERT INTO asset_prices (asset, price_date, price_pln_micros, change_24h_bp, fetched_at)
       VALUES ('bitcoin', ?1, 400000000000, -100, 0), ('nvidia-xstock', ?1, 800000000, NULL, 0)`,
    ).bind(today),
    env.DB.prepare(
      `INSERT INTO planner_state (key, value, updated_at) VALUES ('crypto.last_success_at', ?1, 0)`,
    ).bind(new Date().toISOString()),
  ]);
}

const BTC = { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', image: null };
const NVDA = { id: 'nvidia-xstock', symbol: 'NVDAX', name: 'NVIDIA xStock' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const potNamed = (overview: any, name: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overview.pots.find((p: any) => p.name === name);

async function recurringIn(member: Member, month: string) {
  const res = await call<{ id: string; name: string; active: boolean; amount: string }[]>(
    `/api/planner/recurring?month=${month}`,
    { member },
  );
  return res.body.filter((r) => r.active);
}

describe('piggy banks', () => {
  it('keeps the balance of a pot; a withdrawal is returned through the next month planner', async () => {
    const alice = await createMember('alice@example.com');
    const created = await send(alice, '/api/savings/pots?month=2026-11', {
      name: 'Подушка',
      kind: 'CASH',
      currency: 'PLN',
      balance: '1000',
    });
    expect(created.status).toBe(201);
    const pot = potNamed(created.body, 'Подушка');
    expect(pot).toMatchObject({ balance: '1000.00', owed: '0.00', value: '1000.00' });

    const deposited = await send(alice, `/api/savings/pots/${pot.id}/movements?month=2026-11`, {
      type: 'DEPOSIT',
      amount: '500',
      date: '2026-11-05',
    });
    expect(deposited.status).toBe(201);
    expect(deposited.body).toMatchObject({ deposited: '500.00', total: '1500.00' });

    const tooMuch = await send(alice, `/api/savings/pots/${pot.id}/movements?month=2026-11`, {
      type: 'WITHDRAWAL',
      amount: '2000',
      date: '2026-11-10',
    });
    expect(tooMuch.status).toBe(422);

    const withdrawn = await send(alice, `/api/savings/pots/${pot.id}/movements?month=2026-11`, {
      type: 'WITHDRAWAL',
      amount: '300',
      date: '2026-11-10',
      note: 'Ремонт',
      repayMonth: '2026-12',
    });
    const after = potNamed(withdrawn.body, 'Подушка');
    expect(after).toMatchObject({ balance: '1200.00', owed: '300.00' });
    expect(withdrawn.body.owed).toBe('300.00');
    const withdrawal = after.movements[0];
    expect(withdrawal.repayment).toMatchObject({ month: '2026-12', returned: false });

    // The return is a required one-month payment of the next month only.
    expect(await recurringIn(alice, '2026-11')).toEqual([]);
    const [repay] = await recurringIn(alice, '2026-12');
    expect(repay).toMatchObject({ name: 'Вернуть в «Подушка»', amount: '300.00', active: true });
    expect(await recurringIn(alice, '2027-01')).toEqual([]);

    // Ticked off in the planner → back in the pot.
    const paid = await send(
      alice,
      `/api/planner/recurring/${repay!.id}/payment?month=2026-12`,
      { month: '2026-12', paid: true },
      'PUT',
    );
    expect(paid.status).toBe(200);
    const returned = await call(`/api/savings?month=2026-12`, { member: alice });
    expect(potNamed(returned.body, 'Подушка')).toMatchObject({ balance: '1500.00', owed: '0.00' });

    // Unticked here, then moved to January: December no longer has it.
    await send(
      alice,
      `/api/savings/movements/${withdrawal.id}/returned`,
      { returned: false },
      'PUT',
    );
    const moved = await send(
      alice,
      `/api/savings/movements/${withdrawal.id}/repay-month?month=2027-01`,
      { repayMonth: '2027-01' },
      'PUT',
    );
    expect(potNamed(moved.body, 'Подушка').movements[0].repayment.month).toBe('2027-01');
    expect(await recurringIn(alice, '2026-12')).toEqual([]);
    expect((await recurringIn(alice, '2027-01')).map((r) => r.amount)).toEqual(['300.00']);

    // Undoing the withdrawal removes its planner payment too.
    const undone = await send(
      alice,
      `/api/savings/movements/${withdrawal.id}`,
      undefined,
      'DELETE',
    );
    expect(potNamed(undone.body, 'Подушка')).toMatchObject({ balance: '1500.00', owed: '0.00' });
    expect(await recurringIn(alice, '2027-01')).toEqual([]);

    // Setting the actual balance of a part adjusts its opening one.
    const part = potNamed(undone.body, 'Подушка').subaccounts[0];
    const fixed = await send(
      alice,
      `/api/savings/subaccounts/${part.id}`,
      { balance: '1490,50' },
      'PATCH',
    );
    expect(potNamed(fixed.body, 'Подушка').balance).toBe('1490.50');
  });

  it('values a portfolio of coins and tokens in its currency', async () => {
    const alice = await createMember('alice@example.com');
    await seedPrices();
    const created = await send(alice, '/api/savings/pots', {
      name: 'Крипто',
      kind: 'PORTFOLIO',
      currency: 'USD',
    });
    const id = potNamed(created.body, 'Крипто').id;

    await send(alice, `/api/savings/pots/${id}/positions`, { asset: BTC, quantity: '0,5' });
    // The same asset again adds to the position.
    await send(alice, `/api/savings/pots/${id}/positions`, { asset: BTC, quantity: '0.25' });
    const byValue = await send(alice, `/api/savings/pots/${id}/positions`, {
      asset: NVDA,
      value: '100',
    });
    expect(byValue.status).toBe(201);
    const portfolio = potNamed(byValue.body, 'Крипто');
    expect(portfolio.positions).toEqual([
      expect.objectContaining({
        asset: expect.objectContaining({ id: 'bitcoin', symbol: 'BTC' }),
        quantity: '0.75',
        price: '100000.00',
        value: '75000.00',
        change24h: '-757.58',
      }),
      expect.objectContaining({ quantity: '0.5', price: '200.00', value: '100.00' }),
    ]);
    expect(portfolio).toMatchObject({ balance: '75100.00', value: '300400.00' });
    expect(byValue.body.total).toBe('300400.00');

    const nvda = portfolio.positions[1].id;
    const edited = await send(alice, `/api/savings/positions/${nvda}`, { quantity: '2' }, 'PATCH');
    expect(potNamed(edited.body, 'Крипто').balance).toBe('75400.00');

    const noMovements = await send(alice, `/api/savings/pots/${id}/movements`, {
      type: 'DEPOSIT',
      amount: '10',
      date: '2026-11-01',
    });
    expect(noMovements.status).toBe(422);
  });

  it("never touches another household's piggy banks", async () => {
    const alice = await createMember('alice@example.com');
    const bob = await createMember('bob@example.com');
    const created = await send(alice, '/api/savings/pots', {
      name: 'Подушка',
      kind: 'CASH',
      currency: 'PLN',
      balance: '100',
    });
    const id = potNamed(created.body, 'Подушка').id;

    expect((await call('/api/savings', { member: bob })).body.pots).toEqual([]);
    expect((await send(bob, `/api/savings/pots/${id}`, { name: 'Моя' }, 'PATCH')).status).toBe(404);
    expect(
      (
        await send(bob, `/api/savings/pots/${id}/movements`, {
          type: 'WITHDRAWAL',
          amount: '50',
          date: '2026-11-01',
        })
      ).status,
    ).toBe(404);
    expect((await send(bob, `/api/savings/pots/${id}`, undefined, 'DELETE')).status).toBe(404);
  });

  it('fetches prices of the assets in use and keeps the stored ones when the source fails', async () => {
    const alice = await createMember('alice@example.com');
    await seedPrices();
    const created = await send(alice, '/api/savings/pots', {
      name: 'Крипто',
      kind: 'PORTFOLIO',
      currency: 'USD',
    });
    const id = potNamed(created.body, 'Крипто').id;
    await send(alice, `/api/savings/pots/${id}/positions`, { asset: BTC, quantity: '1' });

    const requested: string[] = [];
    const refresh = (fetcher: (url: string) => Promise<Response>) =>
      createApp({
        fetcher: async (url) => {
          requested.push(url);
          return fetcher(url);
        },
      }).fetch(
        new Request('http://localhost/api/savings/prices/refresh', {
          method: 'POST',
          headers: {
            Cookie: alice.cookie,
            'X-CSRF-Token': alice.csrf,
            Origin: 'http://localhost:5173',
          },
        }),
        env,
      );
    const ok = await refresh(async () =>
      Response.json({ bitcoin: { pln: 412345.67, pln_24h_change: 2.5 }, unknown: {} }),
    );
    expect(ok.status).toBe(200);
    expect(requested[0]).toContain('ids=bitcoin&');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await ok.json()) as any;
    expect(body.prices.lastError).toBeNull();
    expect(potNamed(body, 'Крипто').positions[0]).toMatchObject({
      price: '103086.4175',
      value: '103086.42',
    });

    // The button works once per few minutes: nothing is sent right after a refresh.
    const tooSoon = await refresh(async () => Response.json({}));
    expect(tooSoon.status).toBe(503);
    expect(requested).toHaveLength(1);
    expect(body.prices.refreshAvailableAt).not.toBeNull();

    // Later CoinGecko answers 429 with Retry-After: the stored prices stay, nothing is retried early.
    await env.DB.prepare(
      `UPDATE planner_state SET value = '2000-01-01T00:00:00.000Z' WHERE key = 'crypto.last_attempt_at'`,
    ).run();
    const failed = await refresh(
      async () => new Response('busy', { status: 429, headers: { 'Retry-After': '600' } }),
    );
    expect(failed.status).toBe(503);
    expect(requested).toHaveLength(2);
    const after = await call('/api/savings', { member: alice });
    expect(after.body.prices).toMatchObject({ lastError: 'CoinGecko responded 429' });
    const wait = Date.parse(after.body.prices.retryAt) - Date.now();
    expect(wait).toBeGreaterThan(9 * 60_000);
    expect(wait).toBeLessThanOrEqual(10 * 60_000);
    expect(potNamed(after.body, 'Крипто').positions[0].value).toBe('103086.42');

    await env.DB.prepare(
      `UPDATE planner_state SET value = '2000-01-01T00:00:00.000Z' WHERE key = 'crypto.last_attempt_at'`,
    ).run();
    expect((await refresh(async () => Response.json({}))).status).toBe(503);
    expect(requested).toHaveLength(2);
  });

  it('backs off exponentially without Retry-After and caps the wait', async () => {
    const { backoffMs } = await import('../../src/savings/asset-prices');
    expect(backoffMs(1, null)).toBe(2 * 60_000);
    expect(backoffMs(3, null)).toBe(8 * 60_000);
    expect(backoffMs(20, null)).toBe(6 * 60 * 60_000);
    expect(backoffMs(1, '30')).toBe(60_000);
    expect(backoffMs(1, '99999')).toBe(6 * 60 * 60_000);
  });
});
