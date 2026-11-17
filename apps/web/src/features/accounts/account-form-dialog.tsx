import { schemaResolver } from '@/lib/form-resolver';
import {
  ACCOUNT_TYPES,
  accountCreateSchema,
  SUPPORTED_CURRENCIES,
  type AccountCreateInput,
  type AccountCreatePayload,
  type AccountDto,
} from '@homehub/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { FormError } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { DialogBody, DialogClose, DialogFooter } from '@/components/ui/dialog';
import { FormDialog } from '@/components/ui/form-dialog';
import { fieldA11y, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { applyServerErrors } from '@/lib/form-errors';
import { ACCOUNT_TYPE_LABELS } from '../transactions/transaction-labels';
import { useSaveAccount } from './use-accounts';
import { useMembers } from '../household/api';
import { ownerOptions } from '../household/owner';
import { t } from '@/i18n';

const FIELDS = ['name', 'type', 'currency', 'initialBalance', 'ownerId', 'color', 'note'] as const;

interface AccountFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: AccountDto | null;
}

export function AccountFormDialog({ open, onOpenChange, account }: AccountFormDialogProps) {
  const [isDirty, setIsDirty] = useState(false);
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setIsDirty(false);
        onOpenChange(next);
      }}
      title={account ? t('accounts.form.editTitle') : t('accounts.form.newTitle')}
      isDirty={isDirty}
    >
      <AccountForm
        key={account?.id ?? 'new'}
        account={account}
        onDone={() => onOpenChange(false)}
        onDirtyChange={setIsDirty}
      />
    </FormDialog>
  );
}

function AccountForm({
  account,
  onDone,
  onDirtyChange,
}: {
  account: AccountDto | null;
  onDone: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const save = useSaveAccount();
  const members = useMembers();
  const [formError, setFormError] = useState<string | null>(null);
  const currencyLocked = Boolean(account && account.transactionCount > 0);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<AccountCreateInput, unknown, AccountCreatePayload>({
    resolver: schemaResolver(accountCreateSchema),
    defaultValues: account
      ? {
          name: account.name,
          type: account.type,
          currency: account.currency,
          initialBalance: account.initialBalance,
          ownerId: account.ownerId ?? '',
          color: account.color ?? '#64748b',
          note: account.note,
        }
      : {
          name: '',
          type: 'CARD',
          currency: 'PLN',
          initialBalance: '0',
          ownerId: '',
          color: '#64748b',
          note: '',
        },
  });

  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  const onSubmit = handleSubmit(async (payload) => {
    setFormError(null);
    // PATCH only what changed, so an unchanged currency is never re-validated against history.
    const data = account
      ? Object.fromEntries(
          FIELDS.filter((field) => dirtyFields[field]).map((field) => [field, payload[field]]),
        )
      : payload;
    try {
      await save.mutateAsync({ id: account?.id, data });
      toast.success(account ? t('accounts.toast.saved') : t('accounts.toast.created'));
      onDirtyChange(false);
      onDone();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="grid gap-4">
        <FormError message={formError} />
        <FormField id="account-name" label={t('common.name')} error={errors.name?.message}>
          <Input
            {...fieldA11y('account-name', errors.name?.message)}
            {...register('name')}
            placeholder={t('accounts.form.namePlaceholder')}
            autoComplete="off"
            autoFocus
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="account-type" label={t('common.type')} error={errors.type?.message}>
            <NativeSelect
              {...fieldA11y('account-type', errors.type?.message)}
              {...register('type')}
            >
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {ACCOUNT_TYPE_LABELS[type]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField
            id="account-currency"
            label={t('common.currency')}
            error={errors.currency?.message}
            hint={currencyLocked ? t('accounts.form.currencyLocked') : undefined}
          >
            {currencyLocked && account ? (
              <Input
                {...fieldA11y('account-currency', undefined, 'hint')}
                value={account.currency}
                readOnly
              />
            ) : (
              <NativeSelect
                {...fieldA11y('account-currency', errors.currency?.message)}
                {...register('currency')}
              >
                {SUPPORTED_CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
        </div>
        <FormField
          id="account-balance"
          label={t('accounts.form.openingBalance')}
          error={errors.initialBalance?.message}
          hint={t('accounts.form.openingBalanceHint')}
        >
          <Input
            {...fieldA11y('account-balance', errors.initialBalance?.message, 'hint')}
            {...register('initialBalance')}
            inputMode="decimal"
            autoComplete="off"
            className="tabular"
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <FormField id="account-owner" label={t('common.owner')}>
            <NativeSelect id="account-owner" {...register('ownerId')}>
              {ownerOptions(members.data, account?.ownerId).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="account-color" label={t('accounts.form.color')}>
            <Input
              id="account-color"
              type="color"
              className="h-9 w-16 p-1"
              {...register('color')}
            />
          </FormField>
        </div>
        <FormField id="account-note" label={t('common.note')} error={errors.note?.message}>
          <Input
            {...fieldA11y('account-note', errors.note?.message)}
            {...register('note')}
            placeholder={t('accounts.form.notePlaceholder')}
            autoComplete="off"
          />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">{t('common.cancel')}</Button>
        </DialogClose>
        <Button type="submit" disabled={save.isPending || (Boolean(account) && !isDirty)}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {account ? t('common.save') : t('accounts.form.create')}
        </Button>
      </DialogFooter>
    </form>
  );
}
