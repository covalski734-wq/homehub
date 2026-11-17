import type { positionCreateSchema, positionUpdateSchema } from '@homehub/shared';
import type { z } from 'zod';
import { today } from '../lib/dates';
import { conflict, HttpError, unavailable, unprocessable } from '../lib/http-error';
import { toMinor } from '../lib/money';
import { requireScope, type ServiceContext } from '../lib/service-context';
import { convert } from '../planner/calculations';
import type { RatesService } from '../planner/rates.service';
import {
  quantityFor,
  quantityToUnits,
  unitsToQuantity,
  type AssetPrice,
  type AssetPricesService,
} from './asset-prices';
import type { SavingsRepository } from './savings.repository';

type Out<T extends z.ZodType> = z.output<T>;

/** A unit price in micro-units: "80196.6", "0.00613"; at least 2 decimals. */
export function formatMicros(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

export function microsOf(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0').slice(0, 6));
}

/** A second purchase moves the average price by the quantities, when both prices are known. */
export function mergedAverage(
  existing: { quantity: string; avg_price_micros: number | null } | null,
  added: string,
  addedPrice: string | null,
): bigint | null {
  if (!existing) return addedPrice === null ? null : microsOf(addedPrice);
  if (existing.avg_price_micros === null || addedPrice === null)
    return existing.avg_price_micros === null ? null : BigInt(existing.avg_price_micros);
  const a = quantityToUnits(existing.quantity);
  const b = quantityToUnits(added);
  if (a + b === 0n) return null;
  return (a * BigInt(existing.avg_price_micros) + b * microsOf(addedPrice)) / (a + b);
}

const ATTEMPTS = 3;

/** Portfolios: coin and token positions valued at the daily CoinGecko price. */
export class PortfolioService {
  constructor(
    private readonly d1: D1Database,
    private readonly repo: SavingsRepository,
    private readonly prices: AssetPricesService,
    private readonly rates: RatesService,
  ) {}

  /**
   * Adds an asset to a portfolio; an asset already there gets the quantity added. The merge is
   * written only if the position is still the one it was computed from (two purchases added at
   * once both count), retried a few times.
   */
  async add(ctx: ServiceContext, potId: string, input: Out<typeof positionCreateSchema>) {
    requireScope(ctx, 'savings:write');
    const { workspaceId } = ctx;
    const pot = await this.repo.pot(workspaceId, potId);
    if (pot.archived_at) throw unprocessable('SAVINGS_POT_ARCHIVED');
    if (pot.kind !== 'PORTFOLIO') throw unprocessable('SAVINGS_NOT_A_PORTFOLIO');
    let quantity = input.quantity;
    if (quantity === null) {
      let price: AssetPrice;
      try {
        price = await this.prices.priceOf(input.asset.id);
      } catch {
        throw unavailable('SAVINGS_PRICE_UNAVAILABLE');
      }
      const rates = await this.rates.tableForDate(today());
      const unit = convert(price.pricePlnMicros, 'PLN', pot.currency, rates.table);
      if (unit === null) throw unprocessable('SAVINGS_RATE_MISSING', { currency: pot.currency });
      quantity = quantityFor(toMinor(input.value ?? '0'), unit);
    }
    if (quantityToUnits(quantity) === 0n) throw unprocessable('SAVINGS_QUANTITY_POSITIVE');
    const { asset } = input;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const existing = await this.repo.positionOf(workspaceId, potId, asset.id);
      const avg = mergedAverage(existing, quantity, input.avgPrice);
      const now = Date.now();
      const result = existing
        ? await this.d1
            .prepare(
              `UPDATE savings_positions SET symbol = ?1, name = ?2, image = COALESCE(?3, image),
                 quantity = ?4, avg_price_micros = ?5, updated_at = ?6
               WHERE id = ?7 AND workspace_id = ?8 AND quantity = ?9 AND updated_at = ?10`,
            )
            .bind(
              asset.symbol.toUpperCase(),
              asset.name,
              asset.image,
              unitsToQuantity(quantityToUnits(existing.quantity) + quantityToUnits(quantity)),
              avg === null ? null : Number(avg),
              Math.max(now, existing.updated_at + 1),
              existing.id,
              workspaceId,
              existing.quantity,
              existing.updated_at,
            )
            .run()
        : await this.d1
            .prepare(
              `INSERT INTO savings_positions (id, workspace_id, pot_id, asset, symbol, name, image,
                 quantity, avg_price_micros, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
               ON CONFLICT (pot_id, asset) DO NOTHING`,
            )
            .bind(
              crypto.randomUUID(),
              workspaceId,
              potId,
              asset.id,
              asset.symbol.toUpperCase(),
              asset.name,
              asset.image,
              quantity,
              avg === null ? null : Number(avg),
              now,
            )
            .run();
      if (result.meta.changes) {
        await this.prices.ensureFresh([asset.id]);
        return;
      }
    }
    throw conflict('VERSION_CONFLICT');
  }

  async update(ctx: ServiceContext, id: string, input: Out<typeof positionUpdateSchema>) {
    requireScope(ctx, 'savings:write');
    await this.repo.position(ctx.workspaceId, id);
    await this.d1
      .prepare(
        `UPDATE savings_positions SET
           quantity = CASE WHEN ?1 THEN ?2 ELSE quantity END,
           avg_price_micros = CASE WHEN ?3 THEN ?4 ELSE avg_price_micros END,
           updated_at = ?5
         WHERE id = ?6 AND workspace_id = ?7`,
      )
      .bind(
        input.quantity === undefined ? 0 : 1,
        input.quantity === undefined ? null : unitsToQuantity(quantityToUnits(input.quantity)),
        input.avgPrice === undefined ? 0 : 1,
        input.avgPrice === undefined || input.avgPrice === null
          ? null
          : Number(microsOf(input.avgPrice)),
        Date.now(),
        id,
        ctx.workspaceId,
      )
      .run();
  }

  async remove(ctx: ServiceContext, id: string) {
    requireScope(ctx, 'savings:write');
    const result = await this.d1
      .prepare('DELETE FROM savings_positions WHERE id = ? AND workspace_id = ?')
      .bind(id, ctx.workspaceId)
      .run();
    if (!result.meta.changes) throw new HttpError(404, 'SAVINGS_POSITION_NOT_FOUND');
  }

  async search(query: string) {
    try {
      return await this.prices.search(query);
    } catch {
      throw unavailable('SAVINGS_SEARCH_UNAVAILABLE');
    }
  }

  /** The «обновить курс» button: at most once per few minutes, never while CoinGecko asks to wait. */
  async refreshPrices(ctx: ServiceContext) {
    requireScope(ctx, 'savings:write');
    const result = await this.prices.refresh({ manual: true });
    if (result.tooSoon) throw unavailable('SAVINGS_PRICES_TOO_SOON');
    if (result.error) throw unavailable('SAVINGS_PRICES_NOT_REFRESHED', { reason: result.error });
  }
}
