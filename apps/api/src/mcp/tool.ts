import type { Scope } from '@homehub/shared';
import type { z } from 'zod';
import type { ServiceContext } from '../lib/service-context';
import type { Services } from '../services';

/** What a tool runs with: the caller's context (a member, the token's scopes) and the services. */
export interface ToolEnv {
  ctx: ServiceContext & { userId: string };
  services: Services;
}

export interface ToolAnnotations {
  /** A read-scoped tool may explicitly refresh its local platform cache. */
  refreshesCache?: boolean;
  /** Deletes or irreversibly changes data (clients ask the user before calling). */
  destructive?: boolean;
  /** Repeating the call with the same input changes nothing more. */
  idempotent?: boolean;
}

/**
 * One MCP tool: a thin adapter over an existing service method. The input is an object schema —
 * shared Zod schemas from @homehub/shared, so the rules are the same as in the app; ids and the
 * body go side by side (`{ id, data }`) so a body schema keeps its refinements. `scope` decides
 * whether the tool is offered to a token at all; the services check write scopes again.
 */
export interface Tool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  scope: Scope;
  input: S;
  annotations?: ToolAnnotations;
  run: (env: ToolEnv, input: z.output<S>) => Promise<unknown>;
}

/** A tool with its input type erased, so tools of every shape fit in one list. */
export interface AnyTool {
  name: string;
  title: string;
  description: string;
  scope: Scope;
  input: z.ZodObject;
  annotations?: ToolAnnotations;
  /** Validates the raw arguments with the tool's schema, then runs it. */
  call: (env: ToolEnv, args: unknown) => Promise<unknown>;
}

export function defineTool<S extends z.ZodObject>(tool: Tool<S>): AnyTool {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    scope: tool.scope,
    input: tool.input,
    annotations: tool.annotations,
    call: (env, args) => tool.run(env, tool.input.parse(args)),
  };
}

export const writes = (scope: Scope) => scope.endsWith(':write');
