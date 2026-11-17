import type { MovementDto, PotDto } from '@homehub/shared';
import { fromCents, toCents } from '@/lib/money';

/**
 * Money arithmetic of the savings screens on the API's decimal strings, in integer cents: sums
 * and differences are exact, as on the server. Ratios (bar widths) are plain numbers — they are
 * shares, not money.
 */

/** Sum of amounts; a missing amount (no rate yet) counts as zero. */
export function addMoney(...values: (string | null | undefined)[]): string {
  return fromCents(values.reduce<bigint>((sum, value) => sum + (value ? toCents(value) : 0n), 0n));
}

export function subtractMoney(a: string, b: string): string {
  return fromCents(toCents(a) - toCents(b));
}

/** -1, 0 or 1 by the amount in cents. */
export function moneySign(value: string): -1 | 0 | 1 {
  const cents = toCents(value);
  return cents > 0n ? 1 : cents < 0n ? -1 : 0;
}

export const isPositive = (value: string) => moneySign(value) > 0;
export const isNegative = (value: string) => moneySign(value) < 0;
export const sameMoney = (a: string, b: string) => toCents(a) === toCents(b);

/** `part` as a percentage of `whole` (cents or an amount); 0 when the whole is not positive. */
export function percentOf(part: string, whole: string | bigint): number {
  const wholeCents = typeof whole === 'bigint' ? whole : toCents(whole);
  if (wholeCents <= 0n) return 0;
  return (Number(toCents(part)) / Number(wholeCents)) * 100;
}

/** Positions worth less than one unit of the portfolio currency hide with «Скрыть низкие балансы». */
export function isLowBalance(value: string | null): boolean {
  return value !== null && toCents(value) < 100n;
}

/**
 * A price change: its sign and whether it is below one cent (shown as «<0,01»). The value may
 * carry more than two decimals, so «tiny» means non-zero digits that round away.
 */
export function changeView(value: string): { sign: -1 | 0 | 1; tiny: boolean } {
  const sign = moneySign(value);
  if (sign !== 0) return { sign, tiny: false };
  const tiny = /[1-9]/.test(value);
  return { sign: tiny ? (value.trim().startsWith('-') ? -1 : 1) : 0, tiny };
}

/** Width of a part in the fund bar: the target, when larger than the balance, is the full bar. */
export function partWidth(partBalance: string, potBalance: string, target: string | null): number {
  const total = toCents(potBalance);
  const goal = target ? toCents(target) : 0n;
  return percentOf(partBalance, total > goal ? total : goal);
}

/** «Криптовалюты и акции»: the value of active portfolios in the base currency. */
export function investmentsTotal(portfolios: PotDto[]): { total: string; empty: boolean } {
  const active = portfolios.filter((p) => !p.archived);
  const total = addMoney(...active.map((p) => p.value));
  // Nothing has a rate yet: a dash instead of a misleading zero.
  const noRate = active.some((p) => p.value === null);
  return { total, empty: noRate && moneySign(total) === 0 };
}

/** The whole history of a fund by month (newest first, as the API orders it) with each net. */
export function historyByMonth(
  movements: MovementDto[],
): { month: string; items: MovementDto[]; net: string }[] {
  const months = [...new Set(movements.map((m) => m.date.slice(0, 7)))];
  return months.map((month) => {
    const items = movements.filter((m) => m.date.startsWith(month));
    const net = items.reduce(
      (sum, m) => sum + (m.type === 'DEPOSIT' ? toCents(m.amount) : -toCents(m.amount)),
      0n,
    );
    return { month, items, net: fromCents(net) };
  });
}

/** A non-negative decimal ("0.5", "12,25") as digits and scale; null when it is not a number. */
function parseDecimal(value: string): { digits: bigint; scale: number } | null {
  const normalized = value.trim().replace(',', '.');
  if (normalized === '') return { digits: 0n, scale: 0 };
  const match = /^(\d*)(?:\.(\d*))?$/.exec(normalized);
  if (!match || (match[1] === '' && !match[2])) return null;
  const [, whole = '', fraction = ''] = match;
  return { digits: BigInt(`${whole}${fraction}` || '0'), scale: fraction.length };
}

/**
 * «≈ value» while the quantity of a position is typed: quantity × price rounded to cents
 * (half away from zero, like the money formatter). Empty input counts as zero; anything that is
 * not a number gives no preview.
 */
export function positionValue(quantity: string, price: string | null): string | null {
  if (price === null) return null;
  const q = parseDecimal(quantity);
  const p = parseDecimal(price);
  if (!q || !p) return null;
  const scale = q.scale + p.scale;
  const product = q.digits * p.digits;
  if (scale <= 2) return fromCents(product * 10n ** BigInt(2 - scale));
  const divisor = 10n ** BigInt(scale - 2);
  return fromCents((product + divisor / 2n) / divisor);
}
