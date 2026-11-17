/** Exact money arithmetic on API decimal strings ("1234.50", "-0.07") in integer cents. */
export function toCents(value: string): bigint {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = value.replace('-', '').split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  return negative ? -cents : cents;
}

export function fromCents(cents: bigint): string {
  const abs = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** Sums amounts per currency; different currencies are never added together. */
export function sumByCurrency<C extends string>(
  items: Iterable<{ currency: C; amount: string }>,
): { currency: C; amount: string }[] {
  const sums = new Map<C, bigint>();
  for (const item of items)
    sums.set(item.currency, (sums.get(item.currency) ?? 0n) + toCents(item.amount));
  return [...sums.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([currency, cents]) => ({ currency, amount: fromCents(cents) }));
}

/** Exact sum of API decimal strings, in cents. */
export function sumCents(values: Iterable<string>): bigint {
  let sum = 0n;
  for (const value of values) sum += toCents(value);
  return sum;
}

/** Integer division rounding half away from zero — the server's rounding for money. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
}

export const RATE_MICROS = 1_000_000n;

/** Exchange rate as published ("4.2615", up to six decimals) → micro-units; null if malformed. */
export function rateToMicros(rate: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(rate.trim());
  if (!match?.[1]) return null;
  return BigInt(match[1]) * RATE_MICROS + BigInt((match[2] ?? '').padEnd(6, '0'));
}

/** Cents as a plain number of currency units, only for charts and widths (never summed back). */
export const centsToNumber = (cents: bigint) => Number(cents) / 100;
