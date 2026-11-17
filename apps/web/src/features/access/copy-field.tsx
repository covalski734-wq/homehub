import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { t } from '@/i18n';

/** A read-only value with a copy button; the field stays selectable when the clipboard is denied. */
export function CopyField({ id, value, label }: { id: string; value: string; label?: string }) {
  const copy = () =>
    // Without a secure context there is no clipboard API at all: that rejects too.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(value))
      .then(
        () => toast.success(t('access.copy.done')),
        () => toast.error(t('access.copy.failed')),
      );
  return (
    <div className="flex gap-2">
      <Input
        id={id}
        readOnly
        value={value}
        aria-label={label}
        className="font-mono text-xs"
        onFocus={(e) => e.target.select()}
      />
      <Button type="button" variant="outline" onClick={() => void copy()}>
        <Copy aria-hidden /> {t('access.copy.button')}
      </Button>
    </div>
  );
}
