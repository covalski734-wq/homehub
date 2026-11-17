import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { errorMessage, fieldIssues } from '@homehub/shared';
import { ZodError } from 'zod';
import type { TokenCaller } from '../access/access.service';
import { fromDatabaseError, HttpError } from '../lib/http-error';
import type { Services } from '../services';
import { writes, type AnyTool } from './tool';
import { TOOLS } from './tools';

const INSTRUCTIONS = `HomeHub — a household's finances, plan, savings, chores and shopping.
Money is a decimal string with a dot ("1250.50") in the currency of its account, fund or line;
months are "YYYY-MM", dates "YYYY-MM-DD". Ids are UUIDs: list or read first, then change.
Tools that change data are marked; prefer reading tools to answer questions. Errors come as
"CODE: message"; VERSION_CONFLICT-like codes mean the record changed — read it again and retry.`;

function result(value: unknown): CallToolResult {
  const structured =
    value === undefined || value === null
      ? { ok: true }
      : Array.isArray(value)
        ? { items: value }
        : typeof value === 'object'
          ? (value as Record<string, unknown>)
          : { value };
  return {
    content: [{ type: 'text', text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

/** The tool's failure for the model: a stable code, its parameters and a readable message. */
function failure(error: unknown): { code: string; result: CallToolResult } {
  const http = error instanceof HttpError ? error : fromDatabaseError(error);
  if (http) {
    const body = http.toBody();
    return {
      code: http.code,
      result: {
        isError: true,
        content: [{ type: 'text', text: `${http.code}: ${http.message}` }],
        structuredContent: { error: body.error, params: body.params, issues: body.issues },
      },
    };
  }
  if (error instanceof ZodError) {
    const issues = fieldIssues(error);
    return {
      code: 'VALIDATION_FAILED',
      result: {
        isError: true,
        content: [
          {
            type: 'text',
            text: `VALIDATION_FAILED: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
          },
        ],
        structuredContent: { error: 'VALIDATION_FAILED', issues },
      },
    };
  }
  console.error('MCP tool failed', error);
  return {
    code: 'MCP_TOOL_FAILED',
    result: {
      isError: true,
      content: [{ type: 'text', text: `MCP_TOOL_FAILED: ${errorMessage('MCP_TOOL_FAILED')}` }],
    },
  };
}

/**
 * An MCP server for one request (stateless): only the tools the token's scopes allow are listed
 * and callable. Every call of a writing tool is recorded in `mcp_audit`.
 */
export function createMcpServer(
  services: Services,
  caller: TokenCaller,
  tools: readonly AnyTool[] = TOOLS,
): McpServer {
  const server = new McpServer(
    { name: 'homehub', title: 'HomeHub', version: '1.0.0' },
    { instructions: INSTRUCTIONS },
  );
  const env = { ctx: caller.ctx, services };
  for (const tool of tools) {
    if (!caller.ctx.scopes.has(tool.scope)) continue;
    const mutating = writes(tool.scope);
    // A report that refreshes HomeHub's copy of platform data first stays read-only for the
    // assistant (nothing of the user's changes), but its refreshes are recorded like writes.
    const audited = mutating || Boolean(tool.annotations?.refreshesCache);
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: {
          title: tool.title,
          readOnlyHint: !mutating,
          destructiveHint: mutating ? Boolean(tool.annotations?.destructive) : false,
          idempotentHint: mutating ? Boolean(tool.annotations?.idempotent) : true,
          openWorldHint: false,
        },
      },
      async (args: unknown) => {
        try {
          const value = await tool.call(env, args);
          if (audited) await services.access.audit(caller, tool.name, null);
          return result(value);
        } catch (error) {
          const failed = failure(error);
          if (audited) await services.access.audit(caller, tool.name, failed.code);
          return failed.result;
        }
      },
    );
  }
  return server;
}
