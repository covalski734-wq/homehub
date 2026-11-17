import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
const rl = createInterface({ input: stdin, output: stdout });
try {
  if (existsSync('secrets/auth-users.json') || existsSync('apps/api/.dev.vars'))
    throw new Error(
      'Existing configuration found. Back it up and remove it explicitly before generating replacements.',
    );
  const users = [];
  while (true) {
    const email = (await rl.question('Email (empty to finish): ')).trim().toLowerCase();
    if (!email) break;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || users.some((u) => u.email === email)) {
      console.log('Enter a unique valid email.');
      continue;
    }
    const name = (await rl.question('Display name: ')).trim();
    if (!name) continue;
    const password = randomBytes(24).toString('base64url');
    const salt = randomBytes(16);
    const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
    users.push({ email, name, passwordHash: 'pbkdf2:100000:' + salt.toString('hex') + ':' + hash });
    console.log('Save this password in your password manager (shown once): ' + password);
  }
  if (!users.length) throw new Error('No accounts created');
  mkdirSync('secrets', { recursive: true });
  const json = JSON.stringify(users);
  writeFileSync('secrets/auth-users.json', json + '\n', { mode: 0o600 });
  writeFileSync(
    'apps/api/.dev.vars',
    'ENVIRONMENT="development"\nWEB_ORIGIN="http://localhost:5173"\nAUTH_USERS=' +
      ("'" + json.replaceAll("'", '\\u0027') + "'") +
      '\n',
    { mode: 0o600 },
  );
  console.log(
    'Created ignored local configuration and secrets/auth-users.json. Never commit them.',
  );
} finally {
  rl.close();
}
