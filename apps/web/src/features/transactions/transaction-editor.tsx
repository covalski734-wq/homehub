import { todayDate, type TransactionDto } from '@homehub/shared';
import { useCallback, useState } from 'react';
import { Trans } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { useMonth } from '@/hooks/use-month';
import { AmountText } from './amount-text';
import { transactionTitle } from './transaction-title';
import { TransactionFormDialog } from './transaction-form-dialog';
import { useDeleteTransaction } from './use-transactions';
import { t } from '@/i18n';

/** Create/edit dialog plus delete confirmation, shared by every page that lists operations. */
export function useTransactionEditor() {
  const { month, isCurrent } = useMonth();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TransactionDto | null>(null);
  const [deleting, setDeleting] = useState<TransactionDto | null>(null);
  const remove = useDeleteTransaction();

  const openCreate = useCallback(() => {
    setEditing(null);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((transaction: TransactionDto) => {
    setEditing(transaction);
    setFormOpen(true);
  }, []);

  const requestDelete = useCallback((transaction: TransactionDto) => {
    setFormOpen(false);
    setDeleting(transaction);
  }, []);

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => {
        toast.success(t('transactions.toast.deleted'));
        setDeleting(null);
      },
    });
  };

  const dialogs = (
    <>
      <TransactionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        transaction={editing}
        defaultDate={isCurrent ? todayDate() : `${month}-01`}
        onDelete={requestDelete}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('transactions.deleteDialog.title')}
        description={
          deleting && (
            <Trans
              i18nKey="transactions.deleteDialog.description"
              values={{ title: transactionTitle(deleting) }}
              components={{ amount: <AmountText transaction={deleting} /> }}
            />
          )
        }
        confirmLabel={t('common.delete')}
        destructive
        pending={remove.isPending}
        onConfirm={confirmDelete}
      />
    </>
  );

  return { openCreate, openEdit, requestDelete, dialogs };
}
