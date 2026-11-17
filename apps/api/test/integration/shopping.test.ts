import { parseShoppingText } from '@homehub/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { call, createMember, json, resetDb, type Member } from '../helpers';

beforeEach(resetDb);

const S = '/api/shopping';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function send<T = any>(member: Member, path: string, body?: unknown, method = 'POST') {
  return call<T>(path, { method, member, body: body === undefined ? undefined : json(body) });
}

describe('shared shopping list', () => {
  it('parses quick input with quantities', () => {
    expect(parseShoppingText('сок 1,5 л,кефир')).toEqual([
      { title: 'сок', quantity: '1,5 л' },
      { title: 'кефир', quantity: '' },
    ]);
    expect(parseShoppingText('молоко 2 л, хлеб; яйца x10\nсыр')).toEqual([
      { title: 'молоко', quantity: '2 л' },
      { title: 'хлеб', quantity: '' },
      { title: 'яйца', quantity: 'x10' },
      { title: 'сыр', quantity: '' },
    ]);
  });

  it('is shared by the household, skips duplicates and learns what is often bought', async () => {
    const alice = await createMember('alice@example.com');
    const bob = await createMember('bob@example.com', alice.workspaceId);
    const outsider = await createMember('eve@example.com');

    const added = await send(alice, S, {
      items: [{ title: 'Молоко', quantity: '2 л' }, { title: 'Хлеб' }, { title: 'молоко ' }],
    });
    expect(added.status).toBe(201);
    expect(added.body.items.map((i: { title: string }) => i.title)).toEqual(['Молоко', 'Хлеб']);

    // Bob sees Alice's list and ticks off the milk in the store.
    const list = (await call(S, { member: bob })).body;
    const milk = list.items.find((i: { title: string }) => i.title === 'Молоко');
    const ticked = await send(bob, `${S}/${milk.id}`, { checked: true }, 'PATCH');
    expect(ticked.body).toMatchObject({ checked: true });
    expect(ticked.body.checkedAt).not.toBeNull();

    const cleared = await send(alice, `${S}/clear`);
    expect(cleared.body.items.map((i: { title: string }) => i.title)).toEqual(['Хлеб']);
    expect(cleared.body.suggestions).toEqual([{ title: 'Молоко', count: 1 }]);

    // Back on the list: not suggested any more.
    const again = await send(alice, S, { items: [{ title: 'молоко' }] });
    expect(again.body.suggestions).toEqual([]);

    expect((await call(S, { member: outsider })).body.items).toEqual([]);
    expect((await send(outsider, `${S}/${milk.id}`, undefined, 'DELETE')).status).toBe(404);
    expect((await send(alice, S, { items: [] })).status).toBe(400);
  });
});
