import {
  PLANNER_CURRENCIES,
  potCreateSchema,
  type PotCreateInput,
  type PotDto,
  type PotKind,
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
import { useSavingsMutations } from './api';
import { FormFooter } from './form-footer';
import { OwnerSelect } from '../household/owner';
import { t } from '@/i18n';

export interface PotDialogState {
  open: boolean;
  pot: PotDto | null;
  kind: PotKind;
}

const FIELDS = [
  'name',
  'currency',
  'balance',
  'ownerId',
  'target',
  'targetDate',
  'priority',
  'icon',
  'color',
  'description',
  'note',
  'excludeFromTotal',
] as const;

const resolver = schemaResolver(potCreateSchema);

export function PotDialog({
  state,
  month,
  onClose,
}: {
  state: PotDialogState;
  month: string;
  onClose: () => void;
}) {
  const kind = state.pot?.kind ?? state.kind;
  return (
    <FormDialog
      open={state.open}
      onOpenChange={(open) => !open && onClose()}
      title={
        state.pot
          ? state.pot.name
          : kind === 'CASH'
            ? t('savings.pot.newCash')
            : t('savings.pot.newPortfolio')
      }
      description={
        kind === 'CASH' ? t('savings.pot.cashDescription') : t('savings.pot.portfolioDescription')
      }
      isDirty={false}
    >
      {state.open && (
        <PotForm
          key={state.pot?.id ?? kind}
          pot={state.pot}
          kind={kind}
          month={month}
          onDone={onClose}
        />
      )}
    </FormDialog>
  );
}

function PotForm({
  pot,
  kind,
  month,
  onDone,
}: {
  pot: PotDto | null;
  kind: PotKind;
  month: string;
  onDone: () => void;
}) {
  const { createPot, updatePot } = useSavingsMutations(month, { silent: true });
  const [formError, setFormError] = useState<string | null>(null);
  const isFund = kind === 'CASH';
  // The money of a fund with history stays in its currency.
  const lockCurrency = isFund && pot !== null && pot.movements.length > 0;
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors },
  } = useForm<PotCreateInput, unknown, z.output<typeof potCreateSchema>>({
    // An empty opening balance is zero.
    resolver: (values, context, options) =>
      resolver({ ...values, balance: values.balance || '0' }, context, options),
    defaultValues: {
      kind,
      name: pot?.name ?? (kind === 'PORTFOLIO' ? t('savings.pot.portfolioDefaultName') : ''),
      currency: pot?.currency ?? (kind === 'PORTFOLIO' ? 'USD' : 'PLN'),
      balance: '',
      ownerId: pot?.ownerId ?? null,
      target: pot?.target ?? '',
      targetDate: pot?.targetDate ?? '',
      priority: pot?.priority ?? 0,
      icon: pot?.icon ?? '',
      color: pot?.color ?? '#10b981',
      description: pot?.description ?? '',
      note: pot?.note ?? '',
      excludeFromTotal: pot?.excludeFromTotal ?? false,
    },
  });
  const currency = useWatch({ control, name: 'currency' });
  const ownerId = useWatch({ control, name: 'ownerId' }) ?? null;

  const onSubmit = handleSubmit(async (payload) => {
    setFormError(null);
    const fields = {
      name: payload.name,
      currency: payload.currency,
      ownerId: payload.ownerId,
      color: payload.color,
      ...(isFund
        ? {
            target: payload.target,
            targetDate: payload.targetDate,
            priority: payload.priority,
            icon: payload.icon,
            description: payload.description,
            note: payload.note,
            excludeFromTotal: payload.excludeFromTotal,
          }
        : {}),
    };
    try {
      if (pot) await updatePot.mutateAsync({ id: pot.id, data: fields });
      else await createPot.mutateAsync({ ...fields, kind, balance: payload.balance });
      toast.success(
        pot
          ? t('savings.pot.saved')
          : isFund
            ? t('savings.pot.fundAdded')
            : t('savings.pot.portfolioAdded'),
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
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          {isFund && (
            <FormField id="pot-icon" label={t('savings.pot.icon')} error={errors.icon?.message}>
              <Input
                {...fieldA11y('pot-icon', errors.icon?.message)}
                {...register('icon')}
                placeholder="🎯"
                className="w-16 text-center text-lg"
                maxLength={8}
              />
            </FormField>
          )}
          <FormField id="pot-name" label={t('common.name')} error={errors.name?.message}>
            <Input
              {...fieldA11y('pot-name', errors.name?.message)}
              {...register('name')}
              placeholder={
                isFund
                  ? t('savings.pot.fundNamePlaceholder')
                  : t('savings.pot.portfolioNamePlaceholder')
              }
              autoComplete="off"
              autoFocus
            />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            id="pot-currency"
            label={t('common.currency')}
            hint={isFund ? undefined : t('savings.pot.currencyHint')}
            error={errors.currency?.message}
          >
            {lockCurrency ? (
              <NativeSelect id="pot-currency" value={currency} disabled>
                <option value={currency}>{currency}</option>
              </NativeSelect>
            ) : (
              <NativeSelect
                {...fieldA11y(
                  'pot-currency',
                  errors.currency?.message,
                  isFund ? undefined : 'hint',
                )}
                {...register('currency')}
              >
                {PLANNER_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {/* A fund belongs to its parts' owners; only a portfolio has one owner. */}
          {!isFund && (
            <FormField id="pot-owner" label={t('common.owner')}>
              <OwnerSelect
                id="pot-owner"
                value={ownerId}
                onChange={(id) => setValue('ownerId', id)}
              />
            </FormField>
          )}
          <FormField id="pot-color" label={t('savings.pot.color')}>
            <Input id="pot-color" type="color" {...register('color')} className="h-9 w-16 p-1" />
          </FormField>
        </div>
        {isFund && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                id="pot-target"
                label={t('savings.pot.target', { currency })}
                error={errors.target?.message}
              >
                <Input
                  {...fieldA11y('pot-target', errors.target?.message)}
                  {...register('target')}
                  inputMode="decimal"
                  placeholder={t('savings.pot.noTarget')}
                  className="tabular"
                />
              </FormField>
              <FormField
                id="pot-date"
                label={t('savings.pot.targetDate')}
                error={errors.targetDate?.message}
              >
                <Input
                  {...fieldA11y('pot-date', errors.targetDate?.message)}
                  {...register('targetDate')}
                  type="date"
                />
              </FormField>
              <FormField
                id="pot-priority"
                label={t('savings.pot.priority')}
                hint={t('savings.pot.priorityHint')}
                error={errors.priority?.message}
              >
                <Input
                  {...fieldA11y('pot-priority', errors.priority?.message, 'hint')}
                  {...register('priority', { setValueAs: (value) => Number(value) || 0 })}
                  inputMode="numeric"
                  className="w-20 tabular"
                />
              </FormField>
            </div>
            {!pot && (
              <FormField
                id="pot-balance"
                label={t('savings.pot.initial')}
                hint={t('savings.pot.initialHint')}
                error={errors.balance?.message}
              >
                <Input
                  {...fieldA11y('pot-balance', errors.balance?.message, 'hint')}
                  {...register('balance')}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  className="tabular"
                />
              </FormField>
            )}
            <FormField
              id="pot-description"
              label={t('savings.pot.description')}
              error={errors.description?.message}
            >
              <Input
                {...fieldA11y('pot-description', errors.description?.message)}
                {...register('description')}
                placeholder={t('savings.pot.descriptionPlaceholder')}
                autoComplete="off"
              />
            </FormField>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                {...register('excludeFromTotal')}
              />
              <span>
                {t('savings.pot.excludeFromTotal')}
                <span className="block text-xs text-muted-foreground">
                  {t('savings.pot.excludeFromTotalHint')}
                </span>
              </span>
            </label>
            <FormField id="pot-note" label={t('savings.pot.notes')} error={errors.note?.message}>
              <textarea
                {...fieldA11y('pot-note', errors.note?.message)}
                {...register('note')}
                rows={3}
                className="min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </FormField>
          </>
        )}
      </DialogBody>
      <FormFooter
        pending={createPot.isPending || updatePot.isPending}
        label={pot ? t('common.save') : t('common.add')}
      />
    </form>
  );
}
