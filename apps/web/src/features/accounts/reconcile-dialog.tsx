import { reconcileSchema, todayDate, type AccountDto } from '@homehub/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormError } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { DialogBody, DialogClose, DialogFooter } from '@/components/ui/dialog';
import { FormDialog } from '@/components/ui/form-dialog';
import { fieldA11y, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { applyServerErrors } from '@/lib/form-errors';
import { schemaResolver } from '@/lib/form-resolver';
import { formatMoney } from '@/lib/format';
import { reconcileDifference } from './model';
import { useReconcileAccount } from './use-accounts';
import { t } from '@/i18n';

const FIELDS = ['balance', 'date'] as const;

/**
 * «Сверить остаток»: the balance the bank shows. The difference is saved as a reconciliation —
 * it moves the balance but is never income or spending in the plan/fact.
 */
export function ReconcileDialog({
  account,
  onClose,
}: {
  account: AccountDto | null;
  onClose: () => void;
}) {
  return (
    <FormDialog
      open={account !== null}
      onOpenChange={(open) => !open && onClose()}
      title={account ? t('accounts.reconcile.title', { name: account.name }) : ''}
      description={
        account
          ? t('accounts.reconcile.current', {
              balance: formatMoney(account.balance, account.currency),
            })
          : undefined
      }
      isDirty={false}
    >
      {account && <ReconcileForm key={account.id} account={account} onDone={onClose} />}
    </FormDialog>
  );
}

function ReconcileForm({ account, onDone }: { account: AccountDto; onDone: () => void }) {
  const save = useReconcileAccount(account.id);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<z.input<typeof reconcileSchema>, unknown, z.output<typeof reconcileSchema>>({
    resolver: schemaResolver(reconcileSchema),
    defaultValues: { balance: account.balance, date: todayDate() },
  });
  const balance = useWatch({ control, name: 'balance' });
  const diff = reconcileDifference(balance, account.balance);

  const onSubmit = handleSubmit(async (input) => {
    setFormError(null);
    try {
      await save.mutateAsync(input);
      toast.success(t('accounts.reconcile.done'));
      onDone();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  return (
    <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
      <DialogBody className="grid gap-4">
        <FormError message={formError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="reconcile-balance"
            label={t('accounts.reconcile.bankBalance', { currency: account.currency })}
            error={errors.balance?.message}
          >
            <Input
              {...fieldA11y('reconcile-balance', errors.balance?.message)}
              {...register('balance')}
              inputMode="decimal"
              autoComplete="off"
              className="tabular"
              autoFocus
            />
          </FormField>
          <FormField id="reconcile-date" label={t('common.date')} error={errors.date?.message}>
            <Input
              {...fieldA11y('reconcile-date', errors.date?.message)}
              {...register('date')}
              type="date"
            />
          </FormField>
        </div>
        {diff !== null && (
          <p className="text-sm text-muted-foreground">
            {t('accounts.reconcile.adjustment', {
              amount: formatMoney(diff, account.currency, { signed: true }),
            })}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">{t('common.cancel')}</Button>
        </DialogClose>
        <Button type="submit" disabled={save.isPending || !balance}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {t('accounts.reconcile.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
