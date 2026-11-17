import { addDays } from '../lib/dates';
import { z } from 'zod';
import { rateToMicros } from './calculations';

/**
 * Narodowy Bank Polski public API, table A (average mid rates against PLN).
 * https://api.nbp.pl/ — no key needed; a date range may span at most 93 days.
 */
export const NBP_BASE_URL = 'https://api.nbp.pl/api/exchangerates/tables/A';
export const NBP_CURRENCIES = ['EUR', 'USD', 'CAD'] as const;
export const NBP_MAX_RANGE_DAYS = 93;
/** A hung request fails like an outage: stored rates stay in use (RatesService.refresh). */
export const NBP_TIMEOUT_MS = 15_000;

const tableSchema = z.array(
  z.object({
    table: z.literal('A'),
    no: z.string(),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rates: z.array(z.object({ code: z.string(), mid: z.number().positive() })),
  }),
);

export interface NbpRate {
  currency: (typeof NBP_CURRENCIES)[number];
  effectiveDate: string;
  rateMicros: bigint;
  tableNo: string;
}

/** Keeps only the currencies the planner supports; mid rates are converted exactly. */
export function parseNbpTables(payload: unknown): NbpRate[] {
  const tables = tableSchema.parse(payload);
  return tables.flatMap((table) =>
    table.rates
      .filter((rate): rate is { code: NbpRate['currency']; mid: number } =>
        (NBP_CURRENCIES as readonly string[]).includes(rate.code),
      )
      .map((rate) => ({
        currency: rate.code,
        effectiveDate: table.effectiveDate,
        // JSON numbers from NBP have at most 6 decimals; their shortest decimal form is exact.
        rateMicros: rateToMicros(String(rate.mid)),
        tableNo: table.no,
      })),
  );
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** Rates published between two dates (inclusive). An empty range (holidays) is not an error. */
export async function fetchNbpRange(
  fetcher: Fetcher,
  from: string,
  to: string,
): Promise<NbpRate[]> {
  const response = await fetcher(`${NBP_BASE_URL}/${from}/${to}/?format=json`, {
    headers: { Accept: 'application/json', 'User-Agent': 'HomeHub budget planner' },
    signal: AbortSignal.timeout(NBP_TIMEOUT_MS),
  });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`NBP responded ${response.status}`);
  return parseNbpTables(await response.json());
}

/** Splits [from, to] into ranges NBP accepts. */
export function rangeChunks(
  from: string,
  to: string,
  maxDays = NBP_MAX_RANGE_DAYS,
): [string, string][] {
  const chunks: [string, string][] = [];
  let start = from;
  while (start <= to) {
    const end = addDays(start, maxDays - 1);
    chunks.push([start, end < to ? end : to]);
    start = addDays(end, 1);
  }
  return chunks;
}
