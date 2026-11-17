import type { MeDto } from '@homehub/shared';
import { House, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useSearchParams } from 'react-router';
import { cn } from '@/lib/utils';
import { MOBILE_ITEMS, NAV_GROUPS, type NavItem } from './nav-items';
import { UserAvatar } from './user-avatar';
import { t } from '@/i18n';

function useNavTarget() {
  const [params] = useSearchParams();
  const month = params.get('month');
  return (item: NavItem) =>
    item.monthAware && month ? { pathname: item.to, search: `?month=${month}` } : item.to;
}

const COLLAPSED_KEY = 'homehub.sidebarCollapsed';

/** The viewer's choice to fold the side menu into icons, remembered on this device. */
function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, prev ? '0' : '1');
      } catch {
        // storage unavailable: the choice lasts until reload
      }
      return !prev;
    });
  return [collapsed, toggle] as const;
}

function Sidebar({
  me,
  collapsed,
  onToggle,
}: {
  me: MeDto;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const target = useNavTarget();
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = collapsed ? t('layout.shell.showMenu') : t('layout.shell.hideMenu');
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-(--sidebar-width) flex-col border-r bg-sidebar md:flex">
      <div className={cn('flex h-14 items-center gap-2.5', collapsed ? 'justify-center' : 'px-5')}>
        {!collapsed && (
          <>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <House className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-tight font-semibold">HomeHub</p>
              <p className="truncate text-xs leading-tight text-muted-foreground">
                {me.workspace.name}
              </p>
            </div>
          </>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          title={toggleLabel}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ToggleIcon className="size-4" aria-hidden />
        </button>
      </div>
      <nav
        aria-label={t('layout.shell.mainNav')}
        className={cn('flex-1 space-y-4 overflow-y-auto py-2', collapsed ? 'px-2' : 'px-3')}
      >
        {NAV_GROUPS.map((group) => (
          <div key={group.title || 'settings'}>
            {group.title && !collapsed && (
              <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
                {group.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={target(item)}
                    end
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-md py-2 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        collapsed ? 'justify-center px-0' : 'px-3',
                        isActive && 'bg-accent text-foreground',
                      )
                    }
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden />
                    <span className={cn(collapsed && 'sr-only')}>{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div
        className={cn(
          'flex items-center gap-3 border-t py-3',
          collapsed ? 'justify-center' : 'px-4',
        )}
      >
        <UserAvatar name={me.user.name} email={me.user.email} src={me.user.avatarUrl} />
        {!collapsed && (
          <div className="min-w-0 text-xs">
            <p className="truncate font-medium">{me.user.name ?? me.user.email}</p>
            <p className="truncate text-muted-foreground">{me.user.email}</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function MobileNav() {
  const target = useNavTarget();
  const items = MOBILE_ITEMS;
  return (
    <nav
      aria-label={t('layout.shell.mainNav')}
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul
        className="grid"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={target(item)}
              end
              className={({ isActive }) =>
                cn(
                  'flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground outline-none focus-visible:bg-accent',
                  isActive && 'text-foreground',
                )
              }
            >
              <item.icon className="size-5" aria-hidden />
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AppShell({ me }: { me: MeDto }) {
  const [collapsed, toggleSidebar] = useSidebarCollapsed();
  return (
    <div
      className={cn(
        'min-h-dvh',
        collapsed ? '[--sidebar-width:3.5rem]' : '[--sidebar-width:15rem]',
      )}
    >
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('layout.shell.skipToContent')}
      </a>
      <Sidebar me={me} collapsed={collapsed} onToggle={toggleSidebar} />
      <main
        id="main"
        tabIndex={-1}
        className="px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-28 outline-none sm:px-6 md:ml-(--sidebar-width) md:pt-8 md:pb-12 lg:px-10"
      >
        <div className={cn('mx-auto', collapsed ? 'max-w-none' : 'max-w-6xl')}>
          {me.demoMode && (
            <div
              role="status"
              className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
            >
              <span>{t('layout.shell.demoBanner')}</span>
              <NavLink to="/settings" className="font-medium underline underline-offset-4">
                {t('common.settings')}
              </NavLink>
            </div>
          )}
          <Outlet />
        </div>
      </main>
      <MobileNav />
    </div>
  );
}
