import {
  PLANNER_CURRENCIES,
  serverTextVariants,
  subaccountCreateSchema,
  type PotDto,
  type SubaccountCreateInput,
  type SubaccountDto,
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
import { applyServerErrors } from '@/lib/form-errors';
import { schemaResolver } from '@/lib/form-resolver';
import { formatMoney } from '@/lib/format';
import { useSavingsMutations } from './api';
import { FormFooter } from './form-footer';
import { moneySign } from './model';
import { useAccounts } from '../accounts/use-accounts';
import { memberOf, OwnerSelect } from '../household/owner';
import { useMembers } from '../household/api';
import { t } from '@/i18n';

export interface PartDialogState {
  pot: PotDto;
  part: SubaccountDto | null;
}

const FIELDS = ['name', 'currency', 'ownerId', 'color', 'accountId', 'balance', 'note'] as const;

const resolver = schemaResolver(subaccountCreateSchema);

/** A part of a fund: owner, the real account its money lies on, currency and balance. */
export function PartDialog({
  state,
  month,
  onClose,
}: {
  state: PartDialogState | null;
  month: string;
  onClose: () => void;
}) {
  return (
    <FormDialog
      open={state !== null}
      onOpenChange={(open) => !open && onClose()}
      title={state?.part ? state.part.name : t('savings.part.newTitle')}
      description={state ? t('savings.part.description', { fund: state.pot.name }) : undefined}
      isDirty={false}
    >
      {state && (
        <SubaccountForm
          key={state.part?.id ?? 'new'}
          pot={state.pot}
          part={state.part}
          month={month}
          onDone={onClose}
        />
      )}
    </FormDialog>
  );
}

function SubaccountForm({
  pot,
  part,
  month,
  onDone,
}: {
  pot: PotDto;
  part: SubaccountDto | null;
  month: string;
  onDone: () => void;
}) {
  const { createPart, updatePart } = useSavingsMutations(month, { silent: true });
  const accounts = useAccounts();
  const members = useMembers();
  const [formError, setFormError] = useState<string | null>(null);
  const [allAccounts, setAllAccounts] = useState(false);
  const locked = Boolean(part && (moneySign(part.balance) !== 0 || part.autoRules.length > 0));
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    control,
    formState: { errors },
  } = useForm<SubaccountCreateInput, unknown, z.output<typeof subaccountCreateSchema>>({
    // An empty name is the owner's name (or «Общая»), an empty opening balance is zero.
    resolver: (values, context, options) =>
      resolver(
        {
          ...values,
          name:
            values.name ||
            memberOf(members.data, values.ownerId)?.name ||
            t('savings.part.defaultName'),
          balance: part ? values.balance : values.balance || '0',
        },
        context,
        options,
      ),
    defaultValues: {
      ownerId: part?.ownerId ?? null,
      name: part?.name ?? '',
      color: part?.color ?? memberOf(members.data, part?.ownerId)?.color ?? '#94a3b8',
      accountId: part?.accountId ?? '',
      currency: part?.currency ?? pot.currency,
      balance: part?.balance ?? '',
      note: part?.note ?? '',
    },
  });
  const ownerId = useWatch({ control, name: 'ownerId' }) ?? null;
  const accountId = useWatch({ control, name: 'accountId' }) ?? '';
  const currency = useWatch({ control, name: 'currency' }) ?? pot.currency;
  const inCurrency = (accounts.data ?? []).filter((a) => !a.archived && a.currency === currency);
  // The owner's accounts and joint ones; all of them on request.
  const usable = allAccounts
    ? inCurrency
    : inCurrency.filter((a) => !a.ownerId || a.ownerId === ownerId || a.id === accountId);

  // A name that is empty, the joint default or the previous owner's follows the new owner.
  const pickOwner = (id: string | null) => {
    const name = getValues('name');
    const previous = memberOf(members.data, getValues('ownerId'));
    setValue('ownerId', id);
    const member = memberOf(members.data, id);
    if (member) {
      if (!name || serverTextVariants('fund.jointPart').includes(name) || name === previous?.name)
        setValue('name', member.name);
      if (!part?.color) setValue('color', member.color);
    }
  };

  const onSubmit = handleSubmit(async (payload) => {
    setFormError(null);
    const data = {
      name: payload.name,
      ownerId: payload.ownerId,
      color: payload.color,
      accountId: usable.some((a) => a.id === payload.accountId) ? payload.accountId : null,
      note: payload.note,
      currency: payload.currency ?? pot.currency,
    };
    try {
      if (part)
        await updatePart.mutateAsync({
          id: part.id,
          data: {
            ...data,
            ...(payload.balance !== part.balance ? { balance: payload.balance } : {}),
          },
        });
      else
        await createPart.mutateAsync({
          potId: pot.id,
          data: { ...data, balance: payload.balance },
        });
      toast.success(part ? t('savings.part.saved') : t('savings.part.added'));
      onDone();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="grid gap-4">
        <FormError message={formError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="part-owner" label={t('common.owner')}>
            <OwnerSelect id="part-owner" value={ownerId} onChange={pickOwner} />
          </FormField>
          <FormField id="part-name" label={t('common.name')} error={errors.name?.message}>
            <Input
              {...fieldA11y('part-name', errors.name?.message)}
              {...register('name')}
              placeholder={t('savings.part.namePlaceholder')}
              autoComplete="off"
            />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-[auto_1fr_auto]">
          <FormField id="part-currency" label={t('common.currency')}>
            {locked ? (
              <NativeSelect id="part-currency" value={currency} disabled>
                <option value={currency}>{currency}</option>
              </NativeSelect>
            ) : (
              <NativeSelect id="part-currency" {...register('currency')}>
                {PLANNER_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id="part-account"
            label={t('savings.part.account')}
            hint={accountId ? t('savings.part.accountHintOn') : t('savings.part.accountHintOff')}
          >
            {/* Controlled: the accounts may arrive after the form opens. */}
            <NativeSelect
              {...fieldA11y('part-account', undefined, 'hint')}
              value={accountId}
              onChange={(e) => setValue('accountId', e.target.value)}
            >
              <option value="">{t('savings.part.noAccount')}</option>
              {usable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {formatMoney(a.available, a.currency)} {t('savings.part.accountFree')}
                </option>
              ))}
            </NativeSelect>
            {inCurrency.length > usable.length && (
              <button
                type="button"
                onClick={() => setAllAccounts(true)}
                className="mt-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                {t('savings.part.showOthers')}
              </button>
            )}
          </FormField>
          <FormField id="part-color" label={t('savings.part.color')}>
            <Input id="part-color" type="color" {...register('color')} className="h-9 w-16 p-1" />
          </FormField>
        </div>
        <FormField
          id="part-balance"
          label={
            part ? t('savings.part.balance', { currency }) : t('savings.part.initial', { currency })
          }
          hint={part ? t('savings.part.balanceHint') : undefined}
          error={errors.balance?.message}
        >
          <Input
            {...fieldA11y('part-balance', errors.balance?.message, part ? 'hint' : undefined)}
            {...register('balance')}
            inputMode="decimal"
            placeholder="0"
            className="tabular"
          />
        </FormField>
        <FormField id="part-note" label={t('savings.part.notes')} error={errors.note?.message}>
          <Input
            {...fieldA11y('part-note', errors.note?.message)}
            {...register('note')}
            autoComplete="off"
          />
        </FormField>
      </DialogBody>
      <FormFooter
        pending={createPart.isPending || updatePart.isPending}
        label={part ? t('common.save') : t('common.add')}
      />
    </form>
  );
}
