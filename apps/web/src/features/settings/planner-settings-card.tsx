import {
  BASE_CURRENCIES,
  type BaseCurrency,
  type JointSplit,
  type SavingsMode,
} from '@homehub/shared';
import { Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { normalizeAmount, validatePercent } from '@/components/editable-table/validators';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { formatDateTime, formatFullDate } from '@/lib/format';
import {
  usePlannerSettings,
  useRates,
  useRefreshRates,
  useUpdatePlannerSettings,
} from '../planner/api';
import { t } from '@/i18n';

/** Money left on everyday accounts before «свободный остаток» goes to funds. */
function MinFree({ value }: { value: string }) {
  const update = useUpdatePlannerSettings();
  const [text, setText] = useState(String(Number(value)));
  const commit = () => {
    const normalized = normalizeAmount(text);
    if (normalized === String(Number(value)) || !/^\d{1,12}(\.\d{1,2})?$/.test(normalized)) return;
    update.mutate(
      { minFree: normalized },
      {
        onSuccess: () => toast.success(t('settings.planner.minFreeSaved')),
      },
    );
  };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="min-free">{t('settings.planner.minFree')}</Label>
      <Input
        id="min-free"
        inputMode="decimal"
        className="w-32 text-right tabular"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <p className="text-xs text-muted-foreground">{t('settings.planner.minFreeHint')}</p>
    </div>
  );
}

function DefaultRate({ value }: { value: string }) {
  const update = useUpdatePlannerSettings();
  const [text, setText] = useState(String(Number(value)));
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    const normalized = normalizeAmount(text);
    if (normalized === String(Number(value))) return;
    const problem = validatePercent(normalized);
    setError(problem);
    if (!problem) {
      update.mutate(
        { defaultSavingsRate: normalized },
        {
          onSuccess: () => toast.success(t('settings.planner.defaultSavingsSaved')),
        },
      );
    }
  };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="default-savings">{t('settings.planner.defaultSavings')}</Label>
      <div className="flex items-center gap-2">
        <Input
          id="default-savings"
          inputMode="decimal"
          className="w-24 text-right"
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby="default-savings-hint"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        <span className="text-sm text-muted-foreground">%</span>
        {update.isPending && (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-label={t('common.saving')}
          />
        )}
      </div>
      <p
        id="default-savings-hint"
        className={error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
      >
        {error ?? t('settings.planner.defaultSavingsHint')}
      </p>
    </div>
  );
}

export function PlannerSettingsCard() {
  const settings = usePlannerSettings();
  const update = useUpdatePlannerSettings();
  const rates = useRates();
  const refresh = useRefreshRates();

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('settings.planner.title')}</CardTitle>
          <CardDescription>{t('settings.planner.description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {settings.data && (
          <>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium" id="base-currency-label">
                {t('settings.planner.baseCurrency')}
              </span>
              <SegmentedControl
                label={t('settings.planner.baseCurrency')}
                value={settings.data.baseCurrency}
                onChange={(baseCurrency: BaseCurrency) => update.mutate({ baseCurrency })}
                options={BASE_CURRENCIES.map((c) => ({ value: c, label: c }))}
                className="max-w-48"
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.planner.baseCurrencyHint')}
              </p>
            </div>
            {settings.data.savingsMode === 'RATE' && (
              <DefaultRate
                key={settings.data.defaultSavingsRate}
                value={settings.data.defaultSavingsRate}
              />
            )}
            <MinFree key={settings.data.minFree} value={settings.data.minFree} />
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">{t('settings.planner.savingsMode.label')}</span>
              <SegmentedControl
                label={t('settings.planner.savingsMode.label')}
                value={settings.data.savingsMode}
                onChange={(savingsMode: SavingsMode) => update.mutate({ savingsMode })}
                options={[
                  { value: 'REMAINDER', label: t('settings.planner.savingsMode.REMAINDER') },
                  { value: 'RATE', label: t('settings.planner.savingsMode.RATE') },
                ]}
                className="max-w-72"
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.planner.savingsMode.hint')}
              </p>
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">{t('settings.planner.jointSplit.label')}</span>
              <SegmentedControl
                label={t('settings.planner.jointSplit.label')}
                value={settings.data.jointSplit}
                onChange={(jointSplit: JointSplit) => update.mutate({ jointSplit })}
                options={[
                  { value: 'EQUAL', label: t('settings.planner.jointSplit.EQUAL') },
                  { value: 'INCOME', label: t('settings.planner.jointSplit.INCOME') },
                ]}
                className="max-w-64"
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.planner.jointSplit.hint')}
              </p>
            </div>
          </>
        )}
        <div className="grid gap-2 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{t('settings.rates.title')}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={refresh.isPending}
              onClick={() =>
                refresh.mutate(undefined, {
                  onSuccess: (status) =>
                    status.lastError
                      ? toast.error(
                          t('settings.rates.unavailable', {
                            error: status.lastError,
                          }),
                        )
                      : toast.success(t('settings.rates.updated')),
                })
              }
            >
              {refresh.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw />}{' '}
              {t('settings.rates.refresh')}
            </Button>
          </div>
          {rates.data && rates.data.rates.length > 0 ? (
            <dl className="grid grid-cols-3 gap-2 text-sm">
              {rates.data.rates.map((r) => (
                <div key={r.currency} className="rounded-lg border px-3 py-2">
                  <dt className="text-xs text-muted-foreground">1 {r.currency}</dt>
                  <dd className="font-medium tabular">{r.rate.replace('.', ',')} PLN</dd>
                  <dd className="text-[11px] text-muted-foreground">
                    {formatFullDate(r.effectiveDate)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{t('settings.rates.empty')}</p>
          )}
          {rates.data && (
            <p className="text-xs text-muted-foreground">
              {rates.data.lastSuccessAt
                ? t('settings.rates.lastUpdate', {
                    date: formatDateTime(rates.data.lastSuccessAt),
                  })
                : ''}
              {t('settings.rates.schedule')}
              {rates.data.lastError && (
                <span className="block text-destructive">
                  {t('settings.rates.lastError', { error: rates.data.lastError })}
                </span>
              )}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
