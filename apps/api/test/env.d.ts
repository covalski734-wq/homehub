import type { D1Migration } from 'cloudflare:test';
import type { Bindings } from '../src/config';
import type * as MainModule from '../src/index';

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {
      TEST_MIGRATIONS: D1Migration[];
      MIGRATION_DB: D1Database;
    }
    interface GlobalProps {
      mainModule: typeof MainModule;
    }
  }
}
