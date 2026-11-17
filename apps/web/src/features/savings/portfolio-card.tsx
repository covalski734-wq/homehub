import type { PositionDto, PotDto } from '@homehub/shared';
import { Eye, EyeOff, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatFullDate, formatMoney, formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSavingsMutations } from './api';
import { AssetIcon } from './asset-icon';
import { useStoredFlag } from './hooks';
import { changeView, isLowBalance, isNegative } from './model';
import { PotMenu } from './pot-menu';
import { OwnerBadge } from '../household/owner';
import { t } from '@/i18n';

const HIDE_LOW_KEY = 'homehub.savings.hideLow';

/** A 24-hour change; below a cent it shows as «<0,01». */
function Change({ value, currency }: { value: string | null; currency: string }) {
  if (value === null) return null;
  const { sign, tiny } = changeView(value);
  return (
    <span
      className={cn(
        'text-xs tabular',
        sign > 0 ? 'text-income' : sign < 0 ? 'text-expense' : 'text-muted-foreground',
      )}
    >
      {tiny
        ? `${sign < 0 ? '<' : '+<'}${formatMoney('0.01', currency)}`
        : formatMoney(value, currency, { signed: true })}
    </span>
  );
}

/** A portfolio of coins and tokens: positions with value, profit and the day's change. */
export function PortfolioCard({
  pot,
  month,
  base,
  onAdd,
  onEditPosition,
  onEdit,
  onDelete,
}: {
  pot: PotDto;
  month: string;
  base: string;
  onAdd: () => void;
  onEditPosition: (position: PositionDto) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { deletePosition } = useSavingsMutations(month);
  const [hideLow, toggleHide] = useStoredFlag(HIDE_LOW_KEY, false);
  const low = (p: PositionDto) => isLowBalance(p.value);
  const shown = hideLow ? pot.positions.filter((p) => !low(p)) : pot.positions;
  const hidden = pot.positions.length - shown.length;

  return (
    <Card
      className={cn('overflow-hidden', pot.archived && 'opacity-70')}
      role="region"
      aria-label={pot.name}
    >
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-1">
        <h2 className="truncate font-semibold text-sky-600 dark:text-sky-400">{pot.name}</h2>
        <span className="rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700 uppercase tabular dark:text-sky-300">
          {t('savings.portfolio.total', { amount: formatMoney(pot.balance, pot.currency) })}
        </span>
        {pot.archived && <Badge>{t('common.archive')}</Badge>}
        <span className="ml-auto flex items-center">
          {!pot.archived && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onAdd}
              aria-label={t('savings.portfolio.addAssetTo', { name: pot.name })}
            >
              <Plus />
            </Button>
          )}
          <PotMenu pot={pot} month={month} onEdit={onEdit} onDelete={onDelete} />
        </span>
      </div>
      <p className="flex flex-wrap gap-x-2 px-4 text-xs text-muted-foreground tabular">
        <OwnerBadge ownerId={pot.ownerId} hideJoint />
        {pot.profit !== null && (
          <span className={isNegative(pot.profit) ? 'text-expense' : 'text-income'}>
            {t('savings.portfolio.profit', {
              amount: formatMoney(pot.profit, pot.currency, { signed: true }),
            })}
          </span>
        )}
        {pot.change24h !== null && (
          <>
            {t('savings.portfolio.change24h')}{' '}
            <Change value={pot.change24h} currency={pot.currency} />
          </>
        )}
        {pot.value !== null && pot.currency !== base && (
          <span>
            {pot.change24h !== null && ' · '}≈ {formatMoney(pot.value, base)}
          </span>
        )}
      </p>

      {pot.positions.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">{t('savings.portfolio.empty')}</p>
          {!pot.archived && (
            <Button className="mt-3" variant="outline" onClick={onAdd}>
              <Plus /> {t('savings.position.addTitle')}
            </Button>
          )}
        </div>
      ) : (
        <ul className="pt-1" aria-label={t('savings.portfolio.positions', { name: pot.name })}>
          {shown.map((p) => (
            <li key={p.id} className="group flex items-center gap-3 px-4 py-2">
              <button
                type="button"
                onClick={() => onEditPosition(p)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <AssetIcon asset={p.asset} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.asset.name}</span>
                  <span className="block truncate text-xs text-muted-foreground tabular">
                    {p.asset.symbol}
                    {p.price !== null && ` · ${formatPrice(p.price, pot.currency)}`}
                    {p.stale && p.priceDate && (
                      <span className="text-destructive">
                        {' '}
                        · {t('savings.portfolio.rateFrom', { date: formatFullDate(p.priceDate) })}
                      </span>
                    )}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-medium tabular">
                    {p.value === null
                      ? t('savings.portfolio.noRate')
                      : formatMoney(p.value, pot.currency)}
                  </span>
                  {p.profit !== null ? (
                    <span
                      className={cn(
                        'block text-xs tabular',
                        isNegative(p.profit) ? 'text-expense' : 'text-income',
                      )}
                      title={t('savings.portfolio.profitTitle', {
                        price: formatPrice(p.avgPrice ?? '0', pot.currency),
                      })}
                    >
                      {t('savings.portfolio.profitShort')}{' '}
                      {formatMoney(p.profit, pot.currency, { signed: true })}
                    </span>
                  ) : (
                    <Change value={p.change24h} currency={pot.currency} />
                  )}
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('common.actionsFor', { name: p.asset.name })}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onEditPosition(p)}>
                    <Pencil /> {t('savings.portfolio.editQuantity')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() => deletePosition.mutate(p.id)}
                  >
                    <Trash2 /> {t('savings.portfolio.deletePosition')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
          {pot.positions.some(low) && (
            <li>
              <button
                type="button"
                onClick={toggleHide}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                  aria-hidden
                >
                  {hideLow ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </span>
                {hideLow
                  ? t('savings.portfolio.showLow', { count: hidden })
                  : t('savings.portfolio.hideLow')}
              </button>
            </li>
          )}
        </ul>
      )}
      <div className="h-2" />
    </Card>
  );
}
