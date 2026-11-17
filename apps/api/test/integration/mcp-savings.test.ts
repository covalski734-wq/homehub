import type {
  MemberDto,
  PersonalTokenCreatedDto,
  SavingsOverviewDto,
  Scope,
} from '@homehub/shared';
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { call, createMember, json, resetDb, type Member } from '../helpers';

/** The savings and household tools: funds, money in and out, members — through the services. */

beforeEach(resetDb);

const ORIGIN = 'http://localhost';

async function mcp(secret: string, method: string, params: unknown = {}) {
  const response = await exports.default.fetch(
    new Request(`${ORIGIN}/api/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

interface ToolResult<T = Record<string, unknown>> {
  isError?: boolean;
  structuredContent?: T;
  content: { type: string; text: string }[];
}

async function tool<T = Record<string, unknown>>(
  secret: string,
  name: string,
  args: unknown = {},
): Promise<ToolResult<T>> {
  const res = await mcp(secret, 'tools/call', { name, arguments: args });
  expect(res.status).toBe(200);
  const result = res.body.result as ToolResult<T>;
  expect(result.isError, result.content[0]?.text).toBeFalsy();
  return result;
}

async function personalToken(member: Member, scopes: Scope[]) {
  const res = await call<PersonalTokenCreatedDto>('/api/access/tokens', {
    method: 'POST',
    member,
    body: json({ name: 'Claude Code', scopes, expiresInDays: 30 }),
  });
  expect(res.status).toBe(201);
  return res.body.secret;
}

async function overview(secret: string) {
  const res = await tool<SavingsOverviewDto>(secret, 'savings_overview', { month: '2026-11' });
  if (!res.structuredContent) throw new Error('no overview');
  return res.structuredContent;
}

describe('MCP savings and household tools', () => {
  it('a read-only token sees the read tools only', async () => {
    const alice = await createMember('alice@example.com');
    const secret = await personalToken(alice, ['savings:read', 'household:read']);
    const list = await mcp(secret, 'tools/list');
    const names: string[] = list.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'savings_overview',
        'savings_list_movements',
        'household_list_members',
      ]),
    );
    for (const write of ['savings_create_pot', 'savings_add_movement', 'household_create_member'])
      expect(names).not.toContain(write);
  });

  it('creates a fund, deposits and withdraws, fixes and deletes through tools', async () => {
    const alice = await createMember('alice@example.com');
    const secret = await personalToken(alice, [
      'savings:read',
      'savings:write',
      'household:read',
      'household:write',
    ]);

    const created = await tool<{ items: MemberDto[] }>(secret, 'household_create_member', {
      data: { name: 'Bob', color: '#22c55e' },
    });
    const member = created.structuredContent?.items.find((m) => m.name === 'Bob');
    if (!member) throw new Error('no member');
    expect(member.archived).toBe(false);
    await tool(secret, 'household_update_member', { id: member.id, data: { name: 'Robert' } });
    const members = (await tool<{ items: MemberDto[] }>(secret, 'household_list_members'))
      .structuredContent?.items;
    expect(members?.map((m) => m.name)).toContain('Robert');

    const pot0 = await tool(secret, 'savings_create_pot', {
      data: { name: 'Cushion', kind: 'CASH', currency: 'PLN', balance: '1000', ownerId: member.id },
    });
    const potId = pot0.structuredContent?.id;
    expect(typeof potId).toBe('string');

    await tool(secret, 'savings_add_movement', {
      id: potId,
      data: { type: 'DEPOSIT', amount: '500', date: '2026-11-05' },
    });
    const withdrawal = await tool(secret, 'savings_add_movement', {
      id: potId,
      data: { type: 'WITHDRAWAL', amount: '200', date: '2026-11-10' },
    });
    const withdrawalId = withdrawal.structuredContent?.id;

    let pot = (await overview(secret)).pots.find((p) => p.id === potId);
    expect(pot).toMatchObject({ balance: '1300.00', ownerId: member.id });

    await tool(secret, 'savings_update_pot', { id: potId, data: { name: 'Safety cushion' } });
    await tool(secret, 'savings_update_movement', { id: withdrawalId, data: { amount: '300' } });
    pot = (await overview(secret)).pots.find((p) => p.id === potId);
    expect(pot).toMatchObject({ name: 'Safety cushion', balance: '1200.00' });

    const history = await tool(secret, 'savings_list_movements', { id: potId });
    expect(history.structuredContent?.items).toHaveLength(2);

    await tool(secret, 'savings_delete_movement', { id: withdrawalId });
    pot = (await overview(secret)).pots.find((p) => p.id === potId);
    expect(pot?.balance).toBe('1500.00');

    await tool(secret, 'savings_delete_pot', { id: potId });
    const http = await call<SavingsOverviewDto>('/api/savings?month=2026-11', { member: alice });
    expect(http.body.pots).toEqual([]);
  });
});
