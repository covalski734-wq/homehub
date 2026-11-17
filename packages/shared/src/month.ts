/**
 * Months are represented as "YYYY-MM" strings and operation dates as "YYYY-MM-DD".
 * Dates are calendar dates without time zone, so a month boundary never depends
 * on the server or browser time zone.
 */

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isValidMonth(value: string): boolean {
  return MONTH_PATTERN.test(value);
}

export function isValidDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseMonth(month: string): { year: number; month: number } {
  const match = MONTH_PATTERN.exec(month);
  if (!match) throw new Error(`Invalid month: ${month}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function formatMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function shiftMonth(month: string, delta: number): string {
  const parsed = parseMonth(month);
  const index = parsed.year * 12 + (parsed.month - 1) + delta;
  return formatMonth(Math.floor(index / 12), (index % 12) + 1);
}

export function monthOfDate(date: string): string {
  return date.slice(0, 7);
}

export function currentMonth(now: Date = new Date()): string {
  return formatMonth(now.getFullYear(), now.getMonth() + 1);
}

export function todayDate(now: Date = new Date()): string {
  return `${currentMonth(now)}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Half-open UTC range [start, end) covering the whole month. */
export function monthDateRange(month: string): { start: Date; end: Date } {
  const { year, month: m } = parseMonth(month);
  return {
    start: new Date(Date.UTC(year, m - 1, 1)),
    end: new Date(Date.UTC(year, m, 1)),
  };
}

export function daysInMonth(month: string): number {
  const { year, month: m } = parseMonth(month);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}
