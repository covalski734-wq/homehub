import {
  autoAmountSchema,
  autoRuleCreateSchema,
  currentMonth,
  type AutoAmountInput,
  type AutoRuleCreateInput,
  type AutoRuleDto,
  type PotDto,
  type SubaccountDto,
} from '@homehub/shared';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormError } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { DialogBody } from '@/components/ui/dialog';
import { FormDialog } from '@/components/ui/form-dialog';
import { fieldA11y, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/form-errors';
import { schemaResolver } from '@/lib/form-resolver';
import { formatMonth } from '@/lib/format';
import { useSavingsMutations } from './api';
import { FormFooter } from './form-footer';
import { t } from '@/i18n';

export interface AutoDialogState {
  pot: PotDto;
  part: SubaccountDto;
  rule: AutoRuleDto | null;
}

const CREATE_FIELDS = ['type', 'amount', 'day', 'startMonth', 'endMonth', 'note'] as const;

const createResolver = schemaResolver(autoRuleCreateSchema);
const amountResolver = schemaResolver(autoAmountSchema);

/** A new automatic monthly deposit or withdrawal of a part, or the month's amount of one. */
export function AutoDialog({
  state,
  month,
  onClose,
}: {
  state: AutoDialogState | null;
  month: string;
  onClose: () => void;
}) {
  return (
    <FormDialog
      open={state !== null}
      onOpenChange={(open) => !open && onClose()}
      title={
        state?.rule
          ? t('savings.auto.title', { name: state.part.name })
          : t('savings.auto.newTitle', { name: state?.part.name ?? '' })
      }
      description={t('savings.auto.description')}
      isDirty={false}
    >
      {state &&
        (state.rule ? (
          <AutoAmountForm
            key={state.rule.id}
            part={state.part}
            rule={state.rule}
            month={month}
            onDone={onClose}
          />
        ) : (
          <AutoCreateForm key={state.part.id} part={state.part} month={month} onDone={onClose} />
        ))}
    </FormDialog>
  );
}

function AutoCreateForm({
  part,
  month,
  onDone,
}: {
  part: SubaccountDto;
  month: string;
  onDone: () => void;
}) {
  const { createAuto } = useSavingsMutations(month, { silent: true });
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors },
  } = useForm<AutoRuleCreateInput, unknown, z.output<typeof autoRuleCreateSchema>>({
    resolver: createResolver,
    defaultValues: {
      type: 'WITHDRAWAL',
      amount: '',
      day: 1,
      startMonth: month < currentMonth() ? currentMonth() : month,
      endMonth: '',
      note: '',
    },
  });
  const type = useWatch({ control, name: 'type' });
  const amount = useWatch({ control, name: 'amount' });

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    try {
      await createAuto.mutateAsync({ partId: part.id, data });
      toast.success(t('savings.auto.added'));
      onDone();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, CREATE_FIELDS));
    }
  });

  return (
    <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
      <DialogBody className="grid gap-4">
        <FormError message={formError} />
        <SegmentedControl
          label={t('common.operation')}
          value={type}
          onChange={(value) => setValue('type', value)}
          options={[
            { value: 'WITHDRAWAL', label: t('savings.auto.withdraw') },
            { value: 'DEPOSIT', label: t('savings.auto.deposit') },
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="auto-amount"
            label={t('savings.plan.amount', { currency: part.currency })}
            error={errors.amount?.message}
          >
            <Input
              {...fieldA11y('auto-amount', errors.amount?.message)}
              {...register('amount')}
              inputMode="decimal"
              className="tabular"
              autoFocus
            />
          </FormField>
          <FormField id="auto-day" label={t('savings.auto.day')} error={errors.day?.message}>
            <Input
              {...fieldA11y('auto-day', errors.day?.message)}
              {...register('day', { setValueAs: (value) => Number(value) || 1 })}
              inputMode="numeric"
              className="w-20 tabular"
            />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="auto-start"
            label={t('savings.plan.startMonth')}
            error={errors.startMonth?.message}
          >
            <Input
              {...fieldA11y('auto-start', errors.startMonth?.message)}
              {...register('startMonth')}
              type="month"
            />
          </FormField>
          <FormField
            id="auto-end"
            label={t('savings.plan.endMonth')}
            error={errors.endMonth?.message}
          >
            <Input
              {...fieldA11y('auto-end', errors.endMonth?.message)}
              {...register('endMonth')}
              type="month"
            />
          </FormField>
        </div>
        <FormField id="auto-note" label={t('common.comment')} error={errors.note?.message}>
          <Input
            {...fieldA11y('auto-note', errors.note?.message)}
            {...register('note')}
            autoComplete="off"
          />
        </FormField>
      </DialogBody>
      <FormFooter pending={createAuto.isPending} label={t('common.add')} disabled={!amount} />
    </form>
  );
}

function AutoAmountForm({
  part,
  rule,
  month,
  onDone,
}: {
  part: SubaccountDto;
  rule: AutoRuleDto;
  month: string;
  onDone: () => void;
}) {
  const { setAutoAmount, deleteAuto } = useSavingsMutations(month, { silent: true });
  const [formError, setFormError] = useState<string | null>(null);
  const pending = setAutoAmount.isPending || deleteAuto.isPending;
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors },
  } = useForm<AutoAmountInput, unknown, z.output<typeof autoAmountSchema>>({
    resolver: amountResolver,
    defaultValues: { month, amount: rule.amount, scope: 'MONTH' },
  });
  const amount = useWatch({ control, name: 'amount' });
  const scope = useWatch({ control, name: 'scope' });

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    try {
      await setAutoAmount.mutateAsync({ id: rule.id, data });
      toast.success(t('savings.auto.amountChanged'));
      onDone();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['amount', 'scope']));
    }
  });
  const stop = () =>
    deleteAuto.mutate(rule.id, {
      onSuccess: () => {
        toast.success(t('savings.auto.stopped'));
        onDone();
      },
      onError: (error) => setFormError(errorMessage(error)),
    });

  return (
    <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
      <DialogBody className="grid gap-4">
        <FormError message={formError} />
        <p className="text-sm text-muted-foreground">
          {t(
            rule.type === 'WITHDRAWAL'
              ? 'savings.auto.withdrawalSchedule'
              : 'savings.auto.depositSchedule',
            { day: rule.day, month: formatMonth(rule.startMonth).toLowerCase() },
          )}
          {rule.done && ` · ${t('savings.auto.doneThisMonth')}`}
        </p>
        <FormField
          id="auto-month-amount"
          label={t('savings.auto.monthAmount', {
            month: formatMonth(month).toLowerCase(),
            currency: part.currency,
          })}
          hint={t('savings.auto.monthAmountHint')}
          error={errors.amount?.message}
        >
          <Input
            {...fieldA11y('auto-month-amount', errors.amount?.message, 'hint')}
            {...register('amount')}
            inputMode="decimal"
            className="tabular"
            autoFocus
          />
        </FormField>
        <SegmentedControl
          label={t('savings.auto.scope')}
          value={scope}
          onChange={(value) => setValue('scope', value)}
          options={[
            { value: 'MONTH', label: t('savings.auto.scopeMonth') },
            { value: 'FORWARD', label: t('savings.auto.scopeForward') },
          ]}
        />
        <Button
          type="button"
          variant="ghost"
          className="justify-self-start text-destructive"
          disabled={pending}
          onClick={stop}
        >
          {t('savings.auto.stop')}
        </Button>
      </DialogBody>
      <FormFooter pending={pending} label={t('common.save')} disabled={!amount} />
    </form>
  );
}
