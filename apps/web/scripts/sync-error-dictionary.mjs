// Writes locales/ru/errors.json from the server's error catalog (ERROR_MESSAGES of
// @homehub/shared, built to dist) and lists the codes Ukrainian still lacks. Run after adding an
// error code: `pnpm --filter @homehub/web run i18n:errors`, then translate the listed codes in
// locales/uk/errors.json. dictionary.test.ts fails until both are complete.
import fs from 'node:fs';
import { ERROR_MESSAGES } from '@homehub/shared';

const dir = new URL('../src/i18n/locales/', import.meta.url);
const ru = Object.fromEntries(Object.entries(ERROR_MESSAGES));
fs.writeFileSync(new URL('ru/errors.json', dir), JSON.stringify(ru, null, 2) + '\n');

const ukFile = new URL('uk/errors.json', dir);
const uk = JSON.parse(fs.readFileSync(ukFile, 'utf8'));
const missing = Object.keys(ru).filter((code) => !uk[code]);
// Removed codes leave Ukrainian too; new ones are listed for translation.
const kept = Object.fromEntries(
  Object.keys(ru).flatMap((code) => (uk[code] ? [[code, uk[code]]] : [])),
);
fs.writeFileSync(ukFile, JSON.stringify(kept, null, 2) + '\n');
if (missing.length) {
  console.log('Translate into locales/uk/errors.json:');
  for (const code of missing) console.log(`  "${code}": ${JSON.stringify(ru[code])}`);
} else console.log(`errors.json: ${Object.keys(ru).length} codes, all translated.`);
