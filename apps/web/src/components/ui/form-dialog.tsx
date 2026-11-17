import { useState, type ReactNode } from 'react';
import { ConfirmDialog } from './alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';
import { t } from '@/i18n';

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** When true, closing asks for confirmation so edits are not lost by an accidental tap. */
  isDirty: boolean;
  children: ReactNode;
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  isDirty,
  children,
}: FormDialogProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const requestOpenChange = (next: boolean) => {
    if (!next && isDirty) setConfirmDiscard(true);
    else onOpenChange(next);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={requestOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className={description ? undefined : 'sr-only'}>
              {description ?? title}
            </DialogDescription>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t('layout.formDialog.discardTitle')}
        description={t('layout.formDialog.discardDescription')}
        confirmLabel={t('layout.formDialog.discardConfirm')}
        destructive
        onConfirm={() => {
          setConfirmDiscard(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}
