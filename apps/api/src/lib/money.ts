/**
 * Exact money conversion between API decimal strings ("1500.50") and integer minor units
 * (150050) at a fixed scale of 2. No floating point is involved in either direction.
 */

const MONEY_PATTERN = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;
const SCALE = 100n;

export function toMinor(value: string): bigint {
  const match = MONEY_PATTERN.exec(value.trim());
  if (!match) throw new Error(`Invalid money value: ${value}`);
  const [, sign, units = '0', fraction = ''] = match;
  const minor = BigInt(units) * SCALE + BigInt(fraction.padEnd(2, '0'));
  return sign ? -minor : minor;
}

/**
 * Minor units as a JS number for storage. API validation limits amounts to 12 integer digits,
 * so values stay far below Number.MAX_SAFE_INTEGER; the check guards against misuse.
 */
export function toMinorNumber(value: string): number {
  const minor = toMinor(value);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`Money value out of range: ${value}`);
  }
  return Number(minor);
}

export function formatMinor(minor: bigint | number): string {
  const value = typeof minor === 'bigint' ? minor : BigInt(minor);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const units = abs / SCALE;
  const cents = (abs % SCALE).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${units}.${cents}`;
}

/**
 * Aggregates are read as `CAST(SUM(x) AS TEXT)`: SQLite sums 64-bit integers exactly,
 * and text avoids any precision loss on the way into JavaScript.
 */
export function minorFromSql(value: string | number | bigint | null | undefined): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  return BigInt(value);
}

/** Ratio a/b rounded to 4 decimal places, computed in integers. */
export function ratio(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return 0;
  const scaled = (numerator * 20000n) / denominator;
  const rounded = scaled >= 0n ? (scaled + 1n) / 2n : (scaled - 1n) / 2n;
  return Number(rounded) / 10000;
}
