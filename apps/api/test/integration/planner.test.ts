import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { CRON, runScheduled } from '../../src/index';
import { call, createMember, json, resetDb, type Member } from '../helpers';

beforeEach(async () => {
  await resetDb();
  await env.DB.batch(
    ['exchange_rates', 'planner_state', 'user_preferences'].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
});

const P = '/api/planner';

describe('monthly editing and payment checkmarks', () => {
  it('defaults amount edits to one month, preserves future overrides and prior history', async () => {
    const alice = await createMember('alice@example.com');
    for (const kind of ['incomes', 'recurring']) {
      const created = await post(alice, `${P}/${kind}?month=2026-07`, {
        name: kind,
        amount: '100',
        startMonth: '2026-07',
      });
      expect(created.status).toBe(201);
      const id = created.body.id;
      const value = async (month: string) => {
        const response = await call(`${P}/${kind}?month=${month}`, { member: alice });
        const row = response.body.find((r: { id: string }) => r.id === id);
        return row.amount ?? row.gross;
      };
      await post(alice, `${P}/${kind}/${id}/amount`, { month: '2026-08', amount: '120' }, 'PUT');
      expect(await value('2026-07')).toBe('100.00');
      expect(await value('2026-08')).toBe('120.00');
      expect(await value('2026-09')).toBe('100.00');
      await post(alice, `${P}/${kind}/${id}/amount`, { month: '2026-10', amount: '0' }, 'PUT');
      await post(
        alice,
        `${P}/${kind}/${id}/amount`,
        { month: '2026-08', amount: '150', scope: 'FORWARD' },
        'PUT',
      );
      expect(await value('2026-07')).toBe('100.00');
      expect(await value('2026-08')).toBe('150.00');
      expect(await value('2026-09')).toBe('150.00');
      expect(await value('2026-10')).toBe('0.00');
      expect(await value('2026-11')).toBe('150.00');
    }
  });

  it('creates one-month and ongoing items with explicit periods', async () => {
    const alice = await createMember('alice@example.com');
    for (const kind of ['incomes', 'recurring']) {
      const once = await post(alice, `${P}/${kind}?month=2026-10`, {
        name: 'Разово',
        amount: '100',
        startMonth: '2026-10',
        endMonth: '2026-10',
      });
      const ongoing = await post(alice, `${P}/${kind}?month=2026-10`, {
        name: 'Ежемесячно',
        amount: '200',
        startMonth: '2026-10',
      });
      expect(once.status).toBe(201);
      expect(ongoing.status).toBe(201);
      const rows = (await call(`${P}/${kind}?month=2026-11`, { member: alice })).body;
      expect(rows.find((r: { id: string }) => r.id === once.body.id).active).toBe(false);
      expect(rows.find((r: { id: string }) => r.id === ongoing.body.id).active).toBe(true);
    }
  });

  it('moves a payment between groups without changing identity, budget or payment history', async () => {
    const alice = await createMember('alice@example.com');
    const created = await post(alice, `${P}/recurring?month=2026-10`, {
      name: 'Аренда',
      amount: '3000',
      startMonth: '2026-07',
      isRequired: true,
    });
    const id = created.body.id;
    expect(created.body).toMatchObject({ isRequired: true, paid: false });
    const before = (await call(`${P}/months/2026-10`, { member: alice })).body.totals;
    const paid = await post(
      alice,
      `${P}/recurring/${id}/payment`,
      { month: '2026-10', paid: true },
      'PUT',
    );
    expect(paid.body).toMatchObject({ id, paid: true });
    const moved = await post(
      alice,
      `${P}/recurring/${id}?month=2026-10`,
      {
        isRequired: false,
        version: created.body.version,
      },
      'PATCH',
    );
    expect(moved.body).toMatchObject({ id, isRequired: false, paid: true });
    const october = (await call(`${P}/months/2026-10`, { member: alice })).body;
    expect(october.totals).toEqual(before);
    for (const month of ['2026-09', '2026-11']) {
      const rows = (await call(`${P}/recurring?month=${month}`, { member: alice })).body;
      expect(rows.find((r: { id: string }) => r.id === id).paid).toBe(false);
    }
    expect(
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM transactions').first<{ n: number }>())?.n,
    ).toBe(0);
    const unpaid = await post(
      alice,
      `${P}/recurring/${id}/payment`,
      { month: '2026-10', paid: false },
      'PUT',
    );
    expect(unpaid.body.paid).toBe(false);
    const eve = await createMember('eve@example.com');
    expect(
      (await post(eve, `${P}/recurring/${id}/payment`, { month: '2026-10', paid: true }, 'PUT'))
        .status,
    ).toBe(404);
    expect(
      (await post(alice, `${P}/recurring/${id}/payment`, { month: '2026-06', paid: true }, 'PUT'))
        .status,
    ).toBe(422);
  });
});

async function seedRates(date: string, eur: number, usd: number, cad: number) {
  await env.DB.batch(
    (
      [
        ['EUR', eur],
        ['USD', usd],
        ['CAD', cad],
      ] as const
    ).map(([currency, micros]) =>
      env.DB.prepare(
        'INSERT INTO exchange_rates (currency, effective_date, rate_micros, table_no, fetched_at) VALUES (?1, ?2, ?3, ?4, 0)',
      ).bind(currency, date, micros, 'test'),
    ),
  );
}

// Responses are asserted structurally with expect(), so the body type defaults to any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function post<T = any>(member: Member, path: string, body: unknown, method = 'POST') {
  return call<T>(path, { method, member, body: json(body) });
}

describe('settings and layout', () => {
  it('defaults to PLN and 20 %, and persists per-user chart layout', async () => {
    const alice = await createMember('alice@example.com');
    expect((await call(`${P}/settings`, { member: alice })).body).toEqual({
      baseCurrency: 'PLN',
      defaultSavingsRate: '20.00',
      minFree: '0.00',
      jointSplit: 'EQUAL',
      savingsMode: 'RATE',
      currencies: ['PLN', 'EUR', 'USD', 'CAD'],
    });
    expect(
      (await post(alice, `${P}/settings`, { baseCurrency: 'EUR' }, 'PATCH')).body.baseCurrency,
    ).toBe('EUR');

    const layout = {
      charts: [
        { id: 'savings', visible: true, type: 'line' },
        { id: 'trend', visible: false, type: 'area' },
      ],
    };
    expect((await post(alice, `${P}/layout`, layout, 'PUT')).status).toBe(200);
    const saved = await call(`${P}/layout`, { member: alice });
    expect(saved.body.charts.slice(0, 2)).toEqual(layout.charts);
    // Charts missing from the saved layout are appended with their default visibility.
    expect(saved.body.charts).toHaveLength(6);
    expect(saved.body.charts.find((c: { id: string }) => c.id === 'purchases').visible).toBe(false);

    const bob = await createMember('bob@example.com', alice.workspaceId);
    expect((await call(`${P}/layout`, { member: bob })).body.charts[0].id).toBe('trend');
    // The display currency is personal: Alice's EUR does not switch Bob's totals.
    expect((await call(`${P}/settings`, { member: bob })).body.baseCurrency).toBe('PLN');
    expect((await call(`${P}/months/2026-03`, { member: bob })).body.baseCurrency).toBe('PLN');
    expect((await call(`${P}/months/2026-03`, { member: alice })).body.baseCurrency).toBe('EUR');
    expect(
      (
        await post(
          alice,
          `${P}/layout`,
          { charts: [{ id: 'trend', visible: true, type: 'pie' }] },
          'PUT',
        )
      ).status,
    ).toBe(400);
  });

  it('tracks a loan: total, paid so far, remaining and the next payment', async () => {
    const alice = await createMember('alice@example.com');
    const q = '?month=2026-10';
    // An iPhone in 12 installments of 400 PLN from June 2026.
    const iphone = await post(alice, `${P}/recurring${q}`, {
      name: 'iPhone',
      amount: '400.00',
      startMonth: '2026-06',
      endMonth: '2027-05',
      isLoan: true,
    });
    expect(iphone.body).toMatchObject({ isLoan: true, loanTotal: null });
    const loans = async () => (await call(`${P}/loans${q}`, { member: alice })).body;
    // June–September are behind: 4 of 12 paid.
    expect((await loans()).loans[0]).toMatchObject({
      paymentsTotal: 12,
      paymentsPaid: 4,
      total: '4800.00',
      paid: '1600.00',
      remaining: '3200.00',
      nextMonth: '2026-10',
      payment: '400.00',
    });
    await post(
      alice,
      `${P}/recurring/${iphone.body.id}/payment`,
      { month: '2026-10', paid: true },
      'PUT',
    );
    expect((await loans()).loans[0]).toMatchObject({
      paymentsPaid: 5,
      remaining: '2800.00',
      nextMonth: '2026-11',
    });
    // A total entered by hand (e.g. with interest) replaces the schedule sum.
    const withTotal = await post(
      alice,
      `${P}/recurring/${iphone.body.id}${q}`,
      { loanTotal: '5000', version: iphone.body.version },
      'PATCH',
    );
    expect(withTotal.body.loanTotal).toBe('5000.00');
    expect((await loans()).loans[0]).toMatchObject({ total: '5000.00', remaining: '3000.00' });
  });

  it('keeps the spending window of an ongoing payment', async () => {
    const alice = await createMember('alice@example.com');
    const ads = await post(alice, `${P}/recurring?month=2026-10`, {
      name: 'Реклама',
      amount: '900',
      startMonth: '2026-10',
      isOngoing: true,
      ongoingStartDay: 10,
      ongoingEndDay: 25,
    });
    expect(ads.body).toMatchObject({ ongoingStartDay: 10, ongoingEndDay: 25 });
    const wrong = await post(
      alice,
      `${P}/recurring/${ads.body.id}?month=2026-10`,
      { ongoingStartDay: 26, ongoingEndDay: 25, version: ads.body.version },
      'PATCH',
    );
    expect(wrong.status).toBe(400);
  });

  it('stores the «paid during the month» flag of a regular expense', async () => {
    const alice = await createMember('alice@example.com');
    const q = '?month=2026-03';
    const food = await post(alice, `${P}/recurring${q}`, {
      name: 'Еда',
      amount: '2000.00',
      startMonth: '2026-03',
      isOngoing: true,
    });
    expect(food.status).toBe(201);
    expect(food.body.isOngoing).toBe(true);
    const rent = await post(alice, `${P}/recurring${q}`, {
      name: 'Аренда',
      amount: '3000.00',
      startMonth: '2026-03',
    });
    expect(rent.body.isOngoing).toBe(false);
    const updated = await post(
      alice,
      `${P}/recurring/${food.body.id}${q}`,
      { isOngoing: false, version: food.body.version },
      'PATCH',
    );
    expect(updated.body.isOngoing).toBe(false);
  });

  it('keeps the switched-off payments of the «left to pay» card with the layout', async () => {
    const alice = await createMember('alice@example.com');
    expect((await call(`${P}/layout`, { member: alice })).body.remaining).toBeUndefined();
    const remaining = { excluded: ['r:abc', 'p:def'], hiddenGroups: ['purchases'] };
    const charts = [{ id: 'trend', visible: true, type: 'bar' }];
    expect((await post(alice, `${P}/layout`, { charts, remaining }, 'PUT')).status).toBe(200);
    const saved = await call(`${P}/layout`, { member: alice });
    expect(saved.body.remaining).toEqual(remaining);
    expect(saved.body.charts).toHaveLength(6);
    expect(
      (
        await post(
          alice,
          `${P}/layout`,
          { charts, remaining: { excluded: [], hiddenGroups: ['purchases', 'purchases'] } },
          'PUT',
        )
      ).status,
    ).toBe(400);
  });
});

describe('month budget', () => {
  it('computes incomes, configurable deductions, regular payments, purchases, savings and the free remainder', async () => {
    const alice = await createMember('alice@example.com');
    await seedRates('2026-03-13', 4_261_500, 3_672_100, 2_650_300);
    const month = '2026-03';
    const q = `?month=${month}`;

    const salary = await post(alice, `${P}/incomes${q}`, {
      name: 'Зарплата',
      amount: '10000',
      startMonth: '2026-01',
    });
    expect(salary.status).toBe(201);
    await post(alice, `${P}/incomes/${salary.body.id}/deductions${q}`, {
      name: 'PIT',
      kind: 'PERCENT',
      rate: '12',
    });
    const withFee = await post(alice, `${P}/incomes/${salary.body.id}/deductions${q}`, {
      name: 'Комиссия банка',
      kind: 'FIXED',
      amount: '25',
    });
    expect(withFee.body).toMatchObject({
      gross: '10000.00',
      deductionsTotal: '1225.00',
      net: '8775.00',
    });
    await post(alice, `${P}/incomes${q}`, {
      name: 'Contract',
      currency: 'EUR',
      amount: '1000',
      startMonth: '2026-03',
    });

    await post(alice, `${P}/recurring${q}`, {
      name: 'Аренда',
      category: 'HOUSING',
      amount: '3000',
      startMonth: '2026-01',
      dueDay: 10,
    });
    await post(alice, `${P}/recurring${q}`, {
      name: 'Spotify',
      category: 'SUBSCRIPTIONS',
      currency: 'USD',
      amount: '10',
      startMonth: '2026-01',
    });
    await post(alice, `${P}/recurring${q}`, {
      name: 'Страховка',
      category: 'INSURANCE',
      amount: '1200',
      startMonth: '2025-03',
      intervalMonths: 12,
    });
    await post(alice, `${P}/recurring${q}`, {
      name: 'Квартальный',
      category: 'OTHER',
      amount: '999',
      startMonth: '2026-02',
      intervalMonths: 3,
    });
    await post(alice, `${P}/purchases`, {
      title: 'Пылесос',
      estimatedAmount: '500',
      plannedMonth: month,
    });
    await post(alice, `${P}/purchases`, { title: 'Когда-нибудь', estimatedAmount: '9999' });

    const budget = await call(`${P}/months/${month}`, { member: alice });
    expect(budget.status).toBe(200);
    // Income: 10 000 − 1 225 + 1 000 EUR × 4.2615 = 8 775 + 4 261.50
    // Regular: 3 000 + 10 USD × 3.6721 + 1 200 (yearly, due in March) = 4 236.72; quarterly is not due
    expect(budget.body.totals).toEqual({
      grossIncome: '14261.50',
      deductions: '1225.00',
      netIncome: '13036.50',
      recurring: '4236.72',
      purchases: '500.00',
      savingsTarget: '2607.30',
      free: '5692.48',
    });
    expect(budget.body.savingsRate).toBe('20.00');
    expect(budget.body.purchases.map((p: { title: string }) => p.title)).toEqual(['Пылесос']);
    expect(
      budget.body.recurring.find((r: { name: string }) => r.name === 'Квартальный').active,
    ).toBe(false);
    expect(budget.body.breakdown[0]).toEqual({
      key: 'HOUSING',
      kind: 'recurring',
      amount: '3000.00',
    });
    expect(budget.body.missingRates).toEqual([]);

    const eur = await post(alice, `${P}/settings`, { baseCurrency: 'EUR' }, 'PATCH');
    expect(eur.status).toBe(200);
    const inEur = await call(`${P}/months/${month}`, { member: alice });
    expect(inEur.body.baseCurrency).toBe('EUR');
    expect(inEur.body.totals.purchases).toBe('117.33'); // 500 / 4.2615
  });

  it('edits the savings rate per month and recomputes the free remainder', async () => {
    const alice = await createMember('alice@example.com');
    await post(alice, `${P}/incomes?month=2026-03`, {
      name: 'Зарплата',
      amount: '1000',
      startMonth: '2026-03',
    });
    const changed = await post(
      alice,
      `${P}/months/2026-03/savings-rate`,
      { savingsRate: '35' },
      'PUT',
    );
    expect(changed.body).toMatchObject({ savingsRate: '35.00', savingsRateIsDefault: false });
    expect(changed.body.totals).toMatchObject({ savingsTarget: '350.00', free: '650.00' });
    expect((await call(`${P}/months/2026-04`, { member: alice })).body.savingsRate).toBe('20.00');
    const reset = await post(
      alice,
      `${P}/months/2026-03/savings-rate`,
      { savingsRate: null },
      'PUT',
    );
    expect(reset.body).toMatchObject({ savingsRate: '20.00', savingsRateIsDefault: true });
  });

  it('reports missing rates instead of inventing them', async () => {
    const alice = await createMember('alice@example.com');
    await post(alice, `${P}/incomes?month=2026-03`, {
      name: 'USD job',
      currency: 'USD',
      amount: '100',
      startMonth: '2026-03',
    });
    const budget = await call(`${P}/months/2026-03`, { member: alice });
    expect(budget.body.missingRates).toEqual(['USD']);
    expect(budget.body.totals.netIncome).toBe('0.00');
  });
});

describe('history is never rewritten', () => {
  it('changes a regular amount from a month on, or for one month only', async () => {
    const alice = await createMember('alice@example.com');
    const rent = await post(alice, `${P}/recurring?month=2026-01`, {
      name: 'Аренда',
      amount: '3000',
      startMonth: '2026-01',
    });
    const id = rent.body.id;

    await post(
      alice,
      `${P}/recurring/${id}/amount`,
      { month: '2026-05', amount: '3200', scope: 'FORWARD' },
      'PUT',
    );
    await post(
      alice,
      `${P}/recurring/${id}/amount`,
      { month: '2026-07', amount: '0', scope: 'MONTH' },
      'PUT',
    );
    await post(alice, `${P}/recurring/${id}/skip`, { month: '2026-08', skipped: true }, 'PUT');

    const amounts = await Promise.all(
      ['2026-04', '2026-05', '2026-07', '2026-08', '2027-01'].map(async (m) => {
        const lines = await call(`${P}/recurring?month=${m}`, { member: alice });
        const line = lines.body[0];
        return [m, line.active ? line.amount : 'skipped'];
      }),
    );
    expect(amounts).toEqual([
      ['2026-04', '3000.00'],
      ['2026-05', '3200.00'],
      ['2026-07', '0.00'],
      ['2026-08', 'skipped'],
      ['2027-01', '3200.00'],
    ]);
  });

  it('stops an item from a month on but keeps earlier months; new items are deleted outright', async () => {
    const alice = await createMember('alice@example.com');
    const gym = await post(alice, `${P}/recurring?month=2026-01`, {
      name: 'Спортзал',
      amount: '150',
      startMonth: '2026-01',
    });
    expect(
      (await post(alice, `${P}/recurring/${gym.body.id}/stop`, { month: '2026-06' })).body,
    ).toEqual({ result: 'ended' });
    expect((await call(`${P}/months/2026-05`, { member: alice })).body.totals.recurring).toBe(
      '150.00',
    );
    expect((await call(`${P}/months/2026-06`, { member: alice })).body.totals.recurring).toBe(
      '0.00',
    );

    const fresh = await post(alice, `${P}/recurring?month=2026-06`, {
      name: 'Новый',
      amount: '10',
      startMonth: '2026-06',
    });
    expect(
      (await post(alice, `${P}/recurring/${fresh.body.id}/stop`, { month: '2026-06' })).body,
    ).toEqual({ result: 'deleted' });
  });

  it('keeps past months on the old default savings rate when the default changes', async () => {
    const alice = await createMember('alice@example.com');
    await post(alice, `${P}/incomes?month=2026-01`, {
      name: 'Зарплата',
      amount: '1000',
      startMonth: '2026-01',
    });
    await post(alice, `${P}/settings`, { defaultSavingsRate: '30' }, 'PATCH');
    expect((await call(`${P}/months/2026-02`, { member: alice })).body).toMatchObject({
      savingsRate: '20.00',
    });
    expect((await call(`${P}/months/2099-01`, { member: alice })).body).toMatchObject({
      savingsRate: '30.00',
    });
  });

  it('refuses to switch the currency of an item that already has past months', async () => {
    const alice = await createMember('alice@example.com');
    const old = await post(alice, `${P}/incomes?month=2026-01`, {
      name: 'Зарплата',
      amount: '1',
      startMonth: '2026-01',
    });
    expect(
      (
        await post(
          alice,
          `${P}/incomes/${old.body.id}?month=2026-01`,
          { currency: 'EUR', version: old.body.version },
          'PATCH',
        )
      ).status,
    ).toBe(409);
    const future = await post(alice, `${P}/incomes?month=2099-01`, {
      name: 'Будущая',
      amount: '1',
      startMonth: '2099-01',
    });
    const switched = await post(
      alice,
      `${P}/incomes/${future.body.id}?month=2099-01`,
      { currency: 'EUR', version: 1 },
      'PATCH',
    );
    expect(switched.body).toMatchObject({ currency: 'EUR', version: 2 });
  });
});

describe('purchases', () => {
  it('counts a purchase once: in its planned month, with the actual price once bought', async () => {
    const alice = await createMember('alice@example.com');
    const tv = await post(alice, `${P}/purchases`, {
      title: 'Телевизор',
      estimatedAmount: '4000',
      plannedMonth: '2026-11',
      priority: 'HIGH',
    });
    const moved = await post(
      alice,
      `${P}/purchases/${tv.body.id}`,
      { plannedMonth: '2026-12', version: 1 },
      'PATCH',
    );
    expect(moved.body).toMatchObject({
      plannedMonth: '2026-12',
      budgetMonth: '2026-12',
      version: 2,
    });
    const back = await post(
      alice,
      `${P}/purchases/${tv.body.id}`,
      { plannedMonth: '2026-11', version: 2 },
      'PATCH',
    );
    const bought = await post(alice, `${P}/purchases/${tv.body.id}/purchase`, {
      purchasedOn: '2026-12-03',
      actualAmount: '3799.99',
      version: back.body.version,
    });
    expect(bought.body).toMatchObject({
      status: 'PURCHASED',
      purchasedOn: '2026-12-03',
      budgetMonth: '2026-11',
      budgetAmount: '3799.99',
    });

    expect((await call(`${P}/months/2026-11`, { member: alice })).body.totals.purchases).toBe(
      '3799.99',
    );
    expect((await call(`${P}/months/2026-12`, { member: alice })).body.totals.purchases).toBe(
      '0.00',
    );

    const history = await call(`${P}/purchases/${tv.body.id}/history`, { member: alice });
    expect(
      history.body
        .map((e: { type: string; fromMonth: string | null; toMonth: string | null }) => [
          e.type,
          e.fromMonth,
          e.toMonth,
        ])
        .reverse(),
    ).toEqual([
      ['CREATED', null, '2026-11'],
      ['RESCHEDULED', '2026-11', '2026-12'],
      ['RESCHEDULED', '2026-12', '2026-11'],
      ['PURCHASED', '2026-11', '2026-11'],
    ]);
    expect(history.body[0]).toMatchObject({
      amount: '3799.99',
      date: '2026-12-03',
      createdBy: { email: 'alice@example.com' },
    });
  });

  it('cancels, restores, unpurchases and protects bought items from deletion', async () => {
    const alice = await createMember('alice@example.com');
    const item = await post(alice, `${P}/purchases`, {
      title: 'Велосипед',
      estimatedAmount: '2000',
      plannedMonth: '2026-06',
    });
    const cancelled = await post(alice, `${P}/purchases/${item.body.id}/cancel`, { version: 1 });
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', budgetMonth: null });
    expect((await call(`${P}/months/2026-06`, { member: alice })).body.totals.purchases).toBe(
      '0.00',
    );
    expect(
      (
        await post(alice, `${P}/purchases/${item.body.id}/purchase`, {
          purchasedOn: '2026-06-01',
          actualAmount: '1',
          version: 2,
        })
      ).status,
    ).toBe(409);
    const restored = await post(alice, `${P}/purchases/${item.body.id}/restore`, { version: 2 });
    const bought = await post(alice, `${P}/purchases/${item.body.id}/purchase`, {
      purchasedOn: '2026-06-02',
      actualAmount: '1900',
      version: restored.body.version,
    });
    expect(
      (await call(`${P}/purchases/${item.body.id}`, { method: 'DELETE', member: alice })).status,
    ).toBe(409);
    const undone = await post(alice, `${P}/purchases/${item.body.id}/unpurchase`, {
      version: bought.body.version,
    });
    expect(undone.body).toMatchObject({
      status: 'ACTIVE',
      actualAmount: null,
      budgetAmount: '2000.00',
    });
    expect(
      (await call(`${P}/purchases/${item.body.id}`, { method: 'DELETE', member: alice })).status,
    ).toBe(204);
  });
});

describe('concurrent editing', () => {
  it('lets exactly one of two edits based on the same version win', async () => {
    const alice = await createMember('alice@example.com');
    const bob = await createMember('bob@example.com', alice.workspaceId);
    const rent = await post(alice, `${P}/recurring?month=2026-01`, {
      name: 'Аренда',
      amount: '3000',
      startMonth: '2026-01',
    });
    const [a, b] = await Promise.all([
      post(
        alice,
        `${P}/recurring/${rent.body.id}?month=2026-01`,
        { name: 'Аренда (Алиса)', version: 1 },
        'PATCH',
      ),
      post(
        bob,
        `${P}/recurring/${rent.body.id}?month=2026-01`,
        { name: 'Аренда (Боб)', version: 1 },
        'PATCH',
      ),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a.body.error, b.body.error]).toContain('PLANNER_VERSION_CONFLICT');
  });

  it('keeps one amount row under concurrent amount edits', async () => {
    const alice = await createMember('alice@example.com');
    const rent = await post(alice, `${P}/recurring?month=2026-01`, {
      name: 'Аренда',
      amount: '3000',
      startMonth: '2026-01',
    });
    const amounts = ['3100', '3200', '3300', '3400'];
    const results = await Promise.all(
      amounts.map((amount) =>
        post(
          alice,
          `${P}/recurring/${rent.body.id}/amount`,
          { month: '2026-04', amount, scope: 'FORWARD' },
          'PUT',
        ),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM recurring_amounts WHERE effective_month = '2026-04'",
    ).first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it('records exactly one purchase event when two people mark the same item as bought', async () => {
    const alice = await createMember('alice@example.com');
    const bob = await createMember('bob@example.com', alice.workspaceId);
    const item = await post(alice, `${P}/purchases`, {
      title: 'Диван',
      estimatedAmount: '3000',
      plannedMonth: '2026-05',
    });
    const body = { purchasedOn: '2026-05-10', actualAmount: '2900', version: 1 };
    const results = await Promise.all([
      post(alice, `${P}/purchases/${item.body.id}/purchase`, body),
      post(bob, `${P}/purchases/${item.body.id}/purchase`, { ...body, actualAmount: '3100' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const events = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM purchase_events WHERE type = 'PURCHASED'",
    ).first<{ n: number }>();
    expect(events?.n).toBe(1);
  });
});

describe('workspace isolation', () => {
  it('does not expose or modify planner rows of another workspace', async () => {
    const alice = await createMember('alice@example.com');
    const eve = await createMember('eve@example.com');
    const rent = await post(alice, `${P}/recurring?month=2026-01`, {
      name: 'Аренда',
      amount: '3000',
      startMonth: '2026-01',
    });
    const tv = await post(alice, `${P}/purchases`, {
      title: 'TV',
      estimatedAmount: '1',
      plannedMonth: '2026-01',
    });
    expect((await call(`${P}/recurring?month=2026-01`, { member: eve })).body).toEqual([]);
    expect(
      (
        await post(
          eve,
          `${P}/recurring/${rent.body.id}?month=2026-01`,
          { name: 'x', version: 1 },
          'PATCH',
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await post(
          eve,
          `${P}/recurring/${rent.body.id}/amount`,
          { month: '2026-02', amount: '1' },
          'PUT',
        )
      ).status,
    ).toBe(404);
    expect((await post(eve, `${P}/purchases/${tv.body.id}/cancel`, { version: 1 })).status).toBe(
      404,
    );
    expect((await call(`${P}/purchases/${tv.body.id}/history`, { member: eve })).status).toBe(404);
    expect((await call(`${P}/months/2026-01`, { member: eve })).body.totals.recurring).toBe('0.00');
  });

  it('works independently from accounts and transactions, which stay untouched', async () => {
    const alice = await createMember('alice@example.com');
    const account = await call('/api/accounts', {
      method: 'POST',
      member: alice,
      body: json({ name: 'Card', type: 'CARD', currency: 'RUB' }),
    });
    expect(account.status).toBe(201);
    await post(alice, `${P}/recurring?month=2026-01`, {
      name: 'Аренда',
      amount: '3000',
      startMonth: '2026-01',
    });
    expect((await call('/api/accounts', { member: alice })).body).toHaveLength(1);
    expect((await call(`${P}/months/2026-01`, { member: alice })).body.totals.recurring).toBe(
      '3000.00',
    );
  });
});

describe('NBP exchange rates', () => {
  const nbpTable = (date: string, eur: number) => [
    {
      table: 'A',
      no: `001/A/NBP/${date.slice(0, 4)}`,
      effectiveDate: date,
      rates: [
        { currency: 'euro', code: 'EUR', mid: eur },
        { currency: 'dolar amerykański', code: 'USD', mid: 3.6721 },
        { currency: 'dolar kanadyjski', code: 'CAD', mid: 2.6503 },
        { currency: 'funt szterling', code: 'GBP', mid: 4.9 },
      ],
    },
  ];

  it('stores fetched rates, falls back to the last success on failure and reports staleness', async () => {
    const alice = await createMember('alice@example.com');
    const ok = createApp({ fetcher: async () => Response.json(nbpTable('2026-10-07', 4.2615)) });
    const refreshed = await ok.fetch(
      new Request('http://localhost/api/planner/rates/refresh', {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          'X-CSRF-Token': alice.csrf,
          Origin: 'http://localhost:5173',
        },
      }),
      env,
    );
    const status = await refreshed.json<{
      rates: { currency: string; rate: string }[];
      lastError: string | null;
    }>();
    expect(status.rates).toEqual([
      { currency: 'CAD', rate: '2.6503', effectiveDate: '2026-10-07' },
      { currency: 'EUR', rate: '4.2615', effectiveDate: '2026-10-07' },
      { currency: 'USD', rate: '3.6721', effectiveDate: '2026-10-07' },
    ]);
    expect(status.lastError).toBeNull();

    const failing = createApp({ fetcher: async () => new Response('down', { status: 503 }) });
    const afterFailure = await failing.fetch(
      new Request('http://localhost/api/planner/rates/refresh', {
        method: 'POST',
        headers: {
          Cookie: alice.cookie,
          'X-CSRF-Token': alice.csrf,
          Origin: 'http://localhost:5173',
        },
      }),
      env,
    );
    const failed = await afterFailure.json<{
      rates: unknown[];
      lastError: string;
      lastSuccessAt: string;
    }>();
    expect(failed.lastError).toContain('503');
    expect(failed.rates).toHaveLength(3);
    expect(failed.lastSuccessAt).toBeTruthy();
  });

  it('converts past months at their own historical rate, not today’s', async () => {
    const alice = await createMember('alice@example.com');
    await seedRates('2026-01-30', 4_000_000, 3_500_000, 2_500_000);
    await seedRates('2026-10-07', 5_000_000, 3_600_000, 2_600_000);
    await post(alice, `${P}/incomes?month=2026-01`, {
      name: 'EUR',
      currency: 'EUR',
      amount: '100',
      startMonth: '2026-01',
    });
    expect((await call(`${P}/months/2026-01`, { member: alice })).body.totals.grossIncome).toBe(
      '400.00',
    );
    expect((await call(`${P}/months/2026-10`, { member: alice })).body.totals.grossIncome).toBe(
      '500.00',
    );
  });

  it('refreshes rates from the Cron Trigger', async () => {
    let calls = 0;
    await runScheduled(CRON.rates, env, async () => {
      calls += 1;
      return Response.json(nbpTable('2026-10-08', 4.25));
    });
    expect(calls).toBeGreaterThan(0);
    const row = await env.DB.prepare(
      "SELECT rate_micros FROM exchange_rates WHERE currency = 'EUR' AND effective_date = '2026-10-08'",
    ).first<{ rate_micros: number }>();
    expect(row?.rate_micros).toBe(4_250_000);
  });
});

describe('trend', () => {
  it('returns per-month totals for charts', async () => {
    const alice = await createMember('alice@example.com');
    await post(alice, `${P}/incomes?month=2026-01`, {
      name: 'Зарплата',
      amount: '1000',
      startMonth: '2026-01',
    });
    await post(alice, `${P}/recurring?month=2026-01`, {
      name: 'Аренда',
      amount: '300',
      startMonth: '2026-02',
    });
    const trend = await call(`${P}/trend?to=2026-03&months=3`, { member: alice });
    expect(
      trend.body.points.map((p: { month: string; free: string }) => [p.month, p.free]),
    ).toEqual([
      ['2026-01', '800.00'],
      ['2026-02', '500.00'],
      ['2026-03', '500.00'],
    ]);
    expect(trend.body.points[1].grossIncome).toBe('1000.00');
    expect(trend.body.points[1].breakdown).toEqual([
      { key: 'OTHER', kind: 'recurring', amount: '300.00' },
    ]);
  });
});
