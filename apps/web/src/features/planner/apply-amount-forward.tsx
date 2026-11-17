import { ArrowRight } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { formatMoney, formatMonth } from '@/lib/format';
import { t } from '@/i18n';

/** Editing the cell saves this month. Extending that value is an explicit row action. */
export function ApplyAmountForward({
  month,
  name,
  amount,
  currency,
  apply,
}: {
  month: string;
  name: string;
  amount: string;
  currency: string;
  apply: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('planner.applyForward.ariaLabel', { name: name })}
          title={t('planner.applyForward.action')}
        >
          <ArrowRight className="size-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          className="z-50 w-72 max-w-[calc(100vw-2rem)] space-y-3 rounded-xl border bg-popover p-4 text-sm text-popover-foreground shadow-lg"
        >
          <p className="font-medium">
            {name}: {formatMoney(amount, currency)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('planner.applyForward.description', { month: formatMonth(month).toLowerCase() })}
          </p>
          <Button
            size="sm"
            className="h-auto w-full whitespace-normal"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await apply();
                setOpen(false);
                toast.success(t('planner.applyForward.applied'));
              } catch (error) {
                toast.error(errorMessage(error));
              } finally {
                setSaving(false);
              }
            }}
          >
            {t('planner.applyForward.action')}
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
