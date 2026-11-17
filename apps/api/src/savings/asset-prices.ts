import type { AssetDto, PricesStatusDto } from '@homehub/shared';
import { z } from 'zod';
import { divRound, PLN_MICROS } from '../planner/calculations';
import type { Fetcher } from '../planner/nbp';

/**
 * Asset prices from CoinGecko: coins, gold tokens, tokenized stocks — any id a position uses.
 * Quoted directly in PLN, so the NBP rates convert them further exactly like any other PLN
 * amount. Fetched once a day by the daily cron and on demand when a position has no price yet.
 *
 * Without a key CoinGecko limits requests per IP, and Workers share egress IPs with many other
 * sites, so 429 is common: set the free Demo key (`COINGECKO_API_KEY`). Every call — price
 * refresh, search, one price — goes through one gate: after a 429 or an outage nothing is sent
 * until `Retry-After` (or an exponential backoff 2 min → 6 h) has passed; stored prices stay in use.
 */
export const COINGECKO_API = 'https://api.coingecko.com/api/v3';

const STATE = {
  lastSuccess: 'crypto.last_success_at',
  lastAttempt: 'crypto.last_attempt_at',
  lastError: 'crypto.last_error',
  failures: 'crypto.failures',
  retryAt: 'crypto.retry_at',
} as const;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const BACKOFF_MIN_MS = 2 * MINUTE_MS;
const BACKOFF_MAX_MS = 6 * 60 * MINUTE_MS;
/** Parallel page loads do not start a second refresh while one is running. */
const IN_FLIGHT_MS = MINUTE_MS;
/** The «обновить курс» button: prices change little faster than this. */
export const MANUAL_REFRESH_MS = 5 * MINUTE_MS;
/** A hung request counts as a network error: it records the backoff like an outage. */
export const COINGECKO_TIMEOUT_MS = 15_000;
const UNAVAILABLE = 'CoinGecko unavailable';
/** Ids per request: CoinGecko's URL length limit is far above this. */
const CHUNK = 100;

/** CoinGecko refused or failed; nothing is retried before `retryAt`. */
export class PricesUnavailableError extends Error {
  constructor(
    message: string,
    readonly retryAt: string | null,
  ) {
    super(message);
  }
}

/** Delay before the next call: `Retry-After` when given (capped), otherwise 2 min × 2^(n−1). */
export function backoffMs(failures: number, retryAfter: string | null): number {
  // Retry-After is either seconds or an HTTP date.
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : retryAfter === null
      ? Number.NaN
      : Date.parse(retryAfter) - Date.now();
  if (Number.isFinite(delay) && delay >= 0)
    return Math.min(Math.max(delay, MINUTE_MS), BACKOFF_MAX_MS);
  return Math.min(BACKOFF_MIN_MS * 2 ** Math.max(failures - 1, 0), BACKOFF_MAX_MS);
}

const priceSchema = z.record(
  z.string(),
  z.object({ pln: z.number().positive(), pln_24h_change: z.number().nullish() }).partial(),
);
const searchSchema = z.object({
  coins: z.array(
    z.object({
      id: z.string(),
      symbol: z.string(),
      name: z.string(),
      thumb: z.string().nullish(),
      large: z.string().nullish(),
      market_cap_rank: z.number().nullish(),
    }),
  ),
});

export interface AssetPrice {
  asset: string;
  priceDate: string;
  pricePlnMicros: bigint;
  change24hBp: number | null;
}

export function parsePrices(payload: unknown): Omit<AssetPrice, 'priceDate'>[] {
  return Object.entries(priceSchema.parse(payload)).flatMap(([asset, quote]) => {
    if (quote.pln === undefined) return [];
    const micros = BigInt(Math.round(quote.pln * 1_000_000));
    const change = quote.pln_24h_change;
    return micros > 0n
      ? [
          {
            asset,
            pricePlnMicros: micros,
            change24hBp: typeof change === 'number' ? Math.round(change * 100) : null,
          },
        ]
      : [];
  });
}

// ---- exact quantities (TEXT decimals, 8 places) -----------------------------------------------

const UNITS = 100_000_000n;

export function quantityToUnits(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid quantity: ${value}`);
  return BigInt(match[1]!) * UNITS + BigInt((match[2] ?? '').padEnd(8, '0'));
}

/** Shortest form: "0.0532", "2", never trailing zeros. */
export function unitsToQuantity(units: bigint): string {
  const whole = units / UNITS;
  const fraction = (units % UNITS).toString().padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

/** Value in minor units of the price currency: quantity × price (micros), rounded once. */
export function valueMinor(quantity: string, priceMicros: bigint): bigint {
  return divRound(quantityToUnits(quantity) * priceMicros * 100n, UNITS * PLN_MICROS);
}

/** Quantity bought for `minor` at `priceMicros`, rounded to 8 places. */
export function quantityFor(minor: bigint, priceMicros: bigint): string {
  return unitsToQuantity(divRound(minor * PLN_MICROS * UNITS, priceMicros * 100n));
}

/** How much of `value` the last 24 hours added: value − value / (1 + change). */
export function change24h(value: bigint, changeBp: number | null): bigint | null {
  if (changeBp === null || changeBp <= -10_000) return null;
  return value - divRound(value * 10_000n, 10_000n + BigInt(changeBp));
}

type State = Map<string, string | null>;

export class AssetPricesService {
  constructor(
    private readonly db: D1Database,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
    /** CoinGecko Demo key; without it the public, IP-limited access is used. */
    private readonly apiKey?: string,
  ) {}

  /** The latest stored price of every asset. */
  async latest(): Promise<Map<string, AssetPrice>> {
    const rows = await this.db
      .prepare(
        `SELECT asset, price_date, price_pln_micros, change_24h_bp FROM asset_prices p
         WHERE price_date = (SELECT MAX(price_date) FROM asset_prices WHERE asset = p.asset)`,
      )
      .all<{
        asset: string;
        price_date: string;
        price_pln_micros: number;
        change_24h_bp: number | null;
      }>();
    return new Map(
      rows.results.map((r) => [
        r.asset,
        {
          asset: r.asset,
          priceDate: r.price_date,
          pricePlnMicros: BigInt(r.price_pln_micros),
          change24hBp: r.change_24h_bp,
        },
      ]),
    );
  }

  async status(): Promise<PricesStatusDto> {
    const state = await this.state();
    const lastSuccess = state.get(STATE.lastSuccess) ?? null;
    const retryAt = this.waiting(state) ? (state.get(STATE.retryAt) ?? null) : null;
    const lastAttempt = Date.parse(state.get(STATE.lastAttempt) ?? '') || 0;
    const manualAt = lastAttempt + MANUAL_REFRESH_MS;
    const availableAt = Math.max(manualAt, Date.parse(retryAt ?? '') || 0);
    return {
      lastSuccessAt: lastSuccess,
      lastError: state.get(STATE.lastError) ?? null,
      stale: !lastSuccess || Date.now() - Date.parse(lastSuccess) > 2 * DAY_MS,
      retryAt,
      refreshAvailableAt: availableAt > Date.now() ? new Date(availableAt).toISOString() : null,
    };
  }

  /**
   * Refreshes when an asset in use has no price or the last success is older than a day — unless
   * CoinGecko asked to wait or a refresh has just started. Stored prices stay in use meanwhile.
   */
  async ensureFresh(assets: readonly string[]): Promise<void> {
    if (assets.length === 0) return;
    const [latest, state] = await Promise.all([this.latest(), this.state()]);
    const lastSuccess = Date.parse(state.get(STATE.lastSuccess) ?? '') || 0;
    const lastAttempt = Date.parse(state.get(STATE.lastAttempt) ?? '') || 0;
    const missing = assets.some((asset) => !latest.has(asset));
    const old = Date.now() - lastSuccess > DAY_MS;
    if ((missing || old) && !this.waiting(state) && Date.now() - lastAttempt > IN_FLIGHT_MS)
      await this.refresh();
  }

  /**
   * Today's price of every asset any workspace holds (idempotent per day). `manual` refreshes are
   * limited to one per MANUAL_REFRESH_MS; nothing is sent while CoinGecko asked to wait.
   */
  async refresh(
    options: { manual?: boolean } = {},
  ): Promise<{ stored: number; error: string | null; tooSoon?: boolean }> {
    const state = await this.state();
    const lastAttempt = Date.parse(state.get(STATE.lastAttempt) ?? '') || 0;
    // `error` is a technical detail for logs and the status line, not a sentence for people.
    if (this.waiting(state)) return { stored: 0, error: state.get(STATE.lastError) ?? UNAVAILABLE };
    if (options.manual && Date.now() - lastAttempt < MANUAL_REFRESH_MS)
      return { stored: 0, error: 'refreshed moments ago', tooSoon: true };
    const rows = await this.db
      .prepare('SELECT DISTINCT asset FROM savings_positions ORDER BY asset')
      .all<{ asset: string }>();
    // Claimed before the request: a parallel page load sees a fresh attempt and does not repeat it.
    await this.upsert([[STATE.lastAttempt, new Date().toISOString()]]);
    try {
      const stored = await this.fetchAndStore(rows.results.map((r) => r.asset));
      await this.upsert([
        [STATE.lastSuccess, new Date().toISOString()],
        [STATE.lastError, null],
      ]);
      return { stored, error: null };
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      await this.upsert([[STATE.lastError, error]]);
      return { stored: 0, error };
    }
  }

  /** The latest price of one asset, fetched now if it has none yet (throws when unavailable). */
  async priceOf(asset: string): Promise<AssetPrice> {
    const known = (await this.latest()).get(asset);
    if (known) return known;
    await this.fetchAndStore([asset]);
    const fetched = (await this.latest()).get(asset);
    if (!fetched) throw new PricesUnavailableError(`CoinGecko has no price for ${asset}`, null);
    return fetched;
  }

  private async fetchAndStore(assets: readonly string[]): Promise<number> {
    const now = Date.now();
    const date = new Date(now).toISOString().slice(0, 10);
    let stored = 0;
    for (let i = 0; i < assets.length; i += CHUNK) {
      const ids = assets.slice(i, i + CHUNK).join(',');
      const payload = await this.call(
        `/simple/price?ids=${ids}&vs_currencies=pln&include_24hr_change=true&precision=full`,
      );
      const statements = parsePrices(payload).map((p) =>
        this.db
          .prepare(
            `INSERT INTO asset_prices (asset, price_date, price_pln_micros, change_24h_bp, fetched_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (asset, price_date)
             DO UPDATE SET price_pln_micros = ?3, change_24h_bp = ?4, fetched_at = ?5`,
          )
          .bind(p.asset, date, Number(p.pricePlnMicros), p.change24hBp, now),
      );
      if (statements.length) await this.db.batch(statements);
      stored += statements.length;
    }
    return stored;
  }

  /** Coins and tokens matching a name or ticker, best known first. */
  async search(query: string): Promise<AssetDto[]> {
    const payload = await this.call(`/search?query=${encodeURIComponent(query)}`);
    return searchSchema
      .parse(payload)
      .coins.slice(0, 12)
      .map((c) => {
        // Icons are shown at 40 px: the 25 px thumb would be blurry.
        const image = c.large ?? c.thumb;
        return {
          id: c.id,
          symbol: c.symbol.toUpperCase(),
          name: c.name,
          image: image?.startsWith('https://') ? image : null,
        };
      });
  }

  /**
   * The single gate to CoinGecko. A 429 or 5xx (or a network error) records the backoff shared by
   * all callers; any success clears it.
   */
  private async call(path: string): Promise<unknown> {
    const state = await this.state();
    if (this.waiting(state))
      throw new PricesUnavailableError(
        state.get(STATE.lastError) ?? UNAVAILABLE,
        state.get(STATE.retryAt) ?? null,
      );
    let response: Response;
    try {
      response = await this.fetcher(`${COINGECKO_API}${path}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'HomeHub budget planner',
          ...(this.apiKey ? { 'x-cg-demo-api-key': this.apiKey } : {}),
        },
        signal: AbortSignal.timeout(COINGECKO_TIMEOUT_MS),
      });
    } catch (cause) {
      throw await this.fail(state, `${UNAVAILABLE}: ${String(cause)}`, null);
    }
    if (response.status === 429 || response.status >= 500)
      throw await this.fail(
        state,
        `CoinGecko responded ${response.status}`,
        response.headers.get('Retry-After'),
      );
    if (!response.ok)
      throw new PricesUnavailableError(`CoinGecko responded ${response.status}`, null);
    const payload: unknown = await response.json();
    if (state.get(STATE.failures) || state.get(STATE.retryAt))
      await this.upsert([
        [STATE.failures, null],
        [STATE.retryAt, null],
      ]);
    return payload;
  }

  private async fail(state: State, message: string, retryAfter: string | null) {
    const failures = (Number(state.get(STATE.failures)) || 0) + 1;
    const retryAt = new Date(Date.now() + backoffMs(failures, retryAfter)).toISOString();
    await this.upsert([
      [STATE.failures, String(failures)],
      [STATE.retryAt, retryAt],
      [STATE.lastError, message],
    ]);
    return new PricesUnavailableError(message, retryAt);
  }

  private waiting(state: State): boolean {
    const retryAt = Date.parse(state.get(STATE.retryAt) ?? '');
    return Number.isFinite(retryAt) && retryAt > Date.now();
  }

  private async state(): Promise<State> {
    const rows = await this.db
      .prepare(`SELECT key, value FROM planner_state WHERE key LIKE 'crypto.%'`)
      .all<{ key: string; value: string | null }>();
    return new Map(rows.results.map((r) => [r.key, r.value]));
  }

  private async upsert(entries: [string, string | null][]): Promise<void> {
    const now = Date.now();
    await this.db.batch(
      entries.map(([key, value]) =>
        this.db
          .prepare(
            `INSERT INTO planner_state (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT (key) DO UPDATE SET value = ?2, updated_at = ?3`,
          )
          .bind(key, value, now),
      ),
    );
  }
}
