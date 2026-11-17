// Schema compatibility check: the Drizzle schema (src/db/*schema.ts) must match the SQL migrations.
//
// drizzle-kit generates into a temporary copy of migrations/, so the repository is never touched.
// If it would create a new migration, the schema was changed without one (or a migration was
// edited by hand without updating the schema) and the check fails.
//
// It also lists migrations that rebuild a table (`__new_<table>`): SQLite drops the table's
// triggers then, so they must be recreated in the same migration (test/integration/schema-integrity).
//
// Usage: pnpm --filter @homehub/api db:check
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = join(root, 'migrations');
const sqlFiles = () => readdirSync(migrations).filter((file) => file.endsWith('.sql'));

// Inside .wrangler (git-ignored) and passed as a relative path: drizzle-kit joins an absolute
// Windows path onto the working directory.
mkdirSync(join(root, '.wrangler'), { recursive: true });
const work = mkdtempSync(join(root, '.wrangler', 'schema-check-'));
let failed = false;
try {
  cpSync(migrations, work, { recursive: true });
  const before = new Set(readdirSync(work));
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'drizzle-kit',
      'generate',
      '--dialect',
      'sqlite',
      '--schema',
      './src/db/*schema.ts',
      '--out',
      relative(root, work).replaceAll('\\', '/'),
      '--name',
      'schema_check',
    ],
    { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  const created = readdirSync(work).filter((file) => !before.has(file) && file.endsWith('.sql'));
  // drizzle-kit may exit with 0 after an error: only these two outcomes count as a result.
  const unchanged = /No schema changes/i.test(output);
  if (result.status !== 0 || (!unchanged && created.length === 0)) {
    console.error(output);
    throw new Error('drizzle-kit generate did not finish; the schema was not checked');
  }
  if (created.length > 0) {
    failed = true;
    console.error(
      '✗ The Drizzle schema differs from the migrations. drizzle-kit would generate:\n',
    );
    for (const file of created) console.error(readFileSync(join(work, file), 'utf8'));
    console.error('\nRun `pnpm db:generate` and review the new migration (see MIGRATIONS.md).');
  } else {
    console.log(`✓ Drizzle schema matches the ${sqlFiles().length} migrations.`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const rebuilds = sqlFiles().filter((file) =>
  /__new_/.test(readFileSync(join(migrations, file), 'utf8')),
);
if (rebuilds.length > 0)
  console.log(
    `ℹ Table rebuilds (triggers must be recreated, see MIGRATIONS.md): ${rebuilds.join(', ')}`,
  );

process.exit(failed ? 1 : 0);
