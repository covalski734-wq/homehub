import { LOCALE } from '@/i18n';
const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = `${currency}|${compact}`;
  let formatter = moneyFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency,
        notation: compact ? 'compact' : 'standard',
        maximumFractionDigits: compact ? 1 : 2,
        minimumFractionDigits: compact ? 0 : 2,
      });
    } catch {
      formatter = new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    moneyFormatters.set(key, formatter);
  }
  return formatter;
}

/** Display-only formatting of a decimal string coming from the API. */
export function formatMoney(
  amount: string | number,
  currency: string,
  options: { compact?: boolean; signed?: boolean } = {},
): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  const formatted = moneyFormatter(currency, options.compact ?? false).format(Math.abs(value));
  if (value < 0) return `−${formatted}`;
  return options.signed && value > 0 ? `+${formatted}` : formatted;
}

/** Unit price of a coin or token: cents above 1, four significant digits below ("0,00613 $"). */
export function formatPrice(amount: string | number, currency: string): string {
  const value = Number(amount);
  if (Math.abs(value) >= 1) return formatMoney(value, currency);
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      maximumSignificantDigits: 4,
    }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

const coinFormatter = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 8 });

/** Coin quantity with its code: "0,0532 BTC" (codes like USDT are not ISO currencies). */
export function formatCoins(quantity: string | number, coin: string): string {
  return `${coinFormatter.format(Number(quantity))} ${coin}`;
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 0 }).format(
    value,
  );
}

const monthFormatter = new Intl.DateTimeFormat(LOCALE, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const dayFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const fullDateFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatMonth(month: string): string {
  // Intl adds " г." (ru) / " р." (uk) after the year.
  const label = monthFormatter.format(new Date(`${month}-01T00:00:00Z`)).replace(/ (г|р)\.$/u, '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatShortMonth(month: string): string {
  return new Intl.DateTimeFormat(LOCALE, { month: 'short', timeZone: 'UTC' })
    .format(new Date(`${month}-01T00:00:00Z`))
    .replace('.', '');
}

export function formatDay(date: string): string {
  return dayFormatter.format(new Date(`${date}T00:00:00Z`)).replace('.', '');
}

const sheetDayFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: '2-digit',
  timeZone: 'UTC',
});

/** A date the way the work sheets write it: "1.10". */
export function formatSheetDay(date: string): string {
  return sheetDayFormatter.format(new Date(`${date}T00:00:00Z`));
}

export function formatFullDate(date: string): string {
  return fullDateFormatter.format(new Date(`${date}T00:00:00Z`)).replace(/ (г|р)\.$/u, '');
}

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** A moment in local time: "28.10.2026, 14:30". */
export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

const timeFormatter = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });

export function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

const compactNumberFormatter = new Intl.NumberFormat(LOCALE, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Chart axis label without a currency: "12 тыс." (the currency is named in the legend). */
export function formatCompactNumber(value: number): string {
  return compactNumberFormatter.format(value);
}

const timestampFormatter = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** When something happened, in local time with the month as a word: "28 окт. 2026 г., 14:30". */
export function formatTimestamp(iso: string): string {
  return timestampFormatter.format(new Date(iso));
}

const amountFormatter = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Amount without a currency sign, always with cents: sheet cells named by their row ("1 234,50"). */
export function formatAmount(amount: string | number): string {
  return amountFormatter.format(Number(amount));
}

const numberFormatter = new Intl.NumberFormat(LOCALE);

/** A count in the current language's digit grouping: "12 345". */
export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

const percentValueFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'percent',
  maximumFractionDigits: 2,
});

/** A percent the API already multiplied by 100 ("2.35" → "2,35 %"), e.g. CTR. */
export function formatPercentValue(percent: string | number): string {
  return percentValueFormatter.format(Number(percent) / 100);
}

/** A ratio such as ROAS: "3,25×". */
export function formatRatio(value: string | number): string {
  return `${amountFormatter.format(Number(value))}×`;
}
