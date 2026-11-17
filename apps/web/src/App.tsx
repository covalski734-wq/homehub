import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { createBrowserRouter, Link, RouterProvider } from 'react-router';
import { EmptyState } from '@/components/states/states';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { LoginPage } from '@/features/auth/login-page';
import { ProtectedLayout } from '@/features/auth/protected-layout';
import { createQueryClient } from '@/lib/query-client';
import { ThemeProvider } from '@/providers/theme-provider';
import { t } from '@/i18n';

const PlannerDashboardPage = lazy(
  () => import('@/features/planner/dashboard/planner-dashboard-page'),
);
const IncomesPage = lazy(() => import('@/features/planner/incomes-page'));
const RecurringPage = lazy(() => import('@/features/planner/recurring-page'));
const PurchasesPage = lazy(() => import('@/features/planner/purchases-page'));
const LoansPage = lazy(() => import('@/features/planner/loans-page'));
const SavingsPage = lazy(() => import('@/features/savings/savings-page'));
const ScenariosPage = lazy(() => import('@/features/household/scenarios-page'));
const MorePage = lazy(() => import('@/features/more/more-page'));
const DashboardPage = lazy(() => import('@/features/dashboard/dashboard-page'));
const TransactionsPage = lazy(() => import('@/features/transactions/transactions-page'));
const AccountsPage = lazy(() => import('@/features/accounts/accounts-page'));
const BudgetsPage = lazy(() => import('@/features/budgets/budgets-page'));
const SettingsPage = lazy(() => import('@/features/settings/settings-page'));
const ChoresPage = lazy(() => import('@/features/chores/chores-page'));
const ShoppingPage = lazy(() => import('@/features/shopping/shopping-page'));
const ConsentPage = lazy(() => import('@/features/access/consent-page'));

function PageFallback() {
  return (
    <div className="space-y-4" role="status" aria-label={t('layout.app.pageLoading')}>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

const page = (element: ReactNode) => <Suspense fallback={<PageFallback />}>{element}</Suspense>;

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  // Outside the shell: an MCP client's consent request, signed in locally (see the page).
  { path: '/oauth/consent', element: page(<ConsentPage />) },
  {
    element: <ProtectedLayout />,
    children: [
      { index: true, element: page(<PlannerDashboardPage />) },
      { path: 'incomes', element: page(<IncomesPage />) },
      { path: 'recurring', element: page(<RecurringPage />) },
      { path: 'purchases', element: page(<PurchasesPage />) },
      { path: 'loans', element: page(<LoansPage />) },
      { path: 'savings', element: page(<SavingsPage />) },
      { path: 'scenarios', element: page(<ScenariosPage />) },
      { path: 'ledger', element: page(<DashboardPage />) },
      { path: 'more', element: page(<MorePage />) },
      { path: 'finances', element: page(<TransactionsPage />) },
      { path: 'accounts', element: page(<AccountsPage />) },
      { path: 'budgets', element: page(<BudgetsPage />) },
      { path: 'settings', element: page(<SettingsPage />) },
      { path: 'chores', element: page(<ChoresPage />) },
      { path: 'shopping', element: page(<ShoppingPage />) },
      {
        path: '*',
        element: (
          <EmptyState
            title={t('layout.app.notFound')}
            action={
              <Link to="/" className="text-sm underline underline-offset-4">
                {t('layout.app.toHome')}
              </Link>
            }
          />
        ),
      },
    ],
  },
]);

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
