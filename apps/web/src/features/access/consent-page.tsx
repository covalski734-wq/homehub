import type { MeDto, OAuthRequestDto, Scope } from '@homehub/shared';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ErrorState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { t } from '@/i18n';
import { errorMessage } from '@/lib/api';
import { errorText } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { useMe } from '../auth/use-me';
import { usePreferencesSync } from '../settings/use-preferences';
import { useOAuthDecision, useOAuthRequest } from './api';
import { normalizeScopes } from './model';
import { ScopeGrid } from './scope-grid';

/** Local sign-in that comes back to this very request (the only `next` the API accepts). */
const signInUrl = (request: string) =>
  `/login?next=${encodeURIComponent(`/oauth/consent?request=${request}`)}`;

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center p-4">{children}</div>;
}

function Spinner() {
  return (
    <Centered>
      <div role="status">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">{t('auth.loading')}</span>
      </div>
    </Centered>
  );
}

/**
 * /oauth/consent?request=…: an MCP client (ChatGPT, claude.ai …) asks for access. Outside the app
 * shell, but only for a signed-in member: without a session the browser goes to Local sign-in,
 * which returns here, not to /login.
 */
export default function ConsentPage() {
  const [params] = useSearchParams();
  const request = params.get('request') ?? '';
  const me = useMe();
  const signedOut = me.isSuccess && !me.data;

  useEffect(() => {
    if (signedOut && request) window.location.assign(signInUrl(request));
  }, [signedOut, request]);

  if (!request) return <Missing />;
  if (me.isPending) return <Spinner />;
  if (me.error)
    return (
      <Centered>
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      </Centered>
    );
  if (!me.data) return <Spinner />;
  return <SignedInConsent me={me.data} request={request} />;
}

function Missing({ message }: { message?: string }) {
  return (
    <Centered>
      <Card className="w-full max-w-md">
        <CardHeader>
          <div>
            <CardTitle>{t('access.consent.failed')}</CardTitle>
            <CardDescription>{message ?? errorText('OAUTH_REQUEST_NOT_FOUND')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Link to="/" className="text-sm underline underline-offset-4">
            {t('access.consent.toHome')}
          </Link>
        </CardContent>
      </Card>
    </Centered>
  );
}

function SignedInConsent({ me, request }: { me: MeDto; request: string }) {
  usePreferencesSync();
  const query = useOAuthRequest(request);
  if (query.isPending) return <Spinner />;
  if (query.error) return <Missing message={errorMessage(query.error)} />;
  return <ConsentForm me={me} request={query.data} />;
}

function ConsentForm({ me, request }: { me: MeDto; request: OAuthRequestDto }) {
  const [scopes, setScopes] = useState<Scope[]>(() => normalizeScopes(request.scopes));
  // After an answer the browser is leaving: the buttons stay locked until it does.
  const [leaving, setLeaving] = useState(false);
  const decide = useOAuthDecision(request.id);
  const busy = decide.isPending || leaving;

  const answer = (approve: boolean) =>
    decide.mutate(
      { approve, scopes: approve ? scopes : [] },
      {
        onSuccess: ({ redirectUrl }) => {
          setLeaving(true);
          window.location.assign(redirectUrl);
        },
      },
    );

  return (
    <Centered>
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div>
            <CardTitle className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
              {t('access.consent.title', {
                client: request.clientName,
                host: request.redirectHost,
              })}
            </CardTitle>
            <CardDescription>{t('access.consent.description')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ScopeGrid value={scopes} onChange={setScopes} disabled={busy} />
          <div className="grid gap-1 text-xs text-muted-foreground">
            <p>
              {t('access.consent.signedInAs', {
                email: me.user.email,
                workspace: me.workspace.name,
              })}
            </p>
            <p>{t('access.consent.expires', { time: formatDateTime(request.expiresAt) })}</p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={busy} onClick={() => answer(false)}>
              {t('access.consent.deny')}
            </Button>
            <Button disabled={busy || scopes.length === 0} onClick={() => answer(true)}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {t('access.consent.approve')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </Centered>
  );
}
