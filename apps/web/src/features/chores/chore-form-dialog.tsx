import { CHORE_AREAS, type ChoreDto, type ChoreMemberDto } from '@homehub/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { FormError } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { DialogBody, DialogClose, DialogFooter } from '@/components/ui/dialog';
import { FormDialog } from '@/components/ui/form-dialog';
import { fieldA11y, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { applyServerErrors } from '@/lib/form-errors';
import { schemaResolver } from '@/lib/form-resolver';
import { localToday, useSaveChore } from './api';
import {
  choreFormSchema,
  choreFormValues,
  EFFORT_VALUES,
  type ChoreFormPayload,
  type ChoreFormValues,
} from './chore-form';
import { AREA_LABELS, EFFORT_LABELS, INTERVAL_PRESETS } from './labels';
import { memberName } from './model';
import { t } from '@/i18n';

const FIELDS = ['title', 'intervalDays', 'dueOn', 'note'] as const;

export function ChoreFormDialog({
  open,
  onOpenChange,
  chore,
  members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chore: ChoreDto | null;
  members: ChoreMemberDto[];
}) {
  const [dirty, setDirty] = useState(false);
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setDirty(false);
        onOpenChange(next);
      }}
      title={chore ? t('chores.form.editTitle') : t('chores.form.newTitle')}
      isDirty={dirty}
    >
      <ChoreForm
        key={chore?.id ?? 'new'}
        chore={chore}
        members={members}
        onDirtyChange={setDirty}
        onDone={() => {
          setDirty(false);
          onOpenChange(false);
        }}
      />
    </FormDialog>
  );
}

function ChoreForm({
  chore,
  members,
  onDirtyChange,
  onDone,
}: {
  chore: ChoreDto | null;
  members: ChoreMemberDto[];
  onDirtyChange: (dirty: boolean) => void;
  onDone: () => void;
}) {
  const save = useSaveChore();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<ChoreFormValues, unknown, ChoreFormPayload>({
    resolver: schemaResolver(choreFormSchema(members.length)),
    defaultValues: choreFormValues(chore, localToday()),
  });
  const interval = useWatch({ control, name: 'interval' });
  const days = register('intervalDays');

  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  const onSubmit = handleSubmit(async (payload) => {
    setFormError(null);
    try {
      await save.mutateAsync(
        chore
          ? { id: chore.id, input: { ...payload, version: chore.version } }
          : { input: payload },
      );
      toast.success(chore ? t('chores.form.saved') : t('chores.form.added'));
      onDone();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, FIELDS));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="grid gap-4">
        <FormError message={formError} />
        <FormField id="chore-title" label={t('chores.form.title')} error={errors.title?.message}>
          <Input
            {...fieldA11y('chore-title', errors.title?.message)}
            {...register('title')}
            placeholder={t('chores.form.titlePlaceholder')}
            autoComplete="off"
            autoFocus
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="chore-area" label={t('chores.form.area')}>
            <NativeSelect id="chore-area" {...register('area')}>
              {CHORE_AREAS.map((area) => (
                <option key={area} value={area}>
                  {AREA_LABELS[area]}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="chore-due" label={t('chores.form.due')} error={errors.dueOn?.message}>
            <Input
              {...fieldA11y('chore-due', errors.dueOn?.message)}
              {...register('dueOn')}
              type="date"
            />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="chore-interval" label={t('chores.form.interval')}>
            <NativeSelect id="chore-interval" {...register('interval')}>
              {INTERVAL_PRESETS.map((preset) => (
                <option key={preset.label} value={preset.value === null ? '' : preset.value}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">{t('chores.form.customInterval')}</option>
            </NativeSelect>
          </FormField>
          {interval === 'custom' && (
            <FormField
              id="chore-days"
              label={t('chores.form.customDays')}
              error={errors.intervalDays?.message}
            >
              <Input
                {...fieldA11y('chore-days', errors.intervalDays?.message)}
                {...days}
                onChange={(e) => {
                  // Digits only: «10 дней» would not be a number of days.
                  e.target.value = e.target.value.replace(/\D/g, '');
                  void days.onChange(e);
                }}
                inputMode="numeric"
                placeholder="10"
              />
            </FormField>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="chore-assignee" label={t('chores.form.assignee')}>
            <NativeSelect id="chore-assignee" {...register('assigneeId')}>
              <option value="">{t('chores.form.anyone')}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {memberName(member)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <fieldset className="grid content-start gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">{t('chores.form.effort')}</legend>
            <Controller
              control={control}
              name="effort"
              render={({ field }) => (
                <SegmentedControl
                  label={t('chores.form.effort')}
                  value={field.value}
                  onChange={field.onChange}
                  options={EFFORT_VALUES.map((value) => ({
                    value,
                    label: EFFORT_LABELS[Number(value)] ?? value,
                  }))}
                />
              )}
            />
          </fieldset>
        </div>
        {members.length > 1 && interval !== '' && (
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              {...register('rotate')}
            />
            <span>
              {t('chores.form.rotate')}
              <span className="block text-xs text-muted-foreground">
                {t('chores.form.rotateHint')}
              </span>
            </span>
          </label>
        )}
        <FormField id="chore-note" label={t('common.note')} error={errors.note?.message}>
          <Input
            {...fieldA11y('chore-note', errors.note?.message)}
            {...register('note')}
            placeholder={t('common.optional')}
            autoComplete="off"
          />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">{t('common.cancel')}</Button>
        </DialogClose>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {chore ? t('common.save') : t('common.add')}
        </Button>
      </DialogFooter>
    </form>
  );
}
