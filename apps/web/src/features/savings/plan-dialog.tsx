import {
  fundOverrideSchema,
  fundRuleSchema,
  PERCENT_BASES,
  type FundOverrideInput,
  type FundRuleInput,
  type PotDto,
  type SubaccountDto,
} from '@homehub/shared';
import { useState } from 'react';
import { useForm, useWatch, type FieldError } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormError } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { DialogBody } from '@/components/ui/dialog';
import { FormDialog } from '@/components/ui/form-dialog';
import { fieldA11y, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/form-errors';
import { schemaResolver } from '@/lib/form-resolver';
import { formatMonth } from '@/lib/format';
import { useSavingsMutations } from './api';
import { FormFooter } from './form-footer';
import { BASE_LABELS, MODE_LABELS } from './labels';
import { t } from '@/i18n';

export interface PlanDialogState {
  pot: PotDto;
  part: SubaccountDto;
}

const RULE_FIELDS = [
  'mode',
  'amount',
  'percent',
  'percentBase',
  'min',
  'max',
  'priority',
  'startMonth',
  'endMonth',
] as const;

const ruleResolver = schemaResolver(fundRuleSchema);
const overrideResolver = schemaResolver(fundOverrideSchema);

/** The part's monthly plan: a rule from a month on, or one month's amount. */
export function PlanDialog({
  state,
  month,
  onClose,
}: {
  state: PlanDialogState | null;
  month: string;
  onClose: () => void;
}) {
  return (
    <FormDialog
      open={state !== null}
      onOpenChange={(open) => !open && onClose()}
      title={state ? t('savings.plan.title', { fund: state.pot.name, part: state.part.name }) : ''}
      description={t('savings.plan.description')}
      isDirty={false}
    >
      {state && <PlanForm key={state.part.id} part={state.part} month={month} onDone={onClose} />}
    </FormDialog>
  );
}

function MoneyField({
  id,
  label,
  hint,
  error,
  ...input
}: {
  id: string;
  label: string;
  hint?: string;
  error?: FieldError;
} & React.ComponentProps<typeof Input>) {
  return (
    <FormField id={id} label={label} hint={hint} error={error?.message}>
      <Input
        {...fieldA11y(id, error?.message, hint ? 'hint' : undefined)}
        {...input}
        inputMode="decimal"
        autoComplete="off"
        className="tabular"
      />
    </FormField>
  );
}

function PlanForm({
  part,
  month,
  onDone,
}: {
  part: SubaccountDto;
  month: string;
  onDone: () => void;
}) {
  const { setRule, deleteRule, setOverride } = useSavingsMutations(month, { silent: true });
  const rule = part.rule;
  const [scope, setScope] = useState<'rule' | 'month'>(part.overridden ? 'month' : 'rule');
  const [formError, setFormError] = useState<string | null>(null);
  const pending = setRule.isPending || deleteRule.isPending || setOverride.isPending;

  const ruleForm = useForm<FundRuleInput, unknown, z.output<typeof fundRuleSchema>>({
    // Only the fields of the chosen mode are sent (and checked).
    resolver: (values, context, options) =>
      ruleResolver(
        {
          ...values,
          amount: values.mode === 'FIXED' ? values.amount : null,
          percent: values.mode === 'PERCENT' ? values.percent : null,
          percentBase: values.mode === 'PERCENT' ? values.percentBase : null,
        },
        context,
        options,
      ),
    defaultValues: {
      mode: rule?.mode ?? 'FIXED',
      amount: rule?.amount ?? '',
      // "12.50" shows as 12.5.
      percent: rule?.percent ? String(Number(rule.percent)) : '',
      percentBase: rule?.percentBase ?? 'FREE',
      min: rule?.min ?? '',
      max: rule?.max ?? '',
      priority: rule?.priority ?? 0,
      startMonth: rule?.startMonth && rule.startMonth > month ? rule.startMonth : month,
      endMonth: rule?.endMonth ?? '',
    },
  });
  const monthForm = useForm<FundOverrideInput, unknown, z.output<typeof fundOverrideSchema>>({
    // An empty amount is zero for the month; «Сбросить» removes the override.
    resolver: (values, context, options) =>
      overrideResolver({ ...values, amount: values.amount || '0' }, context, options),
    defaultValues: { month, amount: part.overridden ? part.planned : '' },
  });
  const mode = useWatch({ control: ruleForm.control, name: 'mode' });
  const ruleErrors = ruleForm.formState.errors;

  const done = (message: string) => {
    toast.success(message);
    onDone();
  };
  const submitRule = ruleForm.handleSubmit(async (data) => {
    setFormError(null);
    try {
      await setRule.mutateAsync({ id: part.id, data });
      done(t('savings.plan.ruleSaved'));
    } catch (error) {
      setFormError(applyServerErrors(error, ruleForm.setError, RULE_FIELDS));
    }
  });
  const submitMonth = monthForm.handleSubmit(async (data) => {
    setFormError(null);
    try {
      await setOverride.mutateAsync({ id: part.id, data });
      done(t('savings.plan.monthSaved'));
    } catch (error) {
      setFormError(applyServerErrors(error, monthForm.setError, ['amount']));
    }
  });
  const onError = (error: unknown) => setFormError(errorMessage(error));
  const resetOverride = () =>
    setOverride.mutate(
      { id: part.id, data: { month, amount: null } },
      { onSuccess: () => done(t('savings.plan.overrideReset')), onError },
    );
  const removeRule = () =>
    deleteRule.mutate(part.id, { onSuccess: () => done(t('savings.plan.ruleDeleted')), onError });

  return (
    <form
      onSubmit={scope === 'month' ? submitMonth : submitRule}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogBody className="grid gap-4">
        <FormError message={formError} />
        <SegmentedControl
          label={t('savings.plan.scope')}
          value={scope}
          onChange={setScope}
          options={[
            { value: 'rule', label: t('savings.plan.scopeRule') },
            {
              value: 'month',
              label: t('savings.plan.scopeMonth', { month: formatMonth(month).toLowerCase() }),
            },
          ]}
        />
        {scope === 'month' ? (
          <>
            <MoneyField
              id="plan-month-amount"
              label={t('savings.plan.monthAmount', { currency: part.currency })}
              hint={t('savings.plan.monthAmountHint')}
              error={monthForm.formState.errors.amount}
              {...monthForm.register('amount')}
            />
            {part.overridden && (
              <Button type="button" variant="outline" disabled={pending} onClick={resetOverride}>
                {t('savings.plan.resetOverride')}
              </Button>
            )}
          </>
        ) : (
          <>
            <SegmentedControl
              label={t('savings.plan.modeLabel')}
              value={mode}
              onChange={(value) => ruleForm.setValue('mode', value)}
              options={(['FIXED', 'PERCENT', 'REMAINDER'] as const).map((m) => ({
                value: m,
                label: MODE_LABELS[m],
              }))}
            />
            {mode === 'FIXED' && (
              <MoneyField
                id="plan-amount"
                label={t('savings.plan.amount', { currency: part.currency })}
                error={ruleErrors.amount}
                {...ruleForm.register('amount')}
              />
            )}
            {mode === 'PERCENT' && (
              <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
                <FormField
                  id="plan-percent"
                  label={t('savings.plan.mode.PERCENT')}
                  error={ruleErrors.percent?.message}
                >
                  <Input
                    {...fieldA11y('plan-percent', ruleErrors.percent?.message)}
                    {...ruleForm.register('percent')}
                    inputMode="decimal"
                    className="w-24 text-right tabular"
                  />
                </FormField>
                <FormField id="plan-base" label={t('savings.plan.baseLabel')}>
                  <NativeSelect id="plan-base" {...ruleForm.register('percentBase')}>
                    {PERCENT_BASES.map((b) => (
                      <option key={b} value={b}>
                        {BASE_LABELS[b]}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              </div>
            )}
            {mode === 'REMAINDER' && (
              <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                {t('savings.plan.remainderHint')}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <MoneyField
                id="plan-min"
                label={t('savings.plan.min')}
                error={ruleErrors.min}
                {...ruleForm.register('min')}
              />
              <MoneyField
                id="plan-max"
                label={t('savings.plan.max')}
                error={ruleErrors.max}
                {...ruleForm.register('max')}
              />
              <FormField
                id="plan-priority"
                label={t('savings.plan.priority')}
                hint={t('savings.plan.priorityHint')}
                error={ruleErrors.priority?.message}
              >
                <Input
                  {...fieldA11y('plan-priority', ruleErrors.priority?.message, 'hint')}
                  {...ruleForm.register('priority', { setValueAs: (value) => Number(value) || 0 })}
                  inputMode="numeric"
                  className="w-20 tabular"
                />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id="plan-start"
                label={t('savings.plan.startMonth')}
                error={ruleErrors.startMonth?.message}
              >
                <Input
                  {...fieldA11y('plan-start', ruleErrors.startMonth?.message)}
                  {...ruleForm.register('startMonth')}
                  type="month"
                />
              </FormField>
              <FormField
                id="plan-end"
                label={t('savings.plan.endMonth')}
                error={ruleErrors.endMonth?.message}
              >
                <Input
                  {...fieldA11y('plan-end', ruleErrors.endMonth?.message)}
                  {...ruleForm.register('endMonth')}
                  type="month"
                />
              </FormField>
            </div>
            {rule && (
              <Button
                type="button"
                variant="ghost"
                className="justify-self-start text-destructive"
                disabled={pending}
                onClick={removeRule}
              >
                {t('savings.plan.deleteRule')}
              </Button>
            )}
          </>
        )}
      </DialogBody>
      <FormFooter pending={pending} label={t('common.save')} />
    </form>
  );
}
