import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app-env';
import { requireScope, type Scope } from './service-context';

/** Areas with both levels (read-only areas such as messages are checked by their services). */
type AreaOf<S> = S extends `${infer A}:write` ? A : never;
type Area = AreaOf<Scope>;

/**
 * Coarse permission of a route group: reading needs `<area>:read`, any other method
 * `<area>:write`. Services check the same scopes again, so another transport (cron, a future MCP
 * tool) that calls them directly is held to the same rules.
 */
export const requireArea =
  (area: Area): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const reading = c.req.method === 'GET' || c.req.method === 'HEAD';
    requireScope(c.var.auth, reading ? `${area}:read` : `${area}:write`);
    await next();
  };
