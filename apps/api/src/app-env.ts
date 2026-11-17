import type { AuthContext } from './auth/auth-context';
import type { AppConfig, Bindings } from './config';
import type { Services } from './services';

/** Hono typing for c.env and c.var. */
export interface AppEnv {
  Bindings: Bindings;
  Variables: {
    config: AppConfig;
    services: Services;
    auth: AuthContext;
  };
}
