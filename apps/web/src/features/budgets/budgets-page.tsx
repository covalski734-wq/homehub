import { isDemoSample, isDemoCreated } from '@/lib/demo';
import { shiftMonth, type BudgetDto } from '@homehub/shared';
import { Copy, MoreHorizontal, Pencil, PiggyBank, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { MonthSwitcher } from '@/components/layout/month-switcher';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState } from '@/components/states/states';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useMonth } from '@/hooks/use-month';
import { formatMoney, formatMonth, formatPercent } from '@/lib/format';
import { categoryName } from '@/lib/system-texts';
import { cn } from '@/lib/utils';
import { useAccounts } from '../accounts/use-accounts';
import { useCategories } from '../categories/use-categories';
import { BudgetFormDialog } from './budget-form-dialog';
import { useBudgets, useCopyBudgets, useDeleteBudget } from './use-budgets';
import { t } from '@/i18n';

function BudgetRow({
  budget,
  onEdit,
  onDelete,
}: {
  budget: BudgetDto;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const over = budget.progress > 1;
  const warning = !over && budget.progress >= 0.85;
  return (
    <li className="px-4 py-3.5 sm:px-5">
      <div className="flex items-center gap-3">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: budget.category.color }}
          aria-hidden
        />
        <button
          type="button"
          disabled={isDemoSample(budget)}
          onClick={onEdit}
          className="min-w-0 flex-1 truncate rounded-sm text-left text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {categoryName(budget.category)}
          {isDemoCreated(budget) && <span className="ml-2 text-xs">{t('common.demo')}</span>}
        </button>
        <span className="text-sm tabular">
          {formatMoney(budget.spent, budget.currency)}
          <span className="text-muted-foreground">
            {' '}
            / {formatMoney(budget.limit, budget.currency)}
          </span>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={isDemoSample(budget)}
              aria-label={t('common.actionsFor', { name: categoryName(budget.category) })}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> {t('budgets.card.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Progress
        value={budget.progress}
        label={t('budgets.card.progress', {
          category: categoryName(budget.category),
          percent: formatPercent(budget.progress),
        })}
        className="mt-2.5"
        indicatorClassName={cn(over ? 'bg-expense' : warning ? 'bg-amber-500' : 'bg-primary')}
      />
      <p
        className={cn(
          'mt-1.5 flex items-center gap-1 text-xs',
          over ? 'text-expense' : 'text-muted-foreground',
        )}
      >
        {over && <TriangleAlert className="size-3.5" aria-hidden />}
        {over
          ? t('budgets.card.exceeded', {
              amount: formatMoney(budget.remaining.replace('-', ''), budget.currency),
            })
          : t('budgets.card.remaining', {
              amount: formatMoney(budget.remaining, budget.currency),
              percent: formatPercent(budget.progress),
            })}
      </p>
    </li>
  );
}

export default function BudgetsPage() {
  const { month } = useMonth();
  const budgets = useBudgets(month);
  const categories = useCategories();
  const accounts = useAccounts();
  const copy = useCopyBudgets();
  const remove = useDeleteBudget();
  const [dialog, setDialog] = useState<{ open: boolean; budget: BudgetDto | null }>({
    open: false,
    budget: null,
  });
  const [deleting, setDeleting] = useState<BudgetDto | null>(null);
  const previousMonth = shiftMonth(month, -1);
  const defaultCurrency = accounts.data?.find((a) => !a.archived)?.currency ?? 'RUB';

  const openCreate = () => setDialog({ open: true, budget: null });

  const copyPrevious = () =>
    copy.mutate(
      { fromMonth: previousMonth, toMonth: month },
      {
        onSuccess: ({ copied }) => {
          if (copied === 0)
            toast.info(
              t('budgets.toast.nothingToCopy', { month: formatMonth(previousMonth).toLowerCase() }),
            );
          else toast.success(t('budgets.toast.copied', { copied }));
        },
      },
    );

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => {
        toast.success(t('budgets.toast.deleted'));
        setDeleting(null);
      },
    });
  };

  let content;
  if (budgets.isPending) {
    content = (
      <Card className="space-y-4 p-5" role="status" aria-label={t('budgets.page.loading')}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </Card>
    );
  } else if (budgets.isError) {
    content = (
      <Card>
        <ErrorState error={budgets.error} onRetry={() => void budgets.refetch()} />
      </Card>
    );
  } else if (budgets.data.length === 0) {
    content = (
      <Card>
        <EmptyState
          icon={<PiggyBank />}
          title={t('budgets.empty.title')}
          description={t('budgets.empty.description')}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={openCreate}>
                <Plus /> {t('budgets.empty.add')}
              </Button>
              <Button variant="outline" onClick={copyPrevious} disabled={copy.isPending}>
                <Copy />{' '}
                {t('budgets.empty.copyFrom', { month: formatMonth(previousMonth).toLowerCase() })}
              </Button>
            </div>
          }
        />
      </Card>
    );
  } else {
    content = (
      <Card className={cn('transition-opacity', budgets.isPlaceholderData && 'opacity-60')}>
        <ul className="divide-y">
          {budgets.data.map((budget) => (
            <BudgetRow
              key={budget.id}
              budget={budget}
              onEdit={() => setDialog({ open: true, budget })}
              onDelete={() => setDeleting(budget)}
            />
          ))}
        </ul>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title={t('budgets.page.title')}
        description={t('budgets.page.description')}
        actions={
          <>
            <MonthSwitcher />
            <Button onClick={openCreate} className="ml-auto sm:ml-0">
              <Plus /> {t('budgets.page.add')}
            </Button>
          </>
        }
      />
      {content}
      {categories.data && (
        <BudgetFormDialog
          open={dialog.open}
          onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
          month={month}
          budget={dialog.budget}
          categories={categories.data}
          defaultCurrency={defaultCurrency}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('budgets.deleteDialog.title')}
        description={
          deleting
            ? t('budgets.deleteDialog.description', {
                category: categoryName(deleting.category),
                month: formatMonth(month).toLowerCase(),
              })
            : ''
        }
        confirmLabel={t('common.delete')}
        destructive
        pending={remove.isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}
