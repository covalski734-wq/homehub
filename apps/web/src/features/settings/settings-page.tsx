import type { Language } from '@homehub/shared';
import { Languages, Loader2, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { UserAvatar } from '@/components/layout/user-avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { formatFullDate } from '@/lib/format';
import { useTheme, type ThemePreference } from '@/providers/theme-provider';
import { useLogout, useMe } from '../auth/use-me';
import { AccessSettings } from '../access/access-settings';
import { PlannerSettingsCard } from './planner-settings-card';
import { MembersCard } from '../household/members-card';
import { usePreferences, useUpdatePreferences } from './use-preferences';
import { applyLanguage, language, t } from '@/i18n';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: t('settings.theme.light') },
  { value: 'dark', label: t('settings.theme.dark') },
  { value: 'system', label: t('settings.theme.system') },
];

const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

// Each language is named in itself, so it can be found whatever language is on.
const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'ru', label: 'Русский' },
  { value: 'uk', label: 'Українська' },
];

const COLOR_OPTIONS = [
  { value: 'on', label: t('settings.colors.on') },
  { value: 'off', label: t('settings.colors.off') },
] as const;

const TABS = [
  { value: 'main', label: t('settings.tabs.main') },
  { value: 'access', label: t('settings.tabs.access') },
] as const;
type Tab = (typeof TABS)[number]['value'];

/** Language and status colours: saved per user, so every device opens in the same way. */
function InterfaceCard() {
  const preferences = usePreferences();
  const update = useUpdatePreferences();

  const save = (input: { language?: Language; colorLabels?: boolean }) =>
    update.mutate(input, {
      onSuccess: (saved) => {
        if (input.language) applyLanguage(saved.language);
        else toast.success(t('settings.preferences.saved'));
      },
    });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Languages className="size-4" aria-hidden /> {t('settings.preferences.title')}
          </CardTitle>
          <CardDescription>{t('settings.preferences.description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1.5">
          <p className="text-sm font-medium" aria-hidden>
            {t('settings.preferences.language')}
          </p>
          <SegmentedControl
            label={t('settings.preferences.language')}
            value={preferences.data?.language ?? language()}
            onChange={(next) => save({ language: next })}
            options={LANGUAGE_OPTIONS}
            className="max-w-sm"
          />
        </div>
        <div className="grid gap-1.5">
          <p className="text-sm font-medium" aria-hidden>
            {t('settings.preferences.colorLabels')}
          </p>
          <SegmentedControl
            label={t('settings.preferences.colorLabels')}
            value={preferences.data?.colorLabels === false ? 'off' : 'on'}
            onChange={(next) => save({ colorLabels: next === 'on' })}
            options={COLOR_OPTIONS}
            className="max-w-sm"
          />
          <p className="text-xs text-muted-foreground">
            {t('settings.preferences.colorLabelsHint')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { data: me } = useMe();
  const { theme, setTheme } = useTheme();
  const logout = useLogout();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tabs = TABS;
  const tab: Tab = tabs.find((option) => option.value === params.get('tab'))?.value ?? 'main';
  const ThemeIcon = THEME_ICONS[theme];

  const handleLogout = () =>
    logout.mutate(undefined, { onSettled: () => void navigate('/login', { replace: true }) });

  if (!me) return null;

  return (
    <>
      <PageHeader title={t('common.settings')} />
      <SegmentedControl
        label={t('settings.tabs.label')}
        className="mb-4 max-w-xl"
        value={tab}
        options={tabs}
        onChange={(next) => setParams(next === 'main' ? {} : { tab: next }, { replace: true })}
      />
      {tab === 'access' ? (
        <AccessSettings />
      ) : (
        <div className="grid max-w-2xl gap-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>{t('settings.profile.title')}</CardTitle>
                <CardDescription>{t('settings.profile.description')}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <UserAvatar
                  name={me.user.name}
                  email={me.user.email}
                  src={me.user.avatarUrl}
                  className="size-12 text-base"
                />
                <div className="min-w-0">
                  <p className="truncate font-medium">{me.user.name ?? '—'}</p>
                  <p className="truncate text-sm text-muted-foreground">{me.user.email}</p>
                </div>
              </div>
              <dl className="mt-4 grid gap-2 border-t pt-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t('settings.profile.workspace')}
                  </dt>
                  <dd>{me.workspace.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t('settings.profile.sessionExpires')}
                  </dt>
                  <dd>{formatFullDate(me.sessionExpiresAt.slice(0, 10))}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <InterfaceCard />
          <MembersCard />
          <PlannerSettingsCard />

          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ThemeIcon className="size-4" aria-hidden /> {t('settings.theme.title')}
                </CardTitle>
                <CardDescription>{t('settings.theme.description')}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <SegmentedControl
                label={t('settings.theme.label')}
                value={theme}
                onChange={setTheme}
                options={THEME_OPTIONS}
                className="max-w-sm"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>{t('settings.logout.title')}</CardTitle>
                <CardDescription>{t('settings.logout.description')}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={handleLogout} disabled={logout.isPending}>
                {logout.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut />}
                {t('settings.logout.button')}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
