import { ERROR_MESSAGES } from '@homehub/shared';
import { describe, expect, it } from 'vitest';
import { resources } from './resources';

/**
 * The dictionaries: Russian and Ukrainian have the same keys, placeholders, tags and plural
 * forms; every key the code uses exists and every key exists because the code uses it; error
 * texts follow the server's catalog; no Russian text is left in the code itself.
 */

function flatten(tree: object, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else if (typeof value === 'object' && value !== null)
      for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const ru = flatten(resources.ru);
const uk = flatten(resources.uk);

const sources = Object.entries(
  import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!./**'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
).flatMap(([path, source]) => (typeof source === 'string' ? [[path, source] as const] : []));

const placeholders = (text: string) =>
  [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)]
    .map((m) => m[1])
    .sort()
    .join();
const tags = (text: string) =>
  [...text.matchAll(/<\/?(\w+)\s*\/?>/g)]
    .map((m) => m[0])
    .sort()
    .join();
const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (key: string) => key.replace(PLURAL, '');

/** Literal keys in t('…'), i18nKey="…" and the dynamic prefixes of t(`prefix.${…}`). */
function usage() {
  const keys = new Set<string>();
  const prefixes = new Set<string>();
  for (const [, source] of sources) {
    // Any quoted `module.path` literal: t('a.b'), i18nKey="a.b", t(done ? 'a.b' : 'a.c'), maps.
    for (const m of source.matchAll(/['"]([a-z]+\.[\w.-]+)['"]/g))
      if (ru.has(m[1]!) || ru.has(`${m[1]!}_one`)) keys.add(m[1]!);
    for (const m of source.matchAll(/\bt\(\s*['"]([\w.-]+)['"]/g)) keys.add(m[1]!);
    for (const m of source.matchAll(/i18nKey=["']([\w.-]+)["']/g)) keys.add(m[1]!);
    for (const m of source.matchAll(/\bt\(\s*`([\w.-]*?)\$\{/g)) prefixes.add(m[1]!);
  }
  return { keys, prefixes };
}

describe('dictionaries', () => {
  it('finds the sources (guards against a broken glob)', () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(ru.size).toBeGreaterThan(1000);
  });

  it('Russian and Ukrainian have the same keys', () => {
    expect([...uk.keys()].filter((k) => !ru.has(k))).toEqual([]);
    expect([...ru.keys()].filter((k) => !uk.has(k))).toEqual([]);
  });

  it('keep the same {{placeholders}} and <tags> in both languages', () => {
    const broken = [...ru].filter(([key, text]) => {
      const other = uk.get(key) ?? '';
      return placeholders(text) !== placeholders(other) || tags(text) !== tags(other);
    });
    expect(broken.map(([key]) => key)).toEqual([]);
  });

  it('have no empty texts', () => {
    const empty = [...ru, ...uk].filter(([, text]) => !text.trim()).map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it('plural keys have every form Russian and Ukrainian need', () => {
    const bases = new Set([...ru.keys()].filter((k) => PLURAL.test(k)).map(base));
    const missing = [...bases].flatMap((b) =>
      ['one', 'few', 'many', 'other']
        .map((form) => `${b}_${form}`)
        .filter((key) => !ru.has(key) || !uk.has(key)),
    );
    expect(missing).toEqual([]);
  });

  it('has a text for every key the code uses', () => {
    const { keys } = usage();
    const missing = [...keys].filter(
      (key) => key.includes('.') && !ru.has(key) && !ru.has(`${key}_one`),
    );
    expect(missing).toEqual([]);
  });

  it('has no key that no code uses (dynamic keys are used by their prefix)', () => {
    const { keys, prefixes } = usage();
    const unused = [...ru.keys()].filter(
      (key) =>
        !keys.has(base(key)) &&
        !keys.has(key) &&
        ![...prefixes].some((prefix) => prefix && key.startsWith(prefix)),
    );
    expect(unused).toEqual([]);
  });

  it('error texts are the server catalog: every code, the same Russian text', () => {
    const errors = Object.fromEntries(
      [...ru].filter(([key]) => key.startsWith('errors.')).map(([k, v]) => [k.slice(7), v]),
    );
    expect(errors).toEqual(ERROR_MESSAGES);
  });

  it('every Ukrainian error text is translated', () => {
    const same = Object.keys(ERROR_MESSAGES).filter((code) => {
      const text = uk.get(`errors.${code}`) ?? '';
      // Identical texts are fine only when there is nothing to translate (names, codes).
      return text === ru.get(`errors.${code}`) && /[ыэъё]/i.test(text);
    });
    expect(same).toEqual([]);
  });
});

describe('the code has no texts of its own', () => {
  // Data, not interface text: word stems of the shopping aisle classifier; language names written
  // in their own language.
  const ALLOWED = [/features\/shopping\/aisles\.ts$/, /features\/settings\/settings-page\.tsx$/];

  it('no Russian string literals outside the dictionaries', () => {
    const found: string[] = [];
    for (const [path, source] of sources) {
      if (ALLOWED.some((allowed) => allowed.test(path))) continue;
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const m of code.matchAll(
        /(['"`])((?:\\.|(?!\1)[^\\\n])*[а-яё](?:\\.|(?!\1)[^\\\n])*)\1/gi,
      ))
        found.push(`${path}: ${m[2]}`);
    }
    expect(found).toEqual([]);
  });

  it('no Russian-text keys (the old tr()) are left', () => {
    const legacy = sources
      .filter(([, source]) => /\btr\(|\btrMessage\(/.test(source))
      .map(([path]) => path);
    expect(legacy).toEqual([]);
  });
});
