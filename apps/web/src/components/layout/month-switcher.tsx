import { currentMonth } from '@homehub/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useMonth } from '@/hooks/use-month';
import { formatMonth } from '@/lib/format';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';

const MONTH_NAMES = [
  t('layout.monthSwitcher.months.jan'),
  t('layout.monthSwitcher.months.feb'),
  t('layout.monthSwitcher.months.mar'),
  t('layout.monthSwitcher.months.apr'),
  t('layout.monthSwitcher.months.may'),
  t('layout.monthSwitcher.months.jun'),
  t('layout.monthSwitcher.months.jul'),
  t('layout.monthSwitcher.months.aug'),
  t('layout.monthSwitcher.months.sep'),
  t('layout.monthSwitcher.months.oct'),
  t('layout.monthSwitcher.months.nov'),
  t('layout.monthSwitcher.months.dec'),
];

/**
 * Month and year selection shared by every finance page. The choice lives in the URL
 * (?month=YYYY-MM), so it survives reloads and follows navigation between pages.
 */
export function MonthSwitcher() {
  const { month, previous, next, isCurrent, setMonth } = useMonth();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const selectedYear = Number(month.slice(0, 4));
  const selectedMonth = Number(month.slice(5, 7));

  return (
    <div
      className="flex items-center gap-1"
      role="group"
      aria-label={t('layout.monthSwitcher.label')}
    >
      <Button
        variant="outline"
        size="icon-sm"
        onClick={previous}
        aria-label={t('layout.monthSwitcher.previousMonth')}
      >
        <ChevronLeft />
      </Button>
      <Popover.Root
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (value) setYear(selectedYear);
        }}
      >
        <Popover.Trigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="min-w-36 font-medium tabular"
            aria-label={t('layout.monthSwitcher.pick', { month: formatMonth(month) })}
          >
            {formatMonth(month)}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="center"
            sideOffset={6}
            className="z-50 w-64 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          >
            <div className="mb-2 flex items-center justify-between">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setYear((y) => y - 1)}
                aria-label={t('layout.monthSwitcher.previousYear')}
              >
                <ChevronLeft />
              </Button>
              <span className="text-sm font-semibold tabular" aria-live="polite">
                {year}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setYear((y) => y + 1)}
                aria-label={t('layout.monthSwitcher.nextYear')}
              >
                <ChevronRight />
              </Button>
            </div>
            <div
              className="grid grid-cols-4 gap-1"
              role="grid"
              aria-label={t('layout.monthSwitcher.monthsOfYear', { year })}
            >
              {MONTH_NAMES.map((name, i) => {
                const value = `${year}-${String(i + 1).padStart(2, '0')}`;
                const selected = year === selectedYear && i + 1 === selectedMonth;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setMonth(value);
                      setOpen(false);
                    }}
                    className={cn(
                      'h-9 rounded-md text-sm capitalize outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      selected && 'bg-primary text-primary-foreground hover:bg-primary/90',
                      value === currentMonth() &&
                        !selected &&
                        'font-semibold text-foreground ring-1 ring-border',
                    )}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
            {!isCurrent && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 w-full"
                onClick={() => {
                  setMonth(currentMonth());
                  setOpen(false);
                }}
              >
                {t('layout.monthSwitcher.currentMonth')}
              </Button>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={next}
        aria-label={t('layout.monthSwitcher.nextMonth')}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
