import type { MeDto } from '@homehub/shared';
import { Loader2 } from 'lucide-react';
import { Navigate } from 'react-router';
import { AppShell } from '@/components/layout/app-shell';
import { ErrorState } from '@/components/states/states';
import { usePreferencesSync } from '../settings/use-preferences';
import { useMe } from './use-me';
import { t } from '@/i18n';

export function ProtectedLayout() {
  const { data: me, isPending, error, refetch } = useMe();

  if (isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">{t('auth.loading')}</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (!me) return <Navigate to="/login" replace />;
  return <SignedIn me={me} />;
}

function SignedIn({ me }: { me: MeDto }) {
  usePreferencesSync();
  return (
    <>
      <AppShell me={me} />
    </>
  );
}
