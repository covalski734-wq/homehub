/**
 * Calendar dates of the server. The household lives in Poland: «today» and «this month» are those
 * of Europe/Warsaw, not of UTC — at 00:30 in Warsaw an automatic deposit for that day is due,
 * although UTC still shows the day before. Dates are "YYYY-MM-DD", months "YYYY-MM".
 */
export const HOUSEHOLD_TIME_ZONE = 'Europe/Warsaw';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: HOUSEHOLD_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in the household's time zone. */
export function today(now: Date = new Date()): string {
  return formatter.format(now);
}

/** The current month in the household's time zone. */
export function currentMonth(now: Date = new Date()): string {
  return today(now).slice(0, 7);
}

export function lastDayOfMonth(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
}

/** A calendar date moved by whole days. */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** The date of `day` in `month`, clamped to the month's last day (31 → 30 in April). */
export function dayOfMonth(month: string, day: number): string {
  const last = Number(lastDayOfMonth(month).slice(8, 10));
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
