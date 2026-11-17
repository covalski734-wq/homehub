import { isDemoSample } from '@/lib/demo';
import { schemaResolver } from '@/lib/form-resolver';
import {
  budgetUpsertSchema,
  SUPPORTED_CURRENCIES,
  type BudgetDto,
  type BudgetUpsertInput,
  type BudgetUpsertPayload,
  type CategoryDto,
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
import { formatMonth } from '@/lib/format';
import { categoryName } from '@/lib/system-texts';
import { useSaveBudget } from './use-budgets';
import { t } from '@/i18n';

const FIELDS = ['month', 'categoryId', 'currency', 'limit'] as const;

interface BudgetFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  budget: BudgetDto | null;
  categories: CategoryDto[];
  defaultCurrency: string;
}

export function BudgetFormDialog({
  open,
  onOpenChange,
  month,
  budget,
  categories,
  defaultCurrency,
}: BudgetFormDialogProps) {
  const [isDirty, setIsDirty] = useState(false);
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setIsDirty(false);
        onOpenChange(next);
      }}
      title={
        budget
          ? t('budgets.form.editTitle', { category: categoryName(budget.category) })
          : t('budgets.form.newTitle')
      }
      description={formatMonth(month)}
      isDirty={isDirty}
    >
      <BudgetForm
        key={budget?.id ?? `new-${month}`}
        month={month}
        budget={budget}
        categories={categories.filter((c) => c.kind === 'EXPENSE' && !isDemoSample(c))}
        defaultCurrency={defaultCurrency}
        onDone={() => onOpenChange(false)}
        onDirtyChange={setIsDirty}
      />
    </FormDialog>
  );
}

function BudgetForm({
  month,
  budget,
  categories,
  defaultCurrency,
  onDone,
  onDirtyChange,
}: Omit<BudgetFormDialogProps, 'open' | 'onOpenChange'> & {
  onDone: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const save = useSaveBudget();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<BudgetUpsertInput, unknown, BudgetUpsertPayload>({
    resolver: schemaResolver(budgetUpsertSchema),
    defaultValues: {
      month,
      categoryId: budget?.category.id ?? '',
      currency: budget?.currency ?? defaultCurrency,
      limit: budget?.limit ?? '',
    },
  });

  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  const onSubmit = handleSubmit(async (payload) => {
    setFormError(null);
    try {
      await save.mutateAsync(payload);
      toast.success(t('budgets.toast.saved'));
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
        {!budget && (
          <FormField
            id="budget-category"
            label={t('budgets.form.category')}
            error={errors.categoryId?.message}
          >
            <NativeSelect
              {...fieldA11y('budget-category', errors.categoryId?.message)}
              {...register('categoryId')}
            >
              <option value="">{t('budgets.form.chooseCategory')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryName(c)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        )}
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <FormField
            id="budget-limit"
            label={t('budgets.form.limit')}
            error={errors.limit?.message}
          >
            <Input
              {...fieldA11y('budget-limit', errors.limit?.message)}
              {...register('limit')}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              className="tabular"
              autoFocus
            />
          </FormField>
          <FormField
            id="budget-currency"
            label={t('common.currency')}
            error={errors.currency?.message}
          >
            {budget ? (
              <Input id="budget-currency" value={budget.currency} readOnly />
            ) : (
              <NativeSelect
                {...fieldA11y('budget-currency', errors.currency?.message)}
                {...register('currency')}
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">{t('common.cancel')}</Button>
        </DialogClose>
        <Button type="submit" disabled={save.isPending || (Boolean(budget) && !isDirty)}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
