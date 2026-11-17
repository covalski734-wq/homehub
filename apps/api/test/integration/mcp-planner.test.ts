import type { PersonalTokenCreatedDto, Scope } from '@homehub/shared';
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { call, createMember, json, resetDb, type Member } from '../helpers';

/** The planner and scenario tools of the MCP endpoint go through the same services as the app. */

beforeEach(resetDb);

const ORIGIN = 'http://localhost';
const P = '/api/planner';

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

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: { type: string; text: string }[];
}

async function tool(secret: string, name: string, args: unknown = {}): Promise<ToolResult> {
  const res = await mcp(secret, 'tools/call', { name, arguments: args });
  expect(res.status).toBe(200);
  return res.body.result as ToolResult;
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

describe('MCP planner tools', () => {
  it('a read-only token sees the reads and none of the writes', async () => {
    const alice = await createMember('alice@example.com');
    const secret = await personalToken(alice, ['planner:read', 'savings:read']);
    const list = await mcp(secret, 'tools/list');
    const names: string[] = list.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'planner_list_incomes',
        'planner_month_budget',
        'savings_get_scenarios',
      ]),
    );
    expect(names).not.toContain('planner_create_income');
    expect(names).not.toContain('planner_delete_purchase');
    expect(names).not.toContain('savings_update_scenario');
  });

  it('creates, changes and stops incomes and regular payments as the app sees them', async () => {
    const alice = await createMember('alice@example.com');
    const secret = await personalToken(alice, ['planner:read', 'planner:write']);

    const created = await tool(secret, 'planner_create_income', {
      data: { name: 'Salary', amount: '8000', startMonth: '2026-01' },
      month: '2026-03',
    });
    expect(created.isError).toBeFalsy();
    const income = created.structuredContent as { id: string; version: number; name: string };
    expect(income.name).toBe('Salary');

    const renamed = await tool(secret, 'planner_update_income', {
      id: income.id,
      data: { name: 'Main salary', version: income.version },
      month: '2026-03',
    });
    expect(renamed.structuredContent).toMatchObject({ name: 'Main salary' });

    const raised = await tool(secret, 'planner_set_income_amount', {
      id: income.id,
      data: { month: '2026-04', amount: '9000', scope: 'FORWARD' },
    });
    expect(raised.isError).toBeFalsy();

    const app = await call(`${P}/incomes?month=2026-05`, { member: alice });
    expect(app.body).toEqual([expect.objectContaining({ name: 'Main salary', gross: '9000.00' })]);
    const listed = await tool(secret, 'planner_list_incomes', { month: '2026-03' });
    expect(listed.structuredContent?.items).toEqual([
      expect.objectContaining({ id: income.id, gross: '8000.00' }),
    ]);

    const rent = await tool(secret, 'planner_create_recurring', {
      data: { name: 'Rent', amount: '2500', startMonth: '2026-03' },
    });
    const rentId = (rent.structuredContent as { id: string }).id;
    // Stopping at the first month removes the line.
    const stopped = await tool(secret, 'planner_stop_recurring', {
      id: rentId,
      data: { month: '2026-03' },
    });
    expect(stopped.structuredContent).toEqual({ result: 'deleted' });
    expect((await call(`${P}/recurring?month=2026-03`, { member: alice })).body).toEqual([]);
  });

  it('runs a purchase through update, status change, history and delete', async () => {
    const alice = await createMember('alice@example.com');
    const secret = await personalToken(alice, ['planner:read', 'planner:write']);

    const created = await tool(secret, 'planner_create_purchase', {
      data: { title: 'TV', estimatedAmount: '3000', plannedMonth: '2026-12' },
    });
    const tv = created.structuredContent as { id: string; version: number };

    const updated = await tool(secret, 'planner_update_purchase', {
      id: tv.id,
      data: { estimatedAmount: '2800', version: tv.version },
    });
    const after = updated.structuredContent as { version: number; estimatedAmount: string };
    expect(after.estimatedAmount).toBe('2800.00');

    // A stale version is refused by the service.
    const stale = await tool(secret, 'planner_set_purchase_status', {
      id: tv.id,
      action: 'cancel',
      data: { version: tv.version },
    });
    expect(stale.isError).toBe(true);

    const cancelled = await tool(secret, 'planner_set_purchase_status', {
      id: tv.id,
      action: 'cancel',
      data: { version: after.version },
    });
    expect(cancelled.structuredContent).toMatchObject({ status: 'CANCELLED' });

    const history = await tool(secret, 'planner_purchase_history', { id: tv.id });
    expect((history.structuredContent?.items as { type: string }[]).map((e) => e.type)).toContain(
      'CANCELLED',
    );

    const deleted = await tool(secret, 'planner_delete_purchase', { id: tv.id });
    expect(deleted.structuredContent).toEqual({ ok: true });
    expect((await call(`${P}/purchases`, { member: alice })).body).toEqual([]);
  });

  it('changes scenarios in the savings area', async () => {
    const alice = await createMember('alice@example.com');
    const secret = await personalToken(alice, ['savings:read', 'savings:write']);
    const set = await tool(secret, 'savings_update_scenario', {
      data: { kind: 'PESSIMISTIC', income: '-10', expenses: '5' },
    });
    expect(set.isError).toBeFalsy();
    const read = await tool(secret, 'savings_get_scenarios', { from: '2026-11', months: 2 });
    const app = await call('/api/scenarios?from=2026-11&months=2', { member: alice });
    expect(read.structuredContent).toEqual(app.body);
    expect(JSON.stringify(app.body)).toContain('-10');
  });
});
