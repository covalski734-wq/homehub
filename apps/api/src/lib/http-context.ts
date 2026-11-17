import type { Context } from 'hono';
import type { AppEnv } from '../app-env';
import type { ServiceContext } from './service-context';

/** The service context of an authenticated request (set by requireSession). */
export const serviceContext = (c: Context<AppEnv>): ServiceContext => ({
  workspaceId: c.var.auth.workspaceId,
  userId: c.var.auth.userId,
  scopes: c.var.auth.scopes,
});
