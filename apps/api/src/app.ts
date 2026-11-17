import type { HealthDto } from '@homehub/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './app-env';
import { accessRoutes, oauthRoutes } from './access/access.routes';
import { authRoutes } from './auth/auth.routes';
import { mcpRoutes } from './mcp/mcp.routes';
import { CSRF_HEADER } from './auth/csrf.middleware';
import { getConfig } from './config';
import {
  accountsRoutes,
  budgetsRoutes,
  categoriesRoutes,
  summaryRoutes,
  transactionsRoutes,
} from './finance/finance.routes';
import { fromDatabaseError, HttpError } from './lib/http-error';
import type { Fetcher } from './planner/nbp';
import { plannerRoutes } from './planner/planner.routes';
import { preferencesRoutes } from './preferences/preferences.routes';
import { createServices } from './services';
import { choresRoutes } from './chores/chores.routes';
import { shoppingRoutes } from './shopping/shopping.routes';
import { savingsRoutes } from './savings/savings.routes';
import { membersRoutes } from './members/members.routes';
import { scenariosRoutes } from './savings/scenarios.routes';

/** Isolate start time, set on the first request (Date.now() is frozen at 0 in global scope). */
let isolateStartedAt: number | undefined;

export interface AppOptions {
  /** Tests replace outbound HTTP (NBP exchange rates). */
  fetcher?: Fetcher;
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnv>().basePath('/api');

  app.onError((error, c) => {
    const httpError = error instanceof HttpError ? error : fromDatabaseError(error);
    if (httpError) return c.json(httpError.toBody(), httpError.status as 400);
    console.error('Unhandled error', error);
    return c.json(new HttpError(500, 'INTERNAL').toBody(), 500);
  });

  app.notFound((c) => c.json(new HttpError(404, 'NOT_FOUND').toBody(), 404));

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      crossOriginResourcePolicy: 'same-origin',
      referrerPolicy: 'strict-origin-when-cross-origin',
    }),
  );

  app.use('*', async (c, next) => {
    const config = getConfig(c.env);
    c.set('config', config);
    c.set('services', createServices(c.env.DB, config, options.fetcher, c.env));
    await next();
  });

  // Machine endpoints (MCP, OAuth) are called by apps from anywhere â€” without cookies, so any
  // origin may call them; they authenticate with a bearer token or PKCE.
  const machineCors = cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Protocol-Version', 'Mcp-Session-Id'],
    exposeHeaders: ['WWW-Authenticate', 'Mcp-Session-Id'],
  });
  app.use('/mcp', machineCors);
  app.use('/oauth/*', machineCors);

  // Same origin by default (the Worker serves the SPA). CORS only matters if the web app is
  // ever hosted elsewhere, and then only WEB_ORIGIN may send credentialed requests.
  app.use(
    '*',
    cors({
      origin: (origin, c) => (origin === c.var.config.webOrigin ? origin : null),
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowHeaders: ['Content-Type', CSRF_HEADER, 'X-Homehub-Mode'],
      exposeHeaders: ['X-Homehub-Mode'],
    }),
  );

  app.get('/health', async (c) => {
    const database = await c.env.DB.prepare('SELECT 1')
      .first()
      .then(
        () => 'up' as const,
        () => 'down' as const,
      );
    const body: HealthDto = {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      uptimeSeconds: Math.round((Date.now() - (isolateStartedAt ??= Date.now())) / 1000),
    };
    return c.json(body, database === 'up' ? 200 : 503);
  });

  app.route('/auth', authRoutes);
  app.route('/access', accessRoutes);
  app.route('/oauth', oauthRoutes);
  app.route('/mcp', mcpRoutes);
  app.route('/accounts', accountsRoutes);
  app.route('/categories', categoriesRoutes);
  app.route('/transactions', transactionsRoutes);
  app.route('/finance', summaryRoutes);
  app.route('/budgets', budgetsRoutes);
  app.route('/planner', plannerRoutes);
  app.route('/preferences', preferencesRoutes);
  app.route('/chores', choresRoutes);
  app.route('/shopping', shoppingRoutes);
  app.route('/savings', savingsRoutes);
  app.route('/members', membersRoutes);
  app.route('/scenarios', scenariosRoutes);

  return app;
}
