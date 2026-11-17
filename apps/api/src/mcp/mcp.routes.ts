import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { errorMessage } from '@homehub/shared';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../app-env';
import { MCP_PATH } from '../access/well-known';
import { createMcpServer } from './server';

/** 401 with the pointer MCP clients follow to start OAuth (RFC 9728 §5.1). */
function unauthorized(c: Context<AppEnv>) {
  const metadata = `${c.var.config.webOrigin}/.well-known/oauth-protected-resource${MCP_PATH}`;
  return c.json(
    {
      statusCode: 401,
      error: 'ACCESS_TOKEN_INVALID',
      message: errorMessage('ACCESS_TOKEN_INVALID'),
    },
    401,
    { 'WWW-Authenticate': `Bearer resource_metadata="${metadata}"` },
  );
}

/**
 * The MCP endpoint (Streamable HTTP, stateless JSON responses): each POST is answered by a fresh
 * server built for the caller's token. No cookies and no CSRF — only `Authorization: Bearer`.
 */
export const mcpRoutes = new Hono<AppEnv>()
  .post('/', async (c) => {
    const header = c.req.header('Authorization') ?? '';
    const secret = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    const caller = secret ? await c.var.services.access.authenticate(secret) : null;
    if (!caller) return unauthorized(c);
    const server = createMcpServer(c.var.services, caller);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  })
  // Stateless: no server-sent stream to open and no session to end.
  .get('/', (c) => c.body(null, 405, { Allow: 'POST' }))
  .delete('/', (c) => c.body(null, 405, { Allow: 'POST' }));
