import { SCOPES } from '@homehub/shared';

/**
 * Discovery documents MCP clients read before connecting: the protected resource (RFC 9728) points
 * to the authorization server (RFC 8414). The Worker and the app share one origin, which is the
 * issuer; these paths are outside /api, so wrangler.jsonc routes /.well-known/oauth-* to the Worker.
 */

export const MCP_PATH = '/api/mcp';

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [origin],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'HomeHub',
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    scopes_supported: SCOPES,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
  };
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=300',
};

/** The well-known documents, or null for any other path. */
export function wellKnown(request: Request, origin: string): Response | null {
  const { pathname } = new URL(request.url);
  if (request.method === 'OPTIONS' && pathname.startsWith('/.well-known/oauth-'))
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
    });
  if (
    pathname === '/.well-known/oauth-protected-resource' ||
    pathname === `/.well-known/oauth-protected-resource${MCP_PATH}`
  )
    return new Response(JSON.stringify(protectedResourceMetadata(origin)), {
      headers: JSON_HEADERS,
    });
  if (
    pathname === '/.well-known/oauth-authorization-server' ||
    pathname === '/.well-known/openid-configuration'
  )
    return new Response(JSON.stringify(authorizationServerMetadata(origin)), {
      headers: JSON_HEADERS,
    });
  return null;
}
