import type { MonthBudgetDto, ShareDto } from '@homehub/shared';
import { Loader2, PieChart } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { DialogBody, DialogClose, DialogFooter } from '@/components/ui/dialog';
import { FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useMembers, useSaveShares } from './api';
import { isNegative } from '../savings/model';
import { FULL_SHARE, hundredthsToPercent, shareHundredths, sharesTotal } from './model';
import { t } from '@/i18n';

/**
 * Shares of a joint line (no owner) between members: a button showing the split, opening a
 * dialog with a percentage per member. Lines with an owner belong to that member entirely.
 */
export function SharesButton({
  item,
  month,
}: {
  item: { id: string; name: string; ownerId: string | null; shares: ShareDto[] | null };
  month: string;
}) {
  const members = useMembers();
  const [open, setOpen] = useState(false);
  if (item.ownerId)
    return (
      <span className="text-xs text-muted-foreground">{t('household.shares.ownerWhole')}</span>
    );
  const live = (members.data ?? []).filter((m) => !m.archived);
  const label = item.shares
    ? item.shares
        .map((s) => `${live.find((m) => m.id === s.memberId)?.name ?? '?'} ${Number(s.share)}%`)
        .join(' / ')
    : t('household.shares.byDefault');
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 max-w-full justify-start truncate px-2 text-xs"
        onClick={() => setOpen(true)}
        aria-label={t('household.shares.title', { name: item.name })}
      >
        <PieChart className="size-3.5" aria-hidden /> {label}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('household.shares.title', { name: item.name })}
        description={t('household.shares.description')}
        isDirty={false}
      >
        {open && <SharesForm item={item} month={month} onDone={() => setOpen(false)} />}
      </FormDialog>
    </>
  );
}

function SharesForm({
  item,
  month,
  onDone,
}: {
  item: { id: string; shares: ShareDto[] | null };
  month: string;
  onDone: () => void;
}) {
  const saveShares = useSaveShares(month);
  const members = (useMembers().data ?? []).filter((m) => !m.archived);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      members.map((m) => [
        m.id,
        String(Number(item.shares?.find((s) => s.memberId === m.id)?.share ?? 0) || ''),
      ]),
    ),
  );
  const pending = saveShares.isPending;
  const error = saveShares.isError ? errorMessage(saveShares.error) : null;
  // In hundredths: 49.9 + 49.8 + 0.3 must be exactly 100.
  const total = sharesTotal(members.map((m) => values[m.id]));
  const save = (shares: { memberId: string; share: string }[]) =>
    saveShares.mutate(
      { id: item.id, data: { shares } },
      {
        onSuccess: () => {
          toast.success(t('household.shares.saved'));
          onDone();
        },
      },
    );
  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        save(
          members
            .filter((m) => shareHundredths(values[m.id]) > 0)
            .map((m) => ({ memberId: m.id, share: values[m.id]! })),
        );
      }}
    >
      <DialogBody className="grid gap-3">
        <FormError message={error} />
        {members.map((m) => (
          <label key={m.id} className="flex items-center gap-3 text-sm">
            <span
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: m.color }}
              aria-hidden
            />
            <span className="flex-1 truncate">{m.name}</span>
            <Input
              value={values[m.id] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [m.id]: e.target.value }))}
              inputMode="decimal"
              aria-label={t('household.shares.shareFor', { name: m.name })}
              className="h-8 w-20 text-right tabular"
            />
            %
          </label>
        ))}
        <p
          className={
            total === FULL_SHARE || total === 0
              ? 'text-xs text-muted-foreground'
              : 'text-xs text-destructive'
          }
        >
          {t('household.shares.total', { total: hundredthsToPercent(total) })}
        </p>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={() => save([])}>
          {t('household.shares.reset')}
        </Button>
        <DialogClose asChild>
          <Button variant="ghost">{t('common.cancel')}</Button>
        </DialogClose>
        <Button type="submit" disabled={pending || total !== FULL_SHARE}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The month per member: own lines plus their shares of the joint ones. */
export function OwnersBreakdown({ budget }: { budget: MonthBudgetDto }) {
  const members = useMembers();
  if (budget.byOwner.length === 0) return null;
  const base = budget.baseCurrency;
  return (
    <details className="border-t">
      <summary className="cursor-pointer px-4 py-2 text-xs text-muted-foreground hover:text-foreground">
        {t('household.shares.byMembers')}
      </summary>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-1 text-left font-normal">{t('household.shares.member')}</th>
            <th className="px-2 py-1 text-right font-normal">{t('common.income')}</th>
            <th className="px-2 py-1 text-right font-normal">{t('common.expenses')}</th>
            <th className="px-2 py-1 text-right font-normal">{t('household.shares.saves')}</th>
            <th className="px-4 py-1 text-right font-normal">{t('household.shares.left')}</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {budget.byOwner.map((o) => {
            const m = members.data?.find((x) => x.id === o.ownerId);
            return (
              <tr key={o.ownerId} className="border-t">
                <td className="px-4 py-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: m?.color }}
                      aria-hidden
                    />
                    {m?.name ?? '—'}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right">{formatMoney(o.netIncome, base)}</td>
                <td className="px-2 py-1.5 text-right">{formatMoney(o.expenses, base)}</td>
                <td className="px-2 py-1.5 text-right">{formatMoney(o.savings, base)}</td>
                <td
                  className={
                    isNegative(o.free)
                      ? 'px-4 py-1.5 text-right text-destructive'
                      : 'px-4 py-1.5 text-right'
                  }
                >
                  {formatMoney(o.free, base)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}
