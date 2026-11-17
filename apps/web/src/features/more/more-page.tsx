import { ChevronRight } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { NAV_GROUPS } from '@/components/layout/nav-items';
import { PageHeader } from '@/components/layout/page-header';
import { t } from '@/i18n';

/** Phone-only hub: every section by group, so home and work pages are one tap away. */
export default function MorePage() {
  const [params] = useSearchParams();
  const month = params.get('month');
  return (
    <>
      <PageHeader title={t('layout.more.title')} description={t('layout.more.description')} />
      <nav aria-label={t('layout.more.navLabel')} className="space-y-4">
        {NAV_GROUPS.map((group) => (
          <section key={group.title || 'settings'} aria-label={group.title || t('common.settings')}>
            {group.title && (
              <h2 className="mb-1.5 px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {group.title}
              </h2>
            )}
            <ul className="divide-y overflow-hidden rounded-xl border bg-card">
              {group.items.map((item) => (
                <li key={item.to}>
                  <Link
                    to={
                      item.monthAware && month
                        ? { pathname: item.to, search: `?month=${month}` }
                        : item.to
                    }
                    className="flex items-center gap-3 px-4 py-3.5 text-sm outline-none hover:bg-muted/40 focus-visible:bg-muted"
                  >
                    <item.icon className="size-5 text-muted-foreground" aria-hidden />
                    <span className="flex-1">{item.label}</span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </>
  );
}
