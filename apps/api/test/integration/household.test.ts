import { env } from 'cloudflare:workers';
import type { MonthBudgetDto } from '@homehub/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { toMinor } from '../../src/lib/money';
import { call, createAccount, createMember, json, resetDb, type Member } from '../helpers';

/** Acceptance scenarios of the household finances: members, funds, plans, facts, wealth. */

beforeEach(async () => {
  await resetDb();
  await env.DB.batch(
    ['exchange_rates', 'asset_prices', 'planner_state', 'user_preferences'].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
  // EUR at 4.25 PLN; a fresh price check so nothing is fetched.
  const today = new Date().toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO exchange_rates (currency, effective_date, rate_micros, table_no, fetched_at)
       VALUES ('EUR', ?1, 4250000, '1/A/NBP', 0)`,
    ).bind(today),
    env.DB.prepare(
      `INSERT INTO planner_state (key, value, updated_at) VALUES ('crypto.last_success_at', ?1, 0)`,
    ).bind(new Date().toISOString()),
  ]);
});

const M = '2026-11';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function send<T = any>(member: Member, path: string, body?: unknown, method = 'POST') {
  const res = await call<T>(path, {
    method,
    member,
    body: body === undefined ? undefined : json(body),
  });
  if (res.status >= 400 && !path.includes('expect-error'))
    throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(res.body)}`);
  return res;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const get = async <T = any>(member: Member, path: string) => (await call<T>(path, { member })).body;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pot = (overview: any, name: string) => overview.pots.find((p: any) => p.name === name);

async function household() {
  const alice = await createMember('alice@example.com');
  const members = await send(alice, '/api/members', { name: 'Участник Б', color: '#8b5cf6' });
  const memberB = members.body.find((m: { name: string }) => m.name === 'Участник Б');
  const memberA = (
    await send(alice, '/api/members', { name: 'Участник А', color: '#3b82f6' })
  ).body.find((m: { name: string }) => m.name === 'Участник А');
  const mAccount = await createAccount(alice, 'Банк Участник Б', 'PLN', '10000');
  const iAccount = await createAccount(alice, 'Банк Участник А', 'PLN', '5000');
  await send(alice, `/api/accounts/${mAccount.id}`, { ownerId: memberB.id }, 'PATCH');
  await send(alice, `/api/accounts/${iAccount.id}`, { ownerId: memberA.id }, 'PATCH');
  return { alice, memberB, memberA, mAccount, iAccount };
}

/** Emergency: Участник Б 4 000 on her account, Участник А 2 000 on his. */
async function emergency(h: Awaited<ReturnType<typeof household>>) {
  const created = await send(h.alice, `/api/savings/pots?month=${M}`, {
    name: 'Emergency',
    kind: 'CASH',
    currency: 'PLN',
    target: '20000',
    icon: '🛟',
  });
  const fund = pot(created.body, 'Emergency');
  const first = fund.subaccounts[0];
  await send(
    h.alice,
    `/api/savings/subaccounts/${first.id}?month=${M}`,
    { name: 'Участник Б', ownerId: h.memberB.id, accountId: h.mAccount.id, balance: '4000' },
    'PATCH',
  );
  const after = await send(h.alice, `/api/savings/pots/${fund.id}/subaccounts?month=${M}`, {
    name: 'Участник А',
    ownerId: h.memberA.id,
    accountId: h.iAccount.id,
    balance: '2000',
  });
  const parts = pot(after.body, 'Emergency').subaccounts;
  return {
    fund,
    mPart: parts.find((s: { name: string }) => s.name === 'Участник Б'),
    iPart: parts.find((s: { name: string }) => s.name === 'Участник А'),
    overview: after.body,
  };
}

describe('household finances', () => {
  it('marks everyday spending without accounts or changes to savings', async () => {
    const h = await household();
    await emergency(h);
    const before = await get(h.alice, '/api/accounts');
    const funds = await get(h.alice, `/api/savings?month=${M}`);
    const recurring = await send(h.alice, `/api/planner/recurring?month=${M}`, {
      name: 'Rent',
      amount: '1000',
      startMonth: M,
    });
    const paid = await send(
      h.alice,
      `/api/planner/recurring/${recurring.body.id}/payment`,
      {
        month: M,
        paid: true,
      },
      'PUT',
    );
    expect(paid.body.paid).toBe(true);
    const purchase = await send(h.alice, '/api/planner/purchases', {
      title: 'Chair',
      estimatedAmount: '200',
      plannedMonth: M,
    });
    const bought = await send(h.alice, `/api/planner/purchases/${purchase.body.id}/purchase`, {
      purchasedOn: `${M}-03`,
      actualAmount: '175',
      version: purchase.body.version,
    });
    expect(bought.body).toMatchObject({ status: 'PURCHASED', actualAmount: '175.00' });
    expect(await get(h.alice, '/api/accounts')).toEqual(before);
    expect(pot(await get(h.alice, `/api/savings?month=${M}`), 'Emergency').balance).toEqual(
      pot(funds, 'Emergency').balance,
    );
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM transactions').first('n')).toBe(0);
    await send(
      h.alice,
      `/api/planner/recurring/${recurring.body.id}/payment`,
      {
        month: M,
        paid: false,
      },
      'PUT',
    );
    await send(h.alice, `/api/planner/purchases/${purchase.body.id}/unpurchase`, {
      version: bought.body.version,
    });
    expect(await get(h.alice, '/api/accounts')).toEqual(before);
  });

  it('deducts assigned savings from the month and owner totals after adding purchases', async () => {
    const h = await household();
    const e = await emergency(h);
    await send(h.alice, '/api/planner/settings', { savingsMode: 'REMAINDER' }, 'PATCH');
    await send(h.alice, `/api/planner/incomes?month=${M}`, {
      name: 'Income',
      amount: '4000',
      startMonth: M,
    });
    await send(h.alice, `/api/savings/pots/${e.fund.id}/movements?month=${M}`, {
      type: 'DEPOSIT',
      amount: '3000',
      date: '2026-11-05',
      subaccountId: e.mPart.id,
      source: 'ACCOUNT',
    });
    let budget = await get<MonthBudgetDto>(h.alice, `/api/planner/months/${M}`);
    // Old opening savings (6000) are not deducted again. The unassigned 1000 is reserved once.
    expect(budget.totals).toMatchObject({ savingsTarget: '4000.00', free: '0.00' });
    expect(budget.byOwner.reduce((sum, row) => sum + toMinor(row.free), 0n)).toBe(0n);
    await send(h.alice, '/api/planner/purchases', {
      title: 'New purchase',
      estimatedAmount: '2000',
      plannedMonth: M,
    });
    budget = await get<MonthBudgetDto>(h.alice, `/api/planner/months/${M}`);
    expect(budget.totals).toMatchObject({ savingsTarget: '3000.00', free: '-1000.00' });
    expect(budget.byOwner.reduce((sum, row) => sum + toMinor(row.free), 0n)).toBe(-100000n);
    const other = await createMember('eve@example.com');
    const unrelated = await get<MonthBudgetDto>(other, `/api/planner/months/${M}`);
    expect(unrelated.totals.savingsTarget).toBe('0.00');
    await send(h.alice, `/api/savings/pots/${e.fund.id}/movements?month=${M}`, {
      type: 'WITHDRAWAL',
      amount: '1500',
      date: '2026-11-06',
      subaccountId: e.mPart.id,
      keepOnAccount: true,
    });
    budget = await get<MonthBudgetDto>(h.alice, `/api/planner/months/${M}`);
    expect(budget.totals).toMatchObject({ savingsTarget: '2000.00', free: '0.00' });
  });
  it('scenario 1–2, 6: fund parts add up; a plan forecasts without becoming money', async () => {
    const h = await household();
    const e = await emergency(h);
    expect(pot(e.overview, 'Emergency')).toMatchObject({ balance: '6000.00', progress: 30 });

    for (const [part, amount] of [
      [e.mPart, '3000'],
      [e.iPart, '1000'],
    ] as const)
      await send(
        h.alice,
        `/api/savings/subaccounts/${part.id}/rule?month=${M}`,
        { mode: 'FIXED', amount, startMonth: M },
        'PUT',
      );
    const planned = await get(h.alice, `/api/savings?month=${M}`);
    const fund = pot(planned, 'Emergency');
    expect(fund).toMatchObject({ balance: '6000.00', planned: '4000.00', forecast: '10000.00' });
    expect(fund.subaccounts.map((s: { forecast: string }) => s.forecast).sort()).toEqual([
      '3000.00',
      '7000.00',
    ]);

    // The plan is the month's savings in the budget instead of the savings rate.
    await send(h.alice, `/api/planner/incomes?month=${M}`, {
      name: 'Зарплата',
      amount: '20000',
      startMonth: M,
      ownerId: h.memberB.id,
    });
    const budget = await get(h.alice, `/api/planner/months/${M}`);
    expect(budget.savingsPlan).toMatchObject({
      source: 'FUNDS',
      total: '4000.00',
      deficit: '0.00',
    });
    expect(budget.totals).toMatchObject({ savingsTarget: '4000.00', free: '16000.00' });

    // The plan of one month only; reservation shown on the accounts, capital counted once.
    await send(
      h.alice,
      `/api/savings/subaccounts/${e.iPart.id}/plan?month=${M}`,
      { month: M, amount: '500' },
      'PUT',
    );
    expect(pot(await get(h.alice, `/api/savings?month=${M}`), 'Emergency').planned).toBe('3500.00');
    const accounts = await get(h.alice, '/api/accounts');
    expect(accounts.find((a: { id: string }) => a.id === h.mAccount.id)).toMatchObject({
      balance: '10000.00',
      reserved: '4000.00',
      available: '6000.00',
    });
    const wealth = await get(h.alice, `/api/savings/wealth?month=${M}`);
    expect(wealth).toMatchObject({ capital: '15000.00', reserved: '6000.00', free: '9000.00' });
    expect(wealth.owners.find((o: { name: string }) => o.name === 'Участник Б')).toMatchObject({
      accounts: '10000.00',
      reserved: '4000.00',
      total: '10000.00',
    });

    // Scenario 6: a part's colour and note persist.
    await send(
      h.alice,
      `/api/savings/subaccounts/${e.mPart.id}`,
      { color: '#ec4899', note: 'Подушка М.' },
      'PATCH',
    );
    const reloaded = pot(await get(h.alice, '/api/savings'), 'Emergency').subaccounts;
    expect(reloaded.find((s: { id: string }) => s.id === e.mPart.id)).toMatchObject({
      color: '#ec4899',
      note: 'Подушка М.',
    });
  });

  it('scenario 3–4, 9: percentages, the free remainder for Apartment, the deficit', async () => {
    const h = await household();
    const e = await emergency(h);
    const salary = await send(h.alice, `/api/planner/incomes?month=${M}`, {
      name: 'Зарплата Участник Б',
      amount: '11000',
      startMonth: M,
      ownerId: h.memberB.id,
    });
    await send(h.alice, `/api/planner/recurring?month=${M}`, {
      name: 'Аренда',
      amount: '5000',
      startMonth: M,
      isRequired: true,
    });
    // 70 % / 30 % of the free money (11 000 − 5 000 = 6 000) to Emergency.
    for (const [part, percent] of [
      [e.mPart, '70'],
      [e.iPart, '30'],
    ] as const)
      await send(
        h.alice,
        `/api/savings/subaccounts/${part.id}/rule`,
        { mode: 'PERCENT', percent, percentBase: 'FREE', max: '3000', startMonth: M },
        'PUT',
      );
    let budget = await get(h.alice, `/api/planner/months/${M}`);
    expect(budget.savingsPlan.lines.map((l: { planned: string }) => l.planned)).toEqual([
      '3000.00', // 4 200 capped at the max
      '1800.00',
    ]);

    // Apartment takes what is left above 500 PLN kept on everyday accounts.
    const apartment = await send(h.alice, `/api/savings/pots?month=${M}`, {
      name: 'Apartment',
      kind: 'CASH',
      currency: 'PLN',
    });
    const aPart = pot(apartment.body, 'Apartment').subaccounts[0];
    await send(
      h.alice,
      `/api/savings/subaccounts/${aPart.id}/rule`,
      { mode: 'REMAINDER', startMonth: M },
      'PUT',
    );
    await send(h.alice, '/api/planner/settings', { minFree: '500' }, 'PATCH');
    budget = await get(h.alice, `/api/planner/months/${M}`);
    const line = (b: { savingsPlan: { lines: { potName: string; planned: string }[] } }) =>
      b.savingsPlan.lines.find((l) => l.potName === 'Apartment')!.planned;
    expect(line(budget)).toBe('700.00'); // 6 000 − 4 800 − 500
    expect(budget.totals.free).toBe('500.00');

    // Scenario 4: income 15 000 — free 10 000; Emergency parts are capped at 3 000 each, Apartment
    // gets the rest above 500: 10 000 − 6 000 − 500.
    await send(
      h.alice,
      `/api/planner/incomes/${salary.body.id}/amount`,
      { month: M, amount: '15000', scope: 'MONTH' },
      'PUT',
    );
    budget = await get(h.alice, `/api/planner/months/${M}`);
    expect(line(budget)).toBe('3500.00');

    // Scenario 9: plans above the money — a deficit, nothing invented.
    await send(
      h.alice,
      `/api/savings/subaccounts/${e.iPart.id}/rule`,
      { mode: 'FIXED', amount: '20000', startMonth: M },
      'PUT',
    );
    budget = await get(h.alice, `/api/planner/months/${M}`);
    expect(Number(budget.savingsPlan.deficit)).toBeGreaterThan(0);
    expect(budget.savingsPlan.warnings.map((w: { code: string }) => w.code)).toContain(
      'PLAN_OVER_MONEY_REDUCE',
    );
    expect(line(budget)).toBe('0.00');
    expect(pot(await get(h.alice, `/api/savings?month=${M}`), 'Emergency').balance).toBe('6000.00');
  });

  it('scenario 5: a transfer and a fund deposit from another account keep the capital', async () => {
    const h = await household();
    const e = await emergency(h);
    const before = (await get(h.alice, `/api/savings/wealth?month=${M}`)).capital;
    const other = await createAccount(h.alice, 'Сбережения Участник Б', 'PLN', '0');
    await send(h.alice, '/api/transactions', {
      type: 'TRANSFER',
      accountId: h.mAccount.id,
      toAccountId: other.id,
      amount: '2000',
      occurredAt: '2026-11-03',
    });
    expect((await get(h.alice, `/api/savings/wealth?month=${M}`)).capital).toBe(before);

    // A deposit from Участник А's account into Участник Б's part moves the money (a transfer) and reserves it.
    const deposited = await send(h.alice, `/api/savings/pots/${e.fund.id}/movements?month=${M}`, {
      type: 'DEPOSIT',
      amount: '1000',
      date: '2026-11-05',
      subaccountId: e.mPart.id,
      fromAccountId: h.iAccount.id,
      source: 'ACCOUNT',
    });
    expect(pot(deposited.body, 'Emergency').balance).toBe('7000.00');
    const wealth = await get(h.alice, `/api/savings/wealth?month=${M}`);
    expect(wealth).toMatchObject({ capital: before, reserved: '7000.00' });
    const accounts = await get(h.alice, '/api/accounts');
    expect(accounts.find((a: { id: string }) => a.id === h.iAccount.id).balance).toBe('4000.00');

    // Undoing the deposit removes its transfer.
    const movement = pot(deposited.body, 'Emergency').movements[0];
    await send(h.alice, `/api/savings/movements/${movement.id}`, undefined, 'DELETE');
    const restored = await get(h.alice, '/api/accounts');
    expect(restored.find((a: { id: string }) => a.id === h.iAccount.id).balance).toBe('5000.00');
  });

  it('pays planned lines with real amounts, keeps plan and fact apart, reconciles', async () => {
    const h = await household();
    const rent = await send(h.alice, `/api/planner/recurring?month=${M}`, {
      name: 'Аренда',
      amount: '3000',
      category: 'HOUSING',
      startMonth: M,
      isRequired: true,
    });
    const salary = await send(h.alice, `/api/planner/incomes?month=${M}`, {
      name: 'Зарплата',
      amount: '9000',
      startMonth: M,
      ownerId: h.memberA.id,
    });
    const paid = await send(
      h.alice,
      `/api/planner/recurring/${rent.body.id}/payment`,
      {
        month: M,
        paid: true,
        actual: {
          amount: '3100',
          date: '2026-11-02',
          accountId: h.mAccount.id,
          payerId: h.memberB.id,
        },
      },
      'PUT',
    );
    expect(paid.body).toMatchObject({
      paid: true,
      actual: { amount: '3100.00', payerId: h.memberB.id },
    });
    await send(
      h.alice,
      `/api/planner/incomes/${salary.body.id}/receipt`,
      { month: M, amount: '9050', date: '2026-11-10', accountId: h.iAccount.id },
      'PUT',
    );
    // An unplanned expense.
    const categories = await get(h.alice, '/api/categories');
    const groceries = categories.find((c: { name: string }) => c.name === 'Продукты');
    await send(h.alice, '/api/transactions', {
      type: 'EXPENSE',
      accountId: h.iAccount.id,
      categoryId: groceries.id,
      amount: '400',
      occurredAt: '2026-11-12',
    });

    const budget = await get(h.alice, `/api/planner/months/${M}`);
    expect(budget.fact.income).toEqual({ plan: '9000.00', fact: '9050.00' });
    expect(budget.fact.expenses).toEqual({ plan: '3000.00', fact: '3500.00' });
    expect(budget.fact.unplanned).toBe('400.00');
    expect(budget.fact.rows).toEqual(
      expect.arrayContaining([
        { key: 'HOUSING', kind: 'recurring', plan: '3000.00', fact: '3100.00' },
        { key: 'FOOD', kind: 'recurring', plan: '0.00', fact: '400.00' },
      ]),
    );
    let accounts = await get(h.alice, '/api/accounts');
    expect(accounts.find((a: { id: string }) => a.id === h.mAccount.id).balance).toBe('6900.00');
    expect(accounts.find((a: { id: string }) => a.id === h.iAccount.id).balance).toBe('13650.00');

    // Unticked: the operation is gone and the money is back.
    await send(
      h.alice,
      `/api/planner/recurring/${rent.body.id}/payment`,
      { month: M, paid: false },
      'PUT',
    );
    accounts = await get(h.alice, '/api/accounts');
    expect(accounts.find((a: { id: string }) => a.id === h.mAccount.id).balance).toBe('10000.00');

    // Reconciliation: the bank says 9 950 — a correction, not spending.
    const fixed = await send(h.alice, `/api/accounts/${h.mAccount.id}/reconcile`, {
      balance: '9950',
      date: '2026-11-20',
    });
    expect(fixed.body.balance).toBe('9950.00');
    const after = await get(h.alice, `/api/planner/months/${M}`);
    expect(after.fact.expenses.fact).toBe('400.00');
  });

  it('scenario 10 and scenarios: currencies convert, scenarios differ', async () => {
    const h = await household();
    const euro = await createAccount(h.alice, 'EUR счет', 'EUR', '1000');
    const created = await send(h.alice, '/api/savings/pots', {
      name: 'Georgia',
      kind: 'CASH',
      currency: 'EUR',
      target: '3000',
    });
    const part = pot(created.body, 'Georgia').subaccounts[0];
    await send(
      h.alice,
      `/api/savings/subaccounts/${part.id}`,
      { accountId: euro.id, balance: '600' },
      'PATCH',
    );
    const wealth = await get(h.alice, `/api/savings/wealth?month=${M}`);
    // 10 000 + 5 000 PLN + 1 000 EUR × 4.25; the 600 EUR of the fund are a part of the EUR account.
    expect(wealth).toMatchObject({ capital: '19250.00', reserved: '2550.00' });

    await send(h.alice, `/api/planner/incomes?month=${M}`, {
      name: 'Доход',
      amount: '10000',
      startMonth: M,
    });
    await send(
      h.alice,
      `/api/savings/subaccounts/${part.id}/rule`,
      { mode: 'REMAINDER', max: '500', startMonth: M },
      'PUT',
    );
    const result = await send(
      h.alice,
      `/api/scenarios?from=${M}&months=6`,
      { kind: 'PESSIMISTIC', income: '-90', expenses: '0' },
      'PUT',
    );
    const byKind = Object.fromEntries(
      result.body.scenarios.map((s: { kind: string }) => [s.kind, s]),
    );
    expect(byKind.BASE.months[0].netIncome).toBe('10000.00');
    expect(byKind.PESSIMISTIC.months[0].netIncome).toBe('1000.00');
    expect(byKind.OPTIMISTIC.income).toBe('15.00');
    expect(byKind.BASE.funds[0]).toMatchObject({
      name: 'Georgia',
      projected: '3600.00', // 600 + 6 × 500
      reachMonth: '2027-03', // 600 + 5 × 500 ≥ 3 000
    });
    expect(Number(byKind.PESSIMISTIC.funds[0].projected)).toBeLessThan(3000);
  });

  it('members: logins join with a colour; owners must be members', async () => {
    const alice = await createMember('alice@example.com');
    const members = await get(alice, '/api/members');
    expect(members).toEqual([expect.objectContaining({ userId: alice.userId })]);
    const bad = await call(`/api/planner/incomes?month=${M}`, {
      method: 'POST',
      member: alice,
      body: json({ name: 'X', amount: '1', startMonth: M, ownerId: crypto.randomUUID() }),
    });
    expect(bad.status).toBe(422);
    const bob = await createMember('bob@example.com');
    expect(
      (
        await call(`/api/members/${members[0].id}`, {
          method: 'PATCH',
          member: bob,
          body: json({ name: 'Z' }),
        })
      ).status,
    ).toBe(404);
  });

  it('splits joint lines by own shares, equally or by income; owners keep their own', async () => {
    const h = await household();
    await send(h.alice, `/api/planner/incomes?month=${M}`, {
      name: 'Участник Б',
      amount: '6000',
      startMonth: M,
      ownerId: h.memberB.id,
    });
    await send(h.alice, `/api/planner/incomes?month=${M}`, {
      name: 'Участник А',
      amount: '4000',
      startMonth: M,
      ownerId: h.memberA.id,
    });
    const rent = await send(h.alice, `/api/planner/recurring?month=${M}`, {
      name: 'Аренда',
      amount: '3000',
      startMonth: M,
    });
    await send(h.alice, `/api/planner/recurring?month=${M}`, {
      name: 'Курсы',
      amount: '500',
      startMonth: M,
      ownerId: h.memberA.id,
    });
    const owner = (b: { byOwner: { ownerId: string }[] }, id: string) =>
      b.byOwner.find((o) => o.ownerId === id);
    // The login of the household is a member too: the joint rent is split in three equally.
    const members = await get(h.alice, '/api/members');
    expect(members).toHaveLength(3);
    let budget = await get(h.alice, `/api/planner/months/${M}`);
    expect(owner(budget, h.memberA.id)).toMatchObject({
      netIncome: '4000.00',
      expenses: '1500.00',
    });

    // Own shares 70 / 30.
    budget = (
      await send(
        h.alice,
        `/api/planner/shares/${rent.body.id}?month=${M}`,
        {
          shares: [
            { memberId: h.memberB.id, share: '70' },
            { memberId: h.memberA.id, share: '30' },
          ],
        },
        'PUT',
      )
    ).body;
    expect(owner(budget, h.memberB.id)).toMatchObject({ expenses: '2100.00' });
    expect(owner(budget, h.memberA.id)).toMatchObject({ expenses: '1400.00' });
    expect(budget.recurring.find((r: { id: string }) => r.id === rent.body.id).shares).toEqual([
      { memberId: h.memberB.id, share: '70.00' },
      { memberId: h.memberA.id, share: '30.00' },
    ]);
    const bad = await call(`/api/planner/shares/${rent.body.id}?month=${M}`, {
      method: 'PUT',
      member: h.alice,
      body: json({ shares: [{ memberId: h.memberA.id, share: '60' }] }),
    });
    expect(bad.status).toBe(400);

    // Back to the default, now by income: 6 000 : 4 000 : 0.
    await send(h.alice, `/api/planner/shares/${rent.body.id}?month=${M}`, { shares: [] }, 'PUT');
    await send(h.alice, '/api/planner/settings', { jointSplit: 'INCOME' }, 'PATCH');
    budget = await get(h.alice, `/api/planner/months/${M}`);
    expect(owner(budget, h.memberB.id)).toMatchObject({ expenses: '1800.00' });
    expect(owner(budget, h.memberA.id)).toMatchObject({ expenses: '1700.00' });
  });

  it('scenario months have their own percentages', async () => {
    const h = await household();
    await send(h.alice, `/api/planner/incomes?month=${M}`, {
      name: 'Доход',
      amount: '10000',
      startMonth: M,
    });
    const result = await send(
      h.alice,
      `/api/scenarios/months?from=${M}&months=3`,
      { kind: 'PESSIMISTIC', month: '2026-12', income: '-50', expenses: '0' },
      'PUT',
    );
    const pessimistic = result.body.scenarios.find(
      (s: { kind: string }) => s.kind === 'PESSIMISTIC',
    );
    expect(pessimistic.months.map((m: { netIncome: string }) => m.netIncome)).toEqual([
      '8500.00',
      '5000.00',
      '8500.00',
    ]);
    expect(pessimistic.months[1]).toMatchObject({ custom: true, incomePercent: '-50.00' });
    const cleared = await send(
      h.alice,
      `/api/scenarios/months?from=${M}&months=3`,
      { kind: 'PESSIMISTIC', month: '2026-12', income: null, expenses: null },
      'PUT',
    );
    expect(cleared.body.scenarios[0].months.map((m: { custom: boolean }) => m.custom)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('one fund holds parts of several members, accounts and currencies', async () => {
    const h = await household();
    const euro = await createAccount(h.alice, 'EUR Участник А', 'EUR', '1000');
    const e = await emergency(h);
    const created = await send(h.alice, `/api/savings/pots/${e.fund.id}/subaccounts?month=${M}`, {
      name: 'Участник А EUR',
      currency: 'EUR',
      ownerId: h.memberA.id,
      accountId: euro.id,
      balance: '100',
    });
    const fund = pot(created.body, 'Emergency');
    // 4 000 + 2 000 PLN + 100 EUR × 4.25
    expect(fund.balance).toBe('6425.00');
    const eur = fund.subaccounts.find((s: { name: string }) => s.name === 'Участник А EUR');
    expect(eur).toMatchObject({ currency: 'EUR', balance: '100.00', valueInFund: '425.00' });
    // A PLN account cannot hold the EUR part.
    const wrong = await call(`/api/savings/subaccounts/${eur.id}`, {
      method: 'PATCH',
      member: h.alice,
      body: json({ accountId: h.mAccount.id }),
    });
    expect(wrong.status).toBe(422);
    const accounts = await get(h.alice, '/api/accounts');
    expect(accounts.find((a: { id: string }) => a.id === euro.id).reserved).toBe('100.00');
  });

  it('remainder mode: everything left is savings, the rest of the fund plans is unallocated', async () => {
    const h = await household();
    const e = await emergency(h);
    await send(h.alice, `/api/planner/incomes?month=${M}`, {
      name: 'Доход',
      amount: '10000',
      startMonth: M,
    });
    await send(h.alice, `/api/planner/recurring?month=${M}`, {
      name: 'Аренда',
      amount: '4000',
      startMonth: M,
    });
    await send(
      h.alice,
      '/api/planner/settings',
      { savingsMode: 'REMAINDER', minFree: '500' },
      'PATCH',
    );
    let budget = await get(h.alice, `/api/planner/months/${M}`);
    expect(budget.savingsPlan).toMatchObject({
      source: 'FUNDS',
      unallocated: '5500.00',
      total: '5500.00',
    });
    expect(budget.totals).toMatchObject({ savingsTarget: '5500.00', free: '500.00' });
    await send(
      h.alice,
      `/api/savings/subaccounts/${e.mPart.id}/rule`,
      { mode: 'FIXED', amount: '2000', startMonth: M },
      'PUT',
    );
    budget = await get(h.alice, `/api/planner/months/${M}`);
    expect(budget.savingsPlan).toMatchObject({ unallocated: '3500.00', total: '5500.00' });
  });

  it('automatic operations run on their day; amounts change for one month or onwards', async () => {
    const h = await household();
    const e = await emergency(h);
    const now = new Date().toISOString().slice(0, 7);
    const prev = (m: string, n: number) => {
      const [y, mo] = m.split('-').map(Number);
      const d = new Date(Date.UTC(y!, mo! - 1 - n, 1));
      return d.toISOString().slice(0, 7);
    };
    const start = prev(now, 2);
    const made = await send(h.alice, `/api/savings/subaccounts/${e.mPart.id}/auto?month=${now}`, {
      type: 'WITHDRAWAL',
      amount: '100',
      day: 1,
      startMonth: start,
    });
    // Three months are due (two past ones and this one, its day 1 has come).
    let part = pot(made.body, 'Emergency').subaccounts.find(
      (s: { id: string }) => s.id === e.mPart.id,
    );
    expect(part.balance).toBe('3700.00');
    const rule = part.autoRules[0];
    expect(rule).toMatchObject({ type: 'WITHDRAWAL', amount: '100.00', done: true });

    // This month only: 250 — the made movement follows.
    let res = await send(
      h.alice,
      `/api/savings/auto/${rule.id}/amount?month=${now}`,
      { month: now, amount: '250', scope: 'MONTH' },
      'PUT',
    );
    part = pot(res.body, 'Emergency').subaccounts.find((s: { id: string }) => s.id === e.mPart.id);
    expect(part.balance).toBe('3550.00');
    expect(part.autoRules[0]).toMatchObject({ amount: '250.00', overridden: true });

    // From the previous month on: 50.
    res = await send(
      h.alice,
      `/api/savings/auto/${rule.id}/amount?month=${now}`,
      { month: prev(now, 1), amount: '50', scope: 'FORWARD' },
      'PUT',
    );
    part = pot(res.body, 'Emergency').subaccounts.find((s: { id: string }) => s.id === e.mPart.id);
    // 4 000 − 100 (two months ago) − 50 − 50
    expect(part.balance).toBe('3800.00');

    // Reloading never repeats a month.
    const again = await get(h.alice, `/api/savings?month=${now}`);
    expect(
      pot(again, 'Emergency').subaccounts.find((s: { id: string }) => s.id === e.mPart.id).balance,
    ).toBe('3800.00');
  });

  it('fund money lives on accounts: deposits add, withdrawals take, returns put back, it moves with the part', async () => {
    const h = await household();
    const e = await emergency(h);
    const balanceOf = async (id: string) =>
      (await get(h.alice, '/api/accounts')).find((a: { id: string }) => a.id === id) as {
        balance: string;
        reserved: string;
        available: string;
      };
    expect(await balanceOf(h.mAccount.id)).toMatchObject({
      balance: '10000.00',
      reserved: '4000.00',
    });

    // New money: the account grows with the part, nothing becomes negative.
    await send(h.alice, `/api/savings/pots/${e.fund.id}/movements?month=${M}`, {
      type: 'DEPOSIT',
      amount: '5000',
      date: '2026-11-05',
      subaccountId: e.mPart.id,
    });
    expect(await balanceOf(h.mAccount.id)).toMatchObject({
      balance: '15000.00',
      reserved: '9000.00',
      available: '6000.00',
    });
    // The plan/fact of the month does not see it as income.
    expect((await get(h.alice, `/api/planner/months/${M}`)).fact.income.fact).toBe('0.00');

    // A withdrawal to be returned takes the money off the account; the return puts it back.
    const out = await send(h.alice, `/api/savings/pots/${e.fund.id}/movements?month=${M}`, {
      type: 'WITHDRAWAL',
      amount: '1000',
      date: '2026-11-10',
      subaccountId: e.mPart.id,
      repayMonth: '2026-12',
    });
    expect((await balanceOf(h.mAccount.id)).balance).toBe('14000.00');
    const withdrawal = pot(out.body, 'Emergency').movements[0];
    await send(
      h.alice,
      `/api/savings/movements/${withdrawal.id}/returned`,
      { returned: true },
      'PUT',
    );
    expect(await balanceOf(h.mAccount.id)).toMatchObject({
      balance: '15000.00',
      reserved: '9000.00',
    });

    // Money brought from elsewhere onto an account.
    await send(h.alice, `/api/accounts/${h.iAccount.id}/topup`, {
      amount: '3500',
      date: '2026-11-01',
    });
    expect((await balanceOf(h.iAccount.id)).balance).toBe('8500.00');

    // The part moves to another account: its operations move with it.
    const house = await createAccount(h.alice, 'Emergency счет', 'PLN', '0');
    await send(h.alice, `/api/savings/subaccounts/${e.mPart.id}`, { accountId: house.id }, 'PATCH');
    expect(await balanceOf(house.id)).toMatchObject({ balance: '9000.00', reserved: '9000.00' });
    expect((await balanceOf(h.mAccount.id)).balance).toBe('6000.00');
  });

  it('a deposit is corrected in place: amount and month, with its account operation', async () => {
    const h = await household();
    const e = await emergency(h);
    const made = await send(h.alice, `/api/savings/pots/${e.fund.id}/movements?month=2026-10`, {
      type: 'DEPOSIT',
      amount: '5000',
      date: '2026-10-20',
      subaccountId: e.mPart.id,
    });
    const deposit = pot(made.body, 'Emergency').movements[0];
    // The card shows the month's movements only.
    expect(pot(await get(h.alice, `/api/savings?month=${M}`), 'Emergency').movements).toEqual([]);

    const fixed = await send(
      h.alice,
      `/api/savings/movements/${deposit.id}?month=${M}`,
      { amount: '4900', date: '2026-11-03' },
      'PATCH',
    );
    const fund = pot(fixed.body, 'Emergency');
    expect(fund.movements).toEqual([
      expect.objectContaining({ id: deposit.id, amount: '4900.00', date: '2026-11-03' }),
    ]);
    expect(fund.deposited).toBe('4900.00');
    const accounts = await get(h.alice, '/api/accounts');
    expect(accounts.find((a: { id: string }) => a.id === h.mAccount.id).balance).toBe('14900.00');
    const ops = await get(h.alice, `/api/transactions?month=${M}&account=${h.mAccount.id}`);
    expect(ops.items.map((t: { amount: string }) => t.amount)).toContain('4900.00');

    // The full history of the fund lists every month.
    const history = await get(h.alice, `/api/savings/pots/${e.fund.id}/movements`);
    expect(history).toHaveLength(1);
  });
});

describe('confirmed savings and removal history', () => {
  it('keeps scheduled deposits planned until confirmed, once per month', async () => {
    const h = await household();
    const e = await emergency(h);
    const now = new Date().toISOString().slice(0, 7);
    const created = await send(
      h.alice,
      `/api/savings/subaccounts/${e.iPart.id}/auto?month=${now}`,
      {
        type: 'DEPOSIT',
        amount: '125.50',
        day: 1,
        startMonth: now,
      },
    );
    const part = pot(created.body, 'Emergency').subaccounts.find(
      (s: { id: string }) => s.id === e.iPart.id,
    );
    expect(part).toMatchObject({ balance: '2000.00', forecast: '2125.50' });
    expect(part.autoRules[0].done).toBe(false);
    const id = part.autoRules[0].id;
    await send(h.alice, `/api/savings/auto/${id}/confirm?month=${now}`);
    const again = await send(h.alice, `/api/savings/auto/${id}/confirm?month=${now}`);
    expect(
      pot(again.body, 'Emergency').subaccounts.find((s: { id: string }) => s.id === e.iPart.id),
    ).toMatchObject({ balance: '2125.50', forecast: '2125.50', deposited: '125.50' });
    expect(
      (await get(h.alice, '/api/accounts')).find((a: { id: string }) => a.id === h.iAccount.id)
        .balance,
    ).toBe('5125.50');
  });

  it('confirms only the outstanding part of a monthly plan', async () => {
    const h = await household();
    const e = await emergency(h);
    await send(
      h.alice,
      `/api/savings/subaccounts/${e.iPart.id}/plan?month=${M}`,
      { month: M, amount: '300' },
      'PUT',
    );
    await send(h.alice, `/api/savings/pots/${e.fund.id}/movements?month=${M}`, {
      type: 'DEPOSIT',
      amount: '100',
      date: M + '-01',
      subaccountId: e.iPart.id,
    });
    const done = await send(
      h.alice,
      `/api/savings/subaccounts/${e.iPart.id}/confirm-plan?month=${M}`,
    );
    expect(
      pot(done.body, 'Emergency').subaccounts.find((s: { id: string }) => s.id === e.iPart.id),
    ).toMatchObject({ balance: '2300.00', deposited: '300.00' });
    const twice = await send(
      h.alice,
      `/api/savings/subaccounts/${e.iPart.id}/confirm-plan?month=${M}`,
    );
    expect(pot(twice.body, 'Emergency').balance).toBe('6300.00');
  });

  it('removes a part with movements without deleting money, and retains its audit history', async () => {
    const h = await household();
    const e = await emergency(h);
    await send(h.alice, `/api/savings/pots/${e.fund.id}/movements?month=${M}`, {
      type: 'DEPOSIT',
      amount: '100',
      date: M + '-01',
      subaccountId: e.iPart.id,
    });
    const removed = await send(
      h.alice,
      `/api/savings/subaccounts/${e.iPart.id}?month=${M}`,
      undefined,
      'DELETE',
    );
    expect(pot(removed.body, 'Emergency').balance).toBe('4000.00');
    expect(
      (await get(h.alice, '/api/accounts')).find((a: { id: string }) => a.id === h.iAccount.id),
    ).toMatchObject({ balance: '5100.00', reserved: '0.00' });
    const events = await get(h.alice, `/api/savings/pots/${e.fund.id}/part-history`);
    expect(
      events
        .filter((r: { subaccountId: string }) => r.subaccountId === e.iPart.id)
        .map((r: { type: string }) => r.type),
    ).toEqual(['REMOVED', 'ADDED']);
    expect(await get(h.alice, `/api/savings/pots/${e.fund.id}/movements`)).toHaveLength(1);
    const stranger = await createMember('bob@example.com');
    expect(
      (await call(`/api/savings/pots/${e.fund.id}/part-history`, { member: stranger })).status,
    ).toBe(404);
  });
});
