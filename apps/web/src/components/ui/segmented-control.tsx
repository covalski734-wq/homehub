import { useId } from 'react';
import { cn } from '@/lib/utils';

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}

/** Native radio inputs: arrow-key navigation and screen reader semantics come for free. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className="sr-only">{label}</legend>
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted p-1">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'relative flex h-9 cursor-pointer items-center justify-center rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors select-none sm:h-8',
              'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
              value === option.value && 'bg-card text-foreground shadow-xs',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
