import type { ReactNode } from 'react';
import { PageHelp } from './page-help';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    // Sticky: the month switcher in the actions stays visible while the page scrolls.
    <header className="sticky top-0 z-30 -mx-4 mb-5 flex flex-col gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:mb-6 sm:flex-row sm:items-end sm:justify-between sm:px-6 lg:-mx-10 lg:px-10">
      <div>
        <div className="flex items-center gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          <PageHelp title={title} />
        </div>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
