import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogClose, DialogFooter } from '@/components/ui/dialog';
import { t } from '@/i18n';

/** «Отмена» and the submit button with the mutation's pending state. */
export function FormFooter({
  pending,
  label,
  disabled,
}: {
  pending: boolean;
  label: string;
  disabled?: boolean;
}) {
  return (
    <DialogFooter>
      <DialogClose asChild>
        <Button variant="outline">{t('common.cancel')}</Button>
      </DialogClose>
      <Button type="submit" disabled={pending || disabled}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {label}
      </Button>
    </DialogFooter>
  );
}
