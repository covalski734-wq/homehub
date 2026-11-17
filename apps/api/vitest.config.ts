import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/**
 * Every test runs inside workerd (the Workers runtime) with a local D1 database that has the
 * real migrations applied (test/setup.ts), so constraints and triggers behave as in production.
 */
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // A second, empty database: migrations are replayed on seeded data (migrations.test.ts).
        d1Databases: ['MIGRATION_DB'],
        bindings: {
          ENVIRONMENT: 'test',
          AUTH_USERS: JSON.stringify(
            ['alice', 'bob', 'eve'].map((name) => ({
              email: name + '@example.com',
              name,
              passwordHash:
                'pbkdf2:100000:00000000000000000000000000000001:924d3b11efea7048947ff2fa3b16105107adb04d8236716f61e4e38d29c6750b',
            })),
          ),
          WEB_ORIGIN: 'http://localhost:5173',
          TEST_MIGRATIONS: await readD1Migrations('./migrations'),
        },
      },
    })),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    // Scenario tests make dozens of requests through workerd and D1; with all files running in
    // parallel (and on 2-core CI runners) the default 5 s is too tight.
    testTimeout: 30_000,
    // Each worker is a workerd process with its own D1 (~400–600 MB). One per core ran out of
    // memory on machines with a few GB free; two keep the run stable and still parallel.
    // VITEST_MAX_WORKERS raises it where memory allows (CI runners have 7 GB).
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS) || 2,
  },
});
