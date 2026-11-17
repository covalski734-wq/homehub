import type { ExchangeRateDto, PlannerCurrency, RatesStatusDto } from '@homehub/shared';
import { and, asc, desc, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { exchangeRates, plannerState } from '../db/planner-schema';
import { microsToRate, type RateTable } from './calculations';
import { addDays, lastDayOfMonth, today } from '../lib/dates';
import { fetchNbpRange, NBP_CURRENCIES, rangeChunks, type Fetcher } from './nbp';

export interface RateRow {
  currency: string;
  effectiveDate: string;
  rateMicros: number;
}

const STATE = {
  lastSuccess: 'nbp.last_success_at',
  lastAttempt: 'nbp.last_attempt_at',
  lastError: 'nbp.last_error',
} as const;

/** How far back rates are kept when nothing older is needed. */
const DEFAULT_HISTORY_DAYS = 120;
/** A single run fetches at most this many 93-day ranges (Workers Free: 50 subrequests). */
const MAX_CHUNKS_PER_RUN = 10;
const STALE_AFTER_DAYS = 5;

/**
 * Rate valid on `date` per currency: the latest published on or before it (rates are not
 * published on weekends and holidays). Without such a rate, the earliest later one is used, so
 * old months still convert after a first backfill. Rows must be sorted by date ascending.
 */
export function rateTableAt(
  rows: readonly RateRow[],
  date: string,
): { table: Map<string, bigint>; used: ExchangeRateDto[] } {
  const table = new Map<string, bigint>();
  const used: ExchangeRateDto[] = [];
  for (const currency of NBP_CURRENCIES) {
    const forCurrency = rows.filter((row) => row.currency === currency);
    const onOrBefore = forCurrency.filter((row) => row.effectiveDate <= date).at(-1);
    const chosen = onOrBefore ?? forCurrency[0];
    if (chosen) {
      table.set(currency, BigInt(chosen.rateMicros));
      used.push({
        currency: currency as PlannerCurrency,
        rate: microsToRate(chosen.rateMicros),
        effectiveDate: chosen.effectiveDate,
      });
    }
  }
  return { table, used };
}

/** Cut-off date for a month budget: its last day, or today for the current and future months. */
export function monthCutoff(month: string): string {
  const last = lastDayOfMonth(month);
  const now = today();
  return last < now ? last : now;
}

export class RatesService {
  constructor(
    private readonly db: Db,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
  ) {}

  /** Stored rates around [from, to]: the range plus the last rate before it and the first after. */
  async loadRange(from: string, to: string): Promise<RateRow[]> {
    const columns = {
      currency: exchangeRates.currency,
      effectiveDate: exchangeRates.effectiveDate,
      rateMicros: exchangeRates.rateMicros,
    };
    const [inRange, before, after] = await this.db.batch([
      this.db
        .select(columns)
        .from(exchangeRates)
        .where(
          and(sql`${exchangeRates.effectiveDate} >= ${from}`, lte(exchangeRates.effectiveDate, to)),
        ),
      this.db
        .select(columns)
        .from(exchangeRates)
        .where(
          sql`${exchangeRates.effectiveDate} = (SELECT MAX(r.effective_date) FROM exchange_rates r
              WHERE r.currency = ${exchangeRates.currency} AND r.effective_date < ${from})`,
        ),
      this.db
        .select(columns)
        .from(exchangeRates)
        .where(
          sql`${exchangeRates.effectiveDate} = (SELECT MIN(r.effective_date) FROM exchange_rates r
              WHERE r.currency = ${exchangeRates.currency} AND r.effective_date > ${to})`,
        ),
    ]);
    return [...before, ...inRange, ...after].sort((a, b) =>
      a.effectiveDate.localeCompare(b.effectiveDate),
    );
  }

  async tableForDate(date: string): Promise<{ table: RateTable; used: ExchangeRateDto[] }> {
    return rateTableAt(await this.loadRange(addDays(date, -10), date), date);
  }

  async status(): Promise<RatesStatusDto> {
    const [latestRows, stateRows] = await this.db.batch([
      this.db
        .select({
          currency: exchangeRates.currency,
          effectiveDate: exchangeRates.effectiveDate,
          rateMicros: exchangeRates.rateMicros,
        })
        .from(exchangeRates)
        .where(
          sql`${exchangeRates.effectiveDate} = (SELECT MAX(r.effective_date) FROM exchange_rates r
              WHERE r.currency = ${exchangeRates.currency})`,
        )
        .orderBy(asc(exchangeRates.currency)),
      this.db.select().from(plannerState),
    ]);
    const state = new Map(stateRows.map((row) => [row.key, row.value]));
    const newest =
      latestRows
        .map((row) => row.effectiveDate)
        .sort()
        .at(-1) ?? null;
    return {
      rates: latestRows.map((row) => ({
        currency: row.currency as PlannerCurrency,
        rate: microsToRate(row.rateMicros),
        effectiveDate: row.effectiveDate,
      })),
      lastSuccessAt: state.get(STATE.lastSuccess) ?? null,
      lastAttemptAt: state.get(STATE.lastAttempt) ?? null,
      lastError: state.get(STATE.lastError) ?? null,
      stale: !newest || newest < addDays(today(), -STALE_AFTER_DAYS),
    };
  }

  /**
   * Fetches missing rates from NBP and stores them (idempotent upsert). On failure the stored
   * rates stay in use (fallback) and the error is recorded for the UI. `needFrom` is the
   * earliest date any budget needs (e.g. the first planned month).
   */
  async refresh(needFrom?: string): Promise<{ stored: number; error: string | null }> {
    const end = today();
    const [newestRow] = await this.db
      .select({ date: exchangeRates.effectiveDate })
      .from(exchangeRates)
      .orderBy(desc(exchangeRates.effectiveDate))
      .limit(1);
    const [oldestRow] = await this.db
      .select({ date: exchangeRates.effectiveDate })
      .from(exchangeRates)
      .orderBy(asc(exchangeRates.effectiveDate))
      .limit(1);

    const wantedFrom =
      needFrom && needFrom < addDays(end, -DEFAULT_HISTORY_DAYS)
        ? needFrom
        : addDays(end, -DEFAULT_HISTORY_DAYS);
    const ranges: [string, string][] = [];
    if (!oldestRow || wantedFrom < oldestRow.date) {
      ranges.push(...rangeChunks(wantedFrom, oldestRow ? addDays(oldestRow.date, -1) : end));
    }
    if (newestRow && newestRow.date < end)
      ranges.push(...rangeChunks(addDays(newestRow.date, 1), end));

    let stored = 0;
    let error: string | null = null;
    try {
      for (const [from, to] of ranges.slice(-MAX_CHUNKS_PER_RUN)) {
        const rates = await fetchNbpRange(this.fetcher, from, to);
        stored += await this.store(rates);
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    await this.recordAttempt(error);
    return { stored, error };
  }

  private async store(rates: Awaited<ReturnType<typeof fetchNbpRange>>): Promise<number> {
    const now = new Date();
    const statements = rates.map((rate) =>
      this.db
        .insert(exchangeRates)
        .values({
          currency: rate.currency,
          effectiveDate: rate.effectiveDate,
          rateMicros: Number(rate.rateMicros),
          tableNo: rate.tableNo,
          fetchedAt: now,
        })
        .onConflictDoUpdate({
          target: [exchangeRates.currency, exchangeRates.effectiveDate],
          set: { rateMicros: Number(rate.rateMicros), tableNo: rate.tableNo, fetchedAt: now },
        }),
    );
    const [first, ...rest] = statements;
    if (first) await this.db.batch([first, ...rest]);
    return statements.length;
  }

  private async recordAttempt(error: string | null): Promise<void> {
    const now = new Date();
    const upsert = (key: string, value: string | null) =>
      this.db
        .insert(plannerState)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({ target: plannerState.key, set: { value, updatedAt: now } });
    await this.db.batch(
      error
        ? [upsert(STATE.lastAttempt, now.toISOString()), upsert(STATE.lastError, error)]
        : [
            upsert(STATE.lastAttempt, now.toISOString()),
            upsert(STATE.lastSuccess, now.toISOString()),
            upsert(STATE.lastError, null),
          ],
    );
  }
}
