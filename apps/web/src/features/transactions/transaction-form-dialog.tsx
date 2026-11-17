import { isDemoSample } from '@/lib/demo';
import { schemaResolver } from '@/lib/form-resolver';
import {
  transactionInputSchema,
  type AccountDto,
  type CategoryDto,
  type TransactionDto,
  type TransactionInput,
  type TransactionPayload,
  type TransactionType,
} from '@homehub/shared';
import { Loader2, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { EmptyState, FormError } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { DialogBody, DialogClose, DialogFooter } from '@/components/ui/dialog';
import { FormDialog } from '@/components/ui/form-dialog';
import { fieldA11y, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { applyServerErrors } from '@/lib/form-errors';
import { categoryName } from '@/lib/system-texts';
import { useAccounts } from '../accounts/use-accounts';
import { useCategories } from '../categories/use-categories';
import { TYPE_OPTIONS } from './transaction-labels';
import { useSaveTransaction } from './use-transactions';
import { useMembers } from '../household/api';
import { ownerOptions } from '../household/owner';
import { t } from '@/i18n';

const FIELDS = [
  'type',
  'accountId',
  'toAccountId',
  'categoryId',
  'amount',
  'toAmount',
  'description',
  'occurredAt',
] as const;

interface TransactionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionDto | null;
  defaultDate: string;
  onDelete?: (transaction: TransactionDto) => void;
}

function initialValues(
  transaction: TransactionDto | null,
  accounts: AccountDto[],
  defaultDate: string,
): TransactionInput {
  if (transaction) {
    return {
      type: transaction.type,
      accountId: transaction.account.id,
      toAccountId: transaction.toAccount?.id ?? '',
      categoryId: transaction.category?.id ?? '',
      amount: transaction.amount,
      toAmount:
        transaction.toAmount && transaction.toCurrency !== transaction.currency
          ? transaction.toAmount
          : '',
      description: transaction.description,
      occurredAt: transaction.occurredAt,
      payerId: transaction.payerId ?? '',
    };
  }
  return {
    type: 'EXPENSE',
    accountId: accounts.find((account) => !account.archived)?.id ?? '',
    toAccountId: '',
    categoryId: '',
    amount: '',
    toAmount: '',
    description: '',
    occurredAt: defaultDate,
    payerId: '',
  };
}

export function TransactionFormDialog(props: TransactionFormDialogProps) {
  const accounts = useAccounts();
  const categories = useCategories();
  const [isDirty, setIsDirty] = useState(false);
  const title = props.transaction
    ? t('transactions.form.editTitle')
    : t('transactions.form.newTitle');

  let content;
  if (accounts.isPending || categories.isPending) {
    content = (
      <DialogBody className="flex justify-center py-10">
        <Loader2
          className="size-5 animate-spin text-muted-foreground"
          aria-label={t('transactions.form.loading')}
        />
      </DialogBody>
    );
  } else if (!accounts.data || !categories.data) {
    content = (
      <DialogBody>
        <FormError message={t('transactions.form.loadError')} />
      </DialogBody>
    );
  } else if (accounts.data.filter((a) => !a.archived && !isDemoSample(a)).length === 0) {
    content = (
      <DialogBody>
        <EmptyState
          title={t('transactions.form.noAccounts.title')}
          description={t('transactions.form.noAccounts.description')}
          action={
            <Button asChild>
              <Link to="/accounts">{t('transactions.form.noAccounts.create')}</Link>
            </Button>
          }
        />
      </DialogBody>
    );
  } else {
    content = (
      <TransactionForm
        key={props.transaction?.id ?? 'new'}
        {...props}
        accounts={accounts.data.filter((a) => !isDemoSample(a))}
        categories={categories.data.filter((c) => !isDemoSample(c))}
        onDirtyChange={setIsDirty}
      />
    );
  }

  return (
    <FormDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setIsDirty(false);
        props.onOpenChange(open);
      }}
      title={title}
      isDirty={isDirty}
    >
      {content}
    </FormDialog>
  );
}

function TransactionForm({
  transaction,
  defaultDate,
  accounts,
  categories,
  onOpenChange,
  onDelete,
  onDirtyChange,
}: TransactionFormDialogProps & {
  accounts: AccountDto[];
  categories: CategoryDto[];
  onDirtyChange: (dirty: boolean) => void;
}) {
  const save = useSaveTransaction();
  const members = useMembers();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isDirty },
  } = useForm<TransactionInput, unknown, TransactionPayload>({
    resolver: schemaResolver(transactionInputSchema),
    defaultValues: initialValues(transaction, accounts, defaultDate),
  });

  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  const [type, accountId, toAccountId] = useWatch({
    control,
    name: ['type', 'accountId', 'toAccountId'],
  });
  const account = accounts.find((a) => a.id === accountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const needsToAmount =
    type === 'TRANSFER' && account && toAccount && account.currency !== toAccount.currency;

  // Archived accounts are hidden unless the edited operation already uses them.
  const selectableAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          !a.archived || a.id === transaction?.account.id || a.id === transaction?.toAccount?.id,
      ),
    [accounts, transaction],
  );
  const kindCategories = categories.filter((c) => c.kind === type);

  const changeType = (next: TransactionType) => {
    setValue('type', next, { shouldDirty: true });
    setValue('categoryId', '', { shouldDirty: true });
    setValue('toAccountId', '', { shouldDirty: true });
    setValue('toAmount', '', { shouldDirty: true });
  };

  const onSubmit = handleSubmit(async (payload) => {
    setFormError(null);
    try {
      await save.mutateAsync({ id: transaction?.id, data: payload });
      toast.success(transaction ? t('transactions.toast.saved') : t('transactions.toast.added'));
      onDirtyChange(false);
      onOpenChange(false);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="grid gap-4">
        <FormError message={formError} />
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <SegmentedControl
              label={t('transactions.form.type')}
              value={field.value}
              options={TYPE_OPTIONS}
              onChange={changeType}
            />
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="tx-amount"
            label={
              account ? t('common.amountIn', { currency: account.currency }) : t('common.amount')
            }
            error={errors.amount?.message}
          >
            <Input
              {...fieldA11y('tx-amount', errors.amount?.message)}
              {...register('amount')}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              className="tabular"
              autoFocus={!transaction}
            />
          </FormField>
          <FormField id="tx-date" label={t('common.date')} error={errors.occurredAt?.message}>
            <Input
              {...fieldA11y('tx-date', errors.occurredAt?.message)}
              {...register('occurredAt')}
              type="date"
            />
          </FormField>
        </div>

        <FormField
          id="tx-account"
          label={
            type === 'TRANSFER'
              ? t('transactions.form.fromAccount')
              : t('transactions.form.account')
          }
          error={errors.accountId?.message}
        >
          <NativeSelect
            {...fieldA11y('tx-account', errors.accountId?.message)}
            {...register('accountId')}
          >
            {selectableAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </NativeSelect>
        </FormField>

        {type === 'TRANSFER' ? (
          <>
            <FormField
              id="tx-to-account"
              label={t('transactions.form.toAccount')}
              error={errors.toAccountId?.message}
            >
              <NativeSelect
                {...fieldA11y('tx-to-account', errors.toAccountId?.message)}
                {...register('toAccountId')}
              >
                <option value="">{t('transactions.form.chooseAccount')}</option>
                {selectableAccounts
                  .filter((a) => a.id !== accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                    </option>
                  ))}
              </NativeSelect>
            </FormField>
            {needsToAmount && (
              <FormField
                id="tx-to-amount"
                label={t('transactions.form.creditedAmount', { currency: toAccount.currency })}
                hint={t('transactions.form.creditedAmountHint')}
                error={errors.toAmount?.message}
              >
                <Input
                  {...fieldA11y('tx-to-amount', errors.toAmount?.message, 'hint')}
                  {...register('toAmount')}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  className="tabular"
                />
              </FormField>
            )}
          </>
        ) : (
          <FormField
            id="tx-category"
            label={t('common.category')}
            error={errors.categoryId?.message}
          >
            <NativeSelect
              {...fieldA11y('tx-category', errors.categoryId?.message)}
              {...register('categoryId')}
            >
              <option value="">{t('transactions.form.chooseCategory')}</option>
              {kindCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryName(c)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}

        <FormField id="tx-payer" label={t('transactions.form.member')}>
          <NativeSelect id="tx-payer" {...register('payerId')}>
            {ownerOptions(members.data, transaction?.payerId).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>

        <FormField
          id="tx-description"
          label={t('common.comment')}
          error={errors.description?.message}
        >
          <Input
            {...fieldA11y('tx-description', errors.description?.message)}
            {...register('description')}
            placeholder={t('common.optional')}
            autoComplete="off"
            maxLength={200}
          />
        </FormField>
      </DialogBody>

      <DialogFooter>
        {transaction && onDelete && (
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive sm:mr-auto"
            onClick={() => onDelete(transaction)}
          >
            <Trash2 /> {t('common.delete')}
          </Button>
        )}
        <DialogClose asChild>
          <Button variant="outline">{t('common.cancel')}</Button>
        </DialogClose>
        <Button type="submit" disabled={save.isPending || (Boolean(transaction) && !isDirty)}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {transaction ? t('transactions.form.saveChanges') : t('common.add')}
        </Button>
      </DialogFooter>
    </form>
  );
}
