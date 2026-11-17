import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const fieldClassName =
  'flex h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 sm:h-9 sm:text-sm';

/** text-base on mobile prevents iOS Safari from zooming into focused inputs. */
export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input type={type} data-slot="input" className={cn(fieldClassName, className)} {...props} />
  );
}
