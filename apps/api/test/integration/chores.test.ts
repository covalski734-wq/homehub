import { beforeEach, describe, expect, it } from 'vitest';
import { call, createMember, json, resetDb, type Member } from '../helpers';

beforeEach(resetDb);

const C = '/api/chores';

// Responses are asserted structurally with expect(), so the body type defaults to any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function send<T = any>(member: Member, path: string, body?: unknown, method = 'POST') {
  return call<T>(path, { method, member, body: body === undefined ? undefined : json(body) });
}

describe('household chores', () => {
  it('repeats from the day a chore was done, awards points and rotates the assignee', async () => {
    const alice = await createMember('alice@example.com');
    const bob = await createMember('bob@example.com', alice.workspaceId);

    const created = await send(alice, C, {
      title: 'Вынести мусор',
      area: 'KITCHEN',
      intervalDays: 3,
      dueOn: '2026-10-10',
      effort: 2,
      rotate: true,
      assigneeId: alice.userId,
    });
    expect(created.status).toBe(201);
    const chore = created.body;
    expect(chore).toMatchObject({ dueOn: '2026-10-10', doneCount: 0, assigneeId: alice.userId });

    // Done two days late: no on-time bonus; next time counts from the done day; passes to Bob.
    const done = await send(alice, `${C}/${chore.id}/complete`, {
      doneOn: '2026-10-12',
      version: chore.version,
    });
    expect(done.status).toBe(200);
    expect(done.body.completion).toMatchObject({ points: 2, onTime: false, userId: alice.userId });
    expect(done.body.chore).toMatchObject({
      dueOn: '2026-10-15',
      assigneeId: bob.userId,
      lastDoneBy: alice.userId,
      doneCount: 1,
    });

    // Bob is on time: effort + 1 bonus, and the chore goes back to Alice.
    const second = await send(bob, `${C}/${chore.id}/complete`, {
      doneOn: '2026-10-14',
      version: done.body.chore.version,
    });
    expect(second.body.completion).toMatchObject({ points: 3, onTime: true });
    expect(second.body.chore).toMatchObject({ dueOn: '2026-10-17', assigneeId: alice.userId });

    // A stale tab cannot tick it off twice.
    const stale = await send(alice, `${C}/${chore.id}/complete`, {
      doneOn: '2026-10-14',
      version: done.body.chore.version,
    });
    expect(stale.status).toBe(409);

    const overview = await call(`${C}?today=2026-10-14`, { member: bob });
    expect(overview.body.members.map((m: { email: string }) => m.email)).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
    expect(overview.body.completions).toHaveLength(2);
    expect(overview.body.completions[0].userId).toBe(bob.userId);

    // Undoing the latest completion restores the due date and assignee.
    const undone = await send(
      bob,
      `${C}/completions/${second.body.completion.id}`,
      undefined,
      'DELETE',
    );
    expect(undone.body).toMatchObject({
      dueOn: '2026-10-15',
      assigneeId: bob.userId,
      doneCount: 1,
    });
  });

  it('finishes one-off chores, snoozes from today and keeps workspaces apart', async () => {
    const alice = await createMember('alice@example.com');
    const outsider = await createMember('eve@example.com');
    const once = await send(alice, C, {
      title: 'Поменять фильтр',
      intervalDays: null,
      dueOn: '2026-10-01',
    });
    const snoozed = await send(alice, `${C}/${once.body.id}/snooze?today=2026-10-12`, {
      days: 2,
      version: once.body.version,
    });
    // Overdue: snoozing counts from today, not from the missed date.
    expect(snoozed.body.dueOn).toBe('2026-10-14');

    const done = await send(alice, `${C}/${once.body.id}/complete`, {
      doneOn: '2026-10-12',
      version: snoozed.body.version,
    });
    expect(done.body.chore.dueOn).toBeNull();
    const again = await send(alice, `${C}/${once.body.id}/complete`, {
      doneOn: '2026-10-12',
      version: done.body.chore.version,
    });
    expect(again.status).toBe(409);

    // Another household sees nothing and cannot touch it; assignees must be members.
    expect((await call(C, { member: outsider })).body.chores).toEqual([]);
    expect(
      (await send(outsider, `${C}/${once.body.id}`, { title: 'x', version: 3 }, 'PATCH')).status,
    ).toBe(404);
    expect(
      (
        await send(alice, C, {
          title: 'Чужой',
          dueOn: '2026-10-12',
          assigneeId: outsider.userId,
        })
      ).status,
    ).toBe(400);

    const edited = await send(
      alice,
      `${C}/${once.body.id}`,
      {
        title: 'Фильтр воды',
        intervalDays: 90,
        dueOn: '2027-01-10',
        version: done.body.chore.version,
      },
      'PATCH',
    );
    expect(edited.body).toMatchObject({
      title: 'Фильтр воды',
      intervalDays: 90,
      dueOn: '2027-01-10',
    });
    expect((await send(alice, `${C}/${once.body.id}`, undefined, 'DELETE')).status).toBe(204);
    expect((await call(C, { member: alice })).body.chores).toEqual([]);
  });
});
