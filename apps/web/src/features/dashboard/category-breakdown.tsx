import type { CategorySpendingDto } from '@homehub/shared';
import { PieChart } from 'lucide-react';
import { EmptyState } from '@/components/states/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney, formatPercent } from '@/lib/format';
import { categoryName } from '@/lib/system-texts';
import { t } from '@/i18n';

const VISIBLE = 6;

/** Ranked horizontal bars: magnitudes compare far better than slices of a donut. */
export function CategoryBreakdown({
  currency,
  items,
}: {
  currency: string;
  items: CategorySpendingDto[];
}) {
  const rows = items.filter((item) => item.currency === currency);
  const visible = rows.slice(0, VISIBLE);
  const rest = rows.slice(VISIBLE);
  const restShare = rest.reduce((sum, item) => sum + item.share, 0);
  const maxShare = visible[0]?.share ?? 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dashboard.categories.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            icon={<PieChart />}
            title={t('dashboard.categories.empty')}
            className="py-8"
          />
        ) : (
          <ul className="space-y-3">
            {visible.map((item) => (
              <li key={item.categoryId}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">
                    {categoryName({ name: item.name, systemKey: item.systemKey })}
                  </span>
                  <span className="shrink-0 tabular">
                    {formatMoney(item.amount, currency)}
                    <span className="ml-2 inline-block w-9 text-right text-xs text-muted-foreground">
                      {formatPercent(item.share)}
                    </span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted" aria-hidden>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(item.share / maxShare) * 100}%`,
                      backgroundColor: item.color,
                    }}
                  />
                </div>
              </li>
            ))}
            {rest.length > 0 && (
              <li className="flex justify-between text-sm text-muted-foreground">
                <span>{t('dashboard.categories.others', { number: rest.length })}</span>
                <span className="tabular">{formatPercent(restShare)}</span>
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
