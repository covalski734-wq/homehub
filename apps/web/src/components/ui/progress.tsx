import { cn } from '@/lib/utils';

interface ProgressProps {
  /** 0..1, values above 1 are drawn as a full bar. */
  value: number;
  label: string;
  className?: string;
  indicatorClassName?: string;
}

export function Progress({ value, label, className, indicatorClassName }: ProgressProps) {
  const percent = Math.max(0, Math.min(100, value * 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className={cn('h-full rounded-full bg-primary transition-[width]', indicatorClassName)}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
