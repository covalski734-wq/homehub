// Restore point before a production migration: records the current D1 Time Travel bookmark.
//
// D1 keeps point-in-time history (Time Travel), so a bookmark taken right before
// `db:migrate:remote` is enough to roll the whole database back if a migration goes wrong:
//   pnpm --filter @homehub/api exec wrangler d1 time-travel restore DB --bookmark=<bookmark>
// The bookmark is printed and appended to .wrangler/d1-bookmarks.jsonl (git-ignored).
// History is kept for a limited time (see the Cloudflare D1 Time Travel docs for your plan).
//
// Usage: pnpm --filter @homehub/api db:bookmark:remote
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(
  'pnpm',
  ['exec', 'wrangler', 'd1', 'time-travel', 'info', 'DB', '--json'],
  { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' },
);
if (result.status !== 0) {
  console.error(result.stdout, result.stderr);
  console.error('✗ Could not get a Time Travel bookmark: do not migrate without a restore point.');
  process.exit(1);
}

let info;
try {
  info = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
} catch {
  console.error(result.stdout);
  console.error('✗ Unexpected answer from wrangler: do not migrate without a restore point.');
  process.exit(1);
}
const bookmark = info.bookmark;
if (typeof bookmark !== 'string' || !bookmark) {
  console.error(result.stdout);
  console.error('✗ No bookmark in the answer: do not migrate without a restore point.');
  process.exit(1);
}

const record = { takenAt: new Date().toISOString(), bookmark };
mkdirSync(join(root, '.wrangler'), { recursive: true });
appendFileSync(join(root, '.wrangler', 'd1-bookmarks.jsonl'), `${JSON.stringify(record)}\n`);
console.log(`✓ Restore point: ${bookmark}`);
console.log(
  `  Roll back with: pnpm --filter @homehub/api exec wrangler d1 time-travel restore DB --bookmark=${bookmark}`,
);
