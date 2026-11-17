import type { MovementDto, PotDto } from '@homehub/shared';
import { useState, type ReactNode } from 'react';
import { ErrorState } from '@/components/states/states';
import { DialogBody } from '@/components/ui/dialog';
import { FormDialog } from '@/components/ui/form-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney, formatMonth, formatTimestamp } from '@/lib/format';
import { useMovementHistory, usePartHistory } from './api';
import { historyByMonth } from './model';
import { t } from '@/i18n';

/** The whole history of a fund, every month, grouped by month. */
export function HistoryDialog({
  pot,
  onClose,
  partId,
  renderRow,
}: {
  pot: PotDto | null;
  onClose: () => void;
  partId?: string;
  renderRow: (m: MovementDto) => ReactNode;
}) {
  return (
    <FormDialog
      open={pot !== null}
      onOpenChange={(open) => !open && onClose()}
      title={pot ? t('savings.history.title', { name: pot.name }) : ''}
      description={t('savings.history.description')}
      isDirty={false}
    >
      {pot && <HistoryList pot={pot} partId={partId} renderRow={renderRow} />}
    </FormDialog>
  );
}

function HistoryList({
  pot,
  partId,
  renderRow,
}: {
  pot: PotDto;
  partId?: string;
  renderRow: (m: MovementDto) => ReactNode;
}) {
  const history = useMovementHistory(pot.id);
  const events = usePartHistory(pot.id);
  const [selectedPart, setSelectedPart] = useState(partId ?? '');
  if (history.isPending) return <Skeleton className="m-4 h-32" />;
  if (history.isError)
    return <ErrorState error={history.error} onRetry={() => void history.refetch()} />;
  const months = historyByMonth(
    history.data.filter((m) => !selectedPart || m.subaccountId === selectedPart),
  );
  return (
    <DialogBody className="grid gap-4">
      <select
        aria-label={t('savings.parts.history')}
        className="rounded-md border bg-background p-2 text-sm"
        value={selectedPart}
        onChange={(e) => setSelectedPart(e.target.value)}
      >
        <option value="">{t('common.all')}</option>
        {pot.subaccounts.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.archived ? ' · ' + t('savings.parts.removed') : ''}
          </option>
        ))}
      </select>
      {events.isError && <ErrorState error={events.error} onRetry={() => void events.refetch()} />}
      {events.isPending && <Skeleton className="h-12" />}
      <ul className="space-y-2">
        {events.data
          ?.filter((e) => !selectedPart || e.subaccountId === selectedPart)
          .map((e) => (
            <li key={e.id} className="text-sm">
              {t(
                e.type === 'REMOVED'
                  ? 'savings.parts.eventRemoved'
                  : e.type === 'RESTORED'
                    ? 'savings.parts.eventRestored'
                    : 'savings.parts.eventAdded',
                { name: e.partName },
              )}
              <span className="block text-xs text-muted-foreground">
                {formatTimestamp(e.createdAt)}
              </span>
            </li>
          ))}
      </ul>
      {months.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('savings.history.empty')}</p>
      )}
      {months.map(({ month, items, net }) => (
        <section key={month}>
          <h3 className="flex justify-between text-xs font-medium text-muted-foreground">
            <span>{formatMonth(month)}</span>
            <span className="tabular">{formatMoney(net, pot.currency, { signed: true })}</span>
          </h3>
          <ul className="divide-y rounded-lg border">{items.map(renderRow)}</ul>
        </section>
      ))}
    </DialogBody>
  );
}
