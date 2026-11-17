import {
  personalTokenCreateSchema,
  type AccessTokenDto,
  type PersonalTokenCreatedDto,
  type PersonalTokenCreateInput,
} from '@homehub/shared';
import { KeyRound, Loader2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { ErrorState, FieldError, FormError } from '@/components/states/states';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n';
import { applyServerErrors } from '@/lib/form-errors';
import { schemaResolver } from '@/lib/form-resolver';
import { formatDateTime, formatFullDate } from '@/lib/format';
import { useAccessTokens, useCreatePersonalToken, useRevokeAccessToken } from './api';
import { CopyField } from './copy-field';
import { scopeSummaryTexts } from './labels';
import { ScopeGrid } from './scope-grid';

const EXPIRY_OPTIONS: { value: string; days: PersonalTokenCreateInput['expiresInDays'] }[] = [
  { value: '30', days: 30 },
  { value: '90', days: 90 },
  { value: '365', days: 365 },
  { value: 'never', days: null },
];

const FIELDS = ['name', 'scopes', 'expiresInDays'] as const;

const mcpUrl = () => `${window.location.origin}/api/mcp`;

/** Settings → access for AI: how to connect, the connections, a new personal token. */
export function AccessSettings() {
  return (
    <div className="grid max-w-2xl gap-4">
      <McpCard />
      <ConnectionsCard />
      <CreateTokenCard />
    </div>
  );
}

function McpCard() {
  const id = useId();
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('access.mcp.title')}</CardTitle>
          <CardDescription>{t('access.mcp.description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-url`} className="font-medium">
            {t('access.mcp.address')}
          </label>
          <CopyField id={`${id}-url`} value={mcpUrl()} />
        </div>
        <p className="text-muted-foreground">{t('access.mcp.oauth')}</p>
        <p className="text-muted-foreground">
          {t('access.mcp.token')}{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            Authorization: Bearer &lt;token&gt;
          </code>
        </p>
      </CardContent>
    </Card>
  );
}

function ConnectionsCard() {
  const tokens = useAccessTokens();
  const revoke = useRevokeAccessToken();
  const [revoking, setRevoking] = useState<AccessTokenDto | null>(null);

  const confirmRevoke = () => {
    if (!revoking) return;
    revoke.mutate(revoking.id, {
      onSuccess: () => {
        setRevoking(null);
        toast.success(t('access.list.revoked'));
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('access.list.title')}</CardTitle>
          <CardDescription>{t('access.list.description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {tokens.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : tokens.error ? (
          <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} />
        ) : tokens.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('access.list.empty')}</p>
        ) : (
          <ul className="grid gap-2">
            {tokens.data.map((token) => (
              <ConnectionRow key={token.id} token={token} onRevoke={() => setRevoking(token)} />
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t('access.list.revokeTitle')}
        description={revoking ? t('access.list.revokeDescription', { name: revoking.name }) : ''}
        confirmLabel={t('access.list.revoke')}
        destructive
        pending={revoke.isPending}
        onConfirm={confirmRevoke}
      />
    </Card>
  );
}

function ConnectionRow({ token, onRevoke }: { token: AccessTokenDto; onRevoke: () => void }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
      <div className="grid min-w-0 gap-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <span className="truncate">{token.name}</span>
          <Badge>
            {token.kind === 'personal' ? t('access.list.personal') : t('access.list.app')}
          </Badge>
        </p>
        <ul className="text-sm">
          {scopeSummaryTexts(token.scopes).map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          {[
            t('access.list.created', { date: formatFullDate(token.createdAt.slice(0, 10)) }),
            token.lastUsedAt
              ? t('access.list.lastUsed', { date: formatDateTime(token.lastUsedAt) })
              : t('access.list.neverUsed'),
            token.expiresAt
              ? t('access.list.expires', { date: formatDateTime(token.expiresAt) })
              : t('access.list.noExpiry'),
          ].join(' · ')}
        </p>
        {!token.own && <p className="text-xs text-muted-foreground">{t('access.list.notOwn')}</p>}
      </div>
      {token.own && (
        <Button variant="outline" size="sm" onClick={onRevoke}>
          {t('access.list.revoke')}
        </Button>
      )}
    </li>
  );
}

function CreateTokenCard() {
  const id = useId();
  const create = useCreatePersonalToken();
  const [created, setCreated] = useState<PersonalTokenCreatedDto | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    reset,
    control,
    formState: { errors },
  } = useForm<PersonalTokenCreateInput>({
    resolver: schemaResolver(personalTokenCreateSchema),
    defaultValues: { name: '', scopes: [], expiresInDays: 90 },
  });
  const [scopes, expiresInDays] = useWatch({ control, name: ['scopes', 'expiresInDays'] });

  const onSubmit = handleSubmit((input) => {
    setFormError(null);
    create.mutate(input, {
      onSuccess: (result) => {
        setCreated(result);
        reset();
      },
      onError: (error) => setFormError(applyServerErrors(error, setError, FIELDS)),
    });
  });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" aria-hidden /> {t('access.create.title')}
          </CardTitle>
          <CardDescription>{t('access.create.description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {created && (
          <div
            role="status"
            className="grid gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm"
          >
            <label htmlFor={`${id}-secret`} className="font-medium">
              {t('access.create.secretTitle', { name: created.token.name })}
            </label>
            <CopyField id={`${id}-secret`} value={created.secret} />
            <p className="text-xs text-muted-foreground">{t('access.create.secretWarning')}</p>
            <div>
              <Button variant="outline" size="sm" onClick={() => setCreated(null)}>
                {t('access.create.done')}
              </Button>
            </div>
          </div>
        )}
        <form className="grid gap-3" onSubmit={(e) => void onSubmit(e)} noValidate>
          <FormError message={formError} />
          <label className="grid gap-1 text-sm">
            {t('access.create.name')}
            <Input
              maxLength={80}
              placeholder={t('access.create.namePlaceholder')}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${id}-name-error` : undefined}
              {...register('name')}
            />
            <FieldError id={`${id}-name-error`} message={errors.name?.message} />
          </label>
          <fieldset className="grid gap-1 text-sm">
            <legend className="mb-1">{t('access.create.scopes')}</legend>
            <ScopeGrid
              value={scopes}
              describedBy={errors.scopes ? `${id}-scopes-error` : undefined}
              onChange={(next) =>
                setValue('scopes', next, { shouldDirty: true, shouldValidate: !!errors.scopes })
              }
            />
            <FieldError id={`${id}-scopes-error`} message={errors.scopes?.message} />
          </fieldset>
          <label className="grid gap-1 text-sm">
            {t('access.create.expiry')}
            <NativeSelect
              className="max-w-xs"
              value={expiresInDays === null ? 'never' : String(expiresInDays)}
              onChange={(e) =>
                setValue(
                  'expiresInDays',
                  EXPIRY_OPTIONS.find((option) => option.value === e.target.value)?.days ?? null,
                  { shouldDirty: true },
                )
              }
            >
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.days === null
                    ? t('access.create.noExpiry')
                    : t('access.create.days', { count: option.days })}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {t('access.create.submit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
