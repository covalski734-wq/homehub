import { movementUpdateSchema, type MovementDto, type MovementUpdateInput } from '@homehub/shared';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormError } from '@/components/states/states';
import { DialogBody } from '@/components/ui/dialog';
import { FormDialog } from '@/components/ui/form-dialog';
import { fieldA11y, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { applyServerErrors } from '@/lib/form-errors';
import { schemaResolver } from '@/lib/form-resolver';
import { formatMonth } from '@/lib/format';
import { useSavingsMutations } from './api';
import { FormFooter } from './form-footer';
import { t } from '@/i18n';

const resolver = schemaResolver(movementUpdateSchema);

/** Correct a deposit or withdrawal: amount, date (and so its month), comment. */
export function MovementEditDialog({
  movement,
  month,
  onClose,
}: {
  movement: MovementDto | null;
  month: string;
  onClose: () => void;
}) {
  return (
    <FormDialog
      open={movement !== null}
      onOpenChange={(open) => !open && onClose()}
      title={
        movement?.type === 'WITHDRAWAL'
          ? t('savings.editMovement.titleWithdrawal')
          : t('savings.editMovement.titleDeposit')
      }
      description={t('savings.editMovement.description')}
      isDirty={false}
    >
      {movement && (
        <EditForm key={movement.id} movement={movement} month={month} onDone={onClose} />
      )}
    </FormDialog>
  );
}

function EditForm({
  movement,
  month,
  onDone,
}: {
  movement: MovementDto;
  month: string;
  onDone: () => void;
}) {
  const { updateMovement } = useSavingsMutations(month, { silent: true });
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<MovementUpdateInput, unknown, z.output<typeof movementUpdateSchema>>({
    resolver,
    defaultValues: { amount: movement.amount, date: movement.date, note: movement.note },
  });
  const amount = useWatch({ control, name: 'amount' });
  const date = useWatch({ control, name: 'date' }) ?? '';

  const onSubmit = handleSubmit(async (data) => {
    setFormError(null);
    try {
      await updateMovement.mutateAsync({ id: movement.id, data });
      toast.success(
        date.slice(0, 7) === movement.date.slice(0, 7)
          ? t('savings.editMovement.saved')
          : t('savings.editMovement.savedMoved', {
              month: formatMonth(date.slice(0, 7)).toLowerCase(),
            }),
      );
      onDone();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['amount', 'date', 'note']));
    }
  });

  return (
    <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
      <DialogBody className="grid gap-4">
        <FormError message={formError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="edit-amount"
            label={t('common.amountIn', { currency: movement.currency })}
            error={errors.amount?.message}
          >
            <Input
              {...fieldA11y('edit-amount', errors.amount?.message)}
              {...register('amount')}
              inputMode="decimal"
              className="tabular"
              autoFocus
            />
          </FormField>
          <FormField
            id="edit-date"
            label={t('savings.editMovement.date')}
            error={errors.date?.message}
          >
            <Input
              {...fieldA11y('edit-date', errors.date?.message)}
              {...register('date')}
              type="date"
            />
          </FormField>
        </div>
        <FormField id="edit-note" label={t('common.comment')} error={errors.note?.message}>
          <Input
            {...fieldA11y('edit-note', errors.note?.message)}
            {...register('note')}
            autoComplete="off"
          />
        </FormField>
      </DialogBody>
      <FormFooter
        pending={updateMovement.isPending}
        label={t('common.save')}
        disabled={!amount || !date}
      />
    </form>
  );
}
