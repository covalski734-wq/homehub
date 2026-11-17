import { t } from '@/i18n';
import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { API_URL } from '@/lib/api';
import { useMe } from './use-me';
export function LoginPage() {
  const { data: me } = useMe();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const next = params.get('next');
  const target = next && /^\/oauth\/consent\?request=[A-Za-z0-9_-]{20,64}$/.test(next) ? next : '/';
  if (me) return <Navigate to={target} replace />;
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setBusy(true);
          setError('');
          try {
            const res = await fetch(API_URL + '/auth/login', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
            });
            if (!res.ok) {
              setError(res.status === 429 ? t('auth.login.limited') : t('auth.login.invalid'));
              return;
            }
            window.location.replace(target);
          } catch {
            setError(t('auth.login.network'));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="text-xl font-semibold">HomeHub</h1>
        <p className="text-sm text-muted-foreground">{t('auth.login.tagline')}</p>
        <label className="block">
          {t('auth.login.email')}
          <input
            className="mt-1 w-full rounded border bg-background p-2"
            name="email"
            type="email"
            autoComplete="username"
            required
          />
        </label>
        <label className="block">
          {t('auth.login.password')}
          <input
            className="mt-1 w-full rounded border bg-background p-2"
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={256}
            required
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t('auth.login.busy') : t('auth.login.signIn')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('auth.login.privateNotice')}</p>
      </form>
    </main>
  );
}
