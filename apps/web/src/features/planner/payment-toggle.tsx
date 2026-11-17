import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';

export function PaymentToggle({
  name,
  paid,
  active,
  onChange,
  compact = false,
}: {
  name: string;
  paid: boolean;
  active: boolean;
  onChange: (paid: boolean) => Promise<unknown>;
  /** Checkbox only, with a finger-sized hit area (collapsed phone rows). */
  compact?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [pendingPaid, setPendingPaid] = useState<boolean | null>(null);
  return (
    <label
      className={cn(
        'inline-flex items-center gap-2 text-xs',
        compact && '-m-1 cursor-pointer p-2.5 has-disabled:cursor-not-allowed',
      )}
    >
      <input
        type="checkbox"
        checked={pendingPaid ?? paid}
        disabled={saving || (!active && !paid)}
        aria-label={t('planner.payment.toggleLabel', { name: name })}
        className={cn('accent-emerald-600', compact ? 'size-5' : 'size-4')}
        onChange={async (event) => {
          const next = event.target.checked;
          setPendingPaid(next);
          setSaving(true);
          try {
            await onChange(next);
          } catch (error) {
            toast.error(errorMessage(error));
          } finally {
            setSaving(false);
            setPendingPaid(null);
          }
        }}
      />
      <span className={cn(compact && 'sr-only')}>
        {saving
          ? t('planner.payment.saving')
          : paid
            ? t('planner.payment.paid')
            : t('planner.payment.unpaid')}
      </span>
    </label>
  );
}
