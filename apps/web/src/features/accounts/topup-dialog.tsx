import { accountTopupSchema, todayDate, type AccountDto } from '@homehub/shared';
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
import { useTopupAccount } from './use-accounts';
import { t } from '@/i18n';

const FIELDS = ['amount', 'date', 'note'] as const;

/**
 * «Пополнить счет»: money put on the account from outside the plan (savings brought from
 * elsewhere, a gift). It stays in the account's history; it is not income of the month.
 */
export function TopupDialog({
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
      title={account ? t('accounts.topUp.title', { name: account.name }) : ''}
      description={
        account
          ? t('accounts.topUp.current', {
              balance: formatMoney(account.balance, account.currency),
            })
          : undefined
      }
      isDirty={false}
    >
      {account && <TopupForm key={account.id} account={account} onDone={onClose} />}
    </FormDialog>
  );
}

function TopupForm({ account, onDone }: { account: AccountDto; onDone: () => void }) {
  const save = useTopupAccount(account.id);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<z.input<typeof accountTopupSchema>, unknown, z.output<typeof accountTopupSchema>>({
    resolver: schemaResolver(accountTopupSchema),
    defaultValues: { amount: '', date: todayDate(), note: '' },
  });

  const amount = useWatch({ control, name: 'amount' });

  const onSubmit = handleSubmit(async (input) => {
    setFormError(null);
    try {
      await save.mutateAsync(input);
      toast.success(t('accounts.topUp.done'));
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
            id="topup-amount"
            label={t('common.amountIn', { currency: account.currency })}
            error={errors.amount?.message}
          >
            <Input
              {...fieldA11y('topup-amount', errors.amount?.message)}
              {...register('amount')}
              inputMode="decimal"
              className="tabular"
              autoFocus
            />
          </FormField>
          <FormField id="topup-date" label={t('common.date')} error={errors.date?.message}>
            <Input
              {...fieldA11y('topup-date', errors.date?.message)}
              {...register('date')}
              type="date"
            />
          </FormField>
        </div>
        <FormField id="topup-note" label={t('accounts.topUp.source')} error={errors.note?.message}>
          <Input
            {...fieldA11y('topup-note', errors.note?.message)}
            {...register('note')}
            placeholder={t('accounts.topUp.sourcePlaceholder')}
            autoComplete="off"
          />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">{t('common.cancel')}</Button>
        </DialogClose>
        <Button type="submit" disabled={save.isPending || !amount}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {t('accounts.topUp.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
