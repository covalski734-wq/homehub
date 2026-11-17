import { Toaster as Sonner } from 'sonner';
import { useTheme } from '@/providers/theme-provider';

export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme}
      position="top-center"
      closeButton
      toastOptions={{ classNames: { toast: 'border bg-popover text-popover-foreground' } }}
    />
  );
}
