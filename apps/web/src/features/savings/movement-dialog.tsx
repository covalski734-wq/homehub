import {
  currentMonth,
  movementCreateSchema,
  shiftMonth,
  todayDate,
  type MovementCreateInput,
  type MovementType,
  type PotDto,
} from '@homehub/shared';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormError } from '@/components/states/states';
import { DialogBody } from '@/components/ui/dialog';
import { FormDialog } from '@/components/ui/form-dialog';
import { fieldA11y, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { applyServerErrors } from '@/lib/form-errors';
import { schemaResolver } from '@/lib/form-resolver';
import { formatMoney, formatMonth } from '@/lib/format';
import { useSavingsMutations } from './api';
import { FormFooter } from './form-footer';
import { useAccounts } from '../accounts/use-accounts';
import { t } from '@/i18n';

export interface MovementDialogState {
  pot: PotDto;
  type: MovementType;
  subaccountId?: string;
}

const FIELDS = ['type', 'amount', 'date', 'note', 'subaccountId', 'repayMonth'] as const;

const resolver = schemaResolver(movementCreateSchema);

/** Deposit into a fund part or withdraw from it (optionally to be returned in a later month). */
export function MovementDialog({
  state,
  month,
  onClose,
}: {
  state: MovementDialogState | null;
  month: string;
  onClose: () => void;
}) {
  return (
    <FormDialog
      open={state !== null}
      onOpenChange={(open) => !open && onClose()}
      title={
        state
          ? state.type === 'DEPOSIT'
            ? t('savings.movement.depositTitle', { name: state.pot.name })
            : t('savings.movement.withdrawTitle', { name: state.pot.name })
          : ''
      }
      description={
        state
          ? t('savings.movement.balance', {
              amount: formatMoney(state.pot.balance, state.pot.currency),
            })
          : undefined
      }
      isDirty={false}
    >
      {state && (
        <MovementForm
          key={`${state.pot.id}:${state.type}`}
          pot={state.pot}
          initialType={state.type}
          initialPart={state.subaccountId}
          month={month}
          onDone={onClose}
        />
      )}
    </FormDialog>
  );
}

/** A date inside the shown month: today in the current one, otherwise its first day. */
const defaultDate = (month: string) => (month === currentMonth() ? todayDate() : `${month}-01`);

function MovementForm({
  pot,
  initialType,
  initialPart,
  month,
  onDone,
}: {
  pot: PotDto;
  initialType: MovementType;
  initialPart?: string;
  month: string;
  onDone: () => void;
}) {
  const { addMovement } = useSavingsMutations(month, { silent: true });
  const accounts = useAccounts();
  const parts = pot.subaccounts.filter((p) => !p.archived);
  const [formError, setFormError] = useState<string | null>(null);
  // 'NEW' — new money onto the part's account, 'RESERVE' — already there (only set aside),
  // otherwise the id of the account the money is transferred from.
  const [from, setFrom] = useState('NEW');
  const [repay, setRepay] = useState(true);
  const date0 = defaultDate(month);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors },
  } = useForm<MovementCreateInput, unknown, z.output<typeof movementCreateSchema>>({
    resolver,
    defaultValues: {
      type: initialType,
      amount: '',
      date: date0,
      note: '',
      subaccountId: initialPart ?? parts[0]?.id ?? '',
      keepOnAccount: false,
      repayMonth: shiftMonth(date0.slice(0, 7), 1),
    },
  });
  const type = useWatch({ control, name: 'type' });
  const amount = useWatch({ control, name: 'amount' });
  const date = useWatch({ control, name: 'date' });
  const repayMonth = useWatch({ control, name: 'repayMonth' }) ?? '';
  const partId = useWatch({ control, name: 'subaccountId' });
  const part = parts.find((p) => p.id === partId);
  const currency = part?.currency ?? pot.currency;
  const sources = (accounts.data ?? []).filter(
    (a) => !a.archived && a.currency === currency && a.id !== part?.accountId,
  );
  const withdrawal = type === 'WITHDRAWAL';
  const after = shiftMonth(date.slice(0, 7), 1);
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(after, i));
  if (!months.includes(repayMonth)) months.unshift(repayMonth);

  const onSubmit = handleSubmit(async (payload) => {
    setFormError(null);
    try {
      await addMovement.mutateAsync({
        potId: pot.id,
        data: {
          ...payload,
          source: from === 'NEW' ? 'NEW' : from === 'RESERVE' ? 'RESERVE' : 'ACCOUNT',
          fromAccountId: !withdrawal && from !== 'NEW' && from !== 'RESERVE' ? from : null,
          repayMonth: withdrawal && repay ? payload.repayMonth : null,
        },
      });
      toast.success(
        withdrawal
          ? repay
            ? t('savings.movement.withdrawnWithRepay', {
                month: formatMonth(repayMonth).toLowerCase(),
              })
            : t('savings.movement.withdrawn')
          : t('savings.movement.deposited'),
      );
      onDone();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="grid gap-4">
        <FormError message={formError} />
        <SegmentedControl
          label={t('common.operation')}
          value={type}
          onChange={(value) => setValue('type', value)}
          options={[
            { value: 'DEPOSIT', label: t('savings.movement.deposit') },
            { value: 'WITHDRAWAL', label: t('savings.movement.withdraw') },
          ]}
        />
        {parts.length > 1 && (
          <FormField id="movement-part" label={t('savings.movement.part')}>
            <NativeSelect id="movement-part" {...register('subaccountId')}>
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {formatMoney(p.balance, p.currency)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}
        {!withdrawal && part?.accountId && (
          <FormField
            id="movement-from"
            label={t('savings.movement.source')}
            hint={
              from === 'NEW'
                ? t('savings.movement.sourceHintNew')
                : from === 'RESERVE'
                  ? t('savings.movement.sourceHintReserve')
                  : t('savings.movement.sourceHintTransfer')
            }
          >
            <NativeSelect
              {...fieldA11y('movement-from', undefined, 'hint')}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            >
              <option value="NEW">{t('savings.movement.sourceNew')}</option>
              <option value="RESERVE">{t('savings.movement.sourceReserve')}</option>
              {sources.map((a) => (
                <option key={a.id} value={a.id}>
                  {t('savings.movement.sourceTransfer', { account: a.name })}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="movement-amount"
            label={t('common.amountIn', { currency })}
            error={errors.amount?.message}
          >
            <Input
              {...fieldA11y('movement-amount', errors.amount?.message)}
              {...register('amount')}
              inputMode="decimal"
              autoComplete="off"
              className="tabular"
              autoFocus
            />
          </FormField>
          <FormField id="movement-date" label={t('common.date')} error={errors.date?.message}>
            <Input
              {...fieldA11y('movement-date', errors.date?.message)}
              {...register('date', {
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                  if (e.target.value)
                    setValue('repayMonth', shiftMonth(e.target.value.slice(0, 7), 1));
                },
              })}
              type="date"
            />
          </FormField>
        </div>
        <FormField id="movement-note" label={t('common.comment')} error={errors.note?.message}>
          <Input
            {...fieldA11y('movement-note', errors.note?.message)}
            {...register('note')}
            placeholder={withdrawal ? t('savings.movement.notePlaceholder') : t('common.optional')}
            autoComplete="off"
          />
        </FormField>
        {withdrawal && part?.accountId && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              {...register('keepOnAccount')}
            />
            {t('savings.movement.keepOnAccount')}
          </label>
        )}
        {withdrawal && (
          <div className="grid gap-3 rounded-lg border p-3">
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                checked={repay}
                onChange={(e) => setRepay(e.target.checked)}
              />
              <span>
                <span className="font-medium">{t('savings.movement.repay')}</span>
                <span className="block text-xs text-muted-foreground">
                  {t('savings.movement.repayHint', { name: pot.name })}
                </span>
              </span>
            </label>
            {repay && (
              <FormField
                id="movement-repay"
                label={t('savings.movement.repayMonth')}
                error={errors.repayMonth?.message}
              >
                <NativeSelect
                  {...fieldA11y('movement-repay', errors.repayMonth?.message)}
                  {...register('repayMonth')}
                >
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {formatMonth(m)}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            )}
          </div>
        )}
      </DialogBody>
      <FormFooter
        pending={addMovement.isPending}
        label={withdrawal ? t('savings.movement.withdraw') : t('savings.movement.deposit')}
        disabled={!amount || !date}
      />
    </form>
  );
}
