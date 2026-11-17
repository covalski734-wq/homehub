// Prettier check of the project's files as git sees them: tracked files plus new files that are
// not ignored. Personal files that must stay in the working copy uncommitted are listed in the
// local, never committed .git/info/exclude (see DEVELOPMENT.md) and are then skipped — prettier
// itself does not read git's excludes. CI sees only committed files anyway.
// Usage: node scripts/format-check.mjs [--write]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean);

const tracked = git('ls-files', '--cached');
const untracked = git('ls-files', '--others', '--exclude-standard');
// A tracked file deleted in the working copy is not checked.
const files = [...new Set([...tracked, ...untracked])].filter((file) => existsSync(file));
const write = process.argv.includes('--write');

const unformatted = [];
for (const file of files) {
  // .prettierignore and unknown file types (binaries, lockfiles) are skipped.
  const info = await prettier.getFileInfo(file, { ignorePath: '.prettierignore' });
  if (info.ignored || !info.inferredParser) continue;
  const options = { ...(await prettier.resolveConfig(file)), filepath: file };
  const source = readFileSync(file, 'utf8');
  if (await prettier.check(source, options)) continue;
  if (write) writeFileSync(file, await prettier.format(source, options));
  else unformatted.push(file);
}

if (unformatted.length) {
  console.error(`Prettier: ${unformatted.length} files need formatting:`);
  for (const file of unformatted) console.error(`  ${file}`);
  process.exit(1);
}
console.log(`Prettier ${write ? '--write' : '--check'}: ${files.length} files.`);
