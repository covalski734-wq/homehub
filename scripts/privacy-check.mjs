import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const bad = [];
for (const file of new Set(files)) {
  if (!existsSync(file)) continue;
  if (
    /(^|\/)(secrets|\.wrangler|node_modules|backups|exports)(\/|$)|\.(sqlite|db|xlsx|csv|pem|key)$|(^|\/)\.dev\.vars$|(^|\/)\.env$/.test(
      file,
    )
  ) {
    bad.push(file + ': private artifact');
    continue;
  }
  if (file === 'pnpm-lock.yaml' || file.endsWith('privacy-check.mjs')) continue;
  const s = readFileSync(file, 'utf8');
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|glpat-[A-Za-z0-9_-]{20,}/.test(
      s,
    )
  )
    bad.push(file + ': possible credential');
  const emails = s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  if (
    emails.some(
      (e) => !/@(?:example\.(?:com|org|net|invalid)|localhost|homehub\.invalid)$/i.test(e),
    )
  )
    bad.push(file + ': non-example email');
  if (/https?:\/\/(?![^/]*example\.)[a-z0-9.-]+\.workers\.dev\b/i.test(s))
    bad.push(file + ': deployment address');
}
if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
console.log(
  'Privacy checks passed for ' +
    new Set(files).size +
    ' files. Review content manually before publishing; this scanner is not exhaustive.',
);
