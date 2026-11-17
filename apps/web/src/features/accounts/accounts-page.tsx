import { isDemoSample, isDemoCreated } from '@/lib/demo';
import type { AccountDto } from '@homehub/shared';
import {
  Archive,
  ArchiveRestore,
  Banknote,
  CreditCard,
  Landmark,
  MoreHorizontal,
  Pencil,
  PiggyBank,
  Plus,
  Scale,
  History,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState } from '@/components/states/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ACCOUNT_TYPE_LABELS } from '../transactions/transaction-labels';
import { AccountFormDialog } from './account-form-dialog';
import { totalsByCurrency } from './model';
import { useAccountTotals, useAccounts, useArchiveAccount } from './use-accounts';
import { OwnerBadge } from '../household/owner';
import { ReconcileDialog } from './reconcile-dialog';
import { TopupDialog } from './topup-dialog';
import { useMembers } from '../household/api';
import { JOINT_COLOR } from '@homehub/shared';
import { Link } from 'react-router';
import { t } from '@/i18n';

const ACCOUNT_ICONS = {
  CARD: CreditCard,
  CASH: Banknote,
  BANK: Landmark,
  SAVINGS: PiggyBank,
  OTHER: Wallet,
} as const;

function CurrencyTotals() {
  const totals = useAccountTotals();
  if (!totals.data?.length) return null;
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-2" aria-label={t('accounts.totals.label')}>
      {totals.data.map((total) => (
        <div key={total.currency}>
          <dt className="text-xs text-muted-foreground">
            {t('accounts.totals.total', { currency: total.currency })}
          </dt>
          <dd className="text-xl font-semibold tabular">
            {formatMoney(total.total, total.currency)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AccountRow({
  account,
  onEdit,
  onReconcile,
  onTopup,
}: {
  account: AccountDto;
  onEdit: (account: AccountDto) => void;
  onReconcile: (account: AccountDto) => void;
  onTopup: (account: AccountDto) => void;
}) {
  const archive = useArchiveAccount();
  const Icon = ACCOUNT_ICONS[account.type];
  const toggleArchive = () =>
    archive.mutate(
      { id: account.id, archived: !account.archived },
      {
        onSuccess: () =>
          toast.success(
            account.archived ? t('accounts.toast.restored') : t('accounts.toast.archived'),
          ),
      },
    );
  const balance = Number(account.balance);

  return (
    <li
      className={cn('flex items-center gap-3 px-4 py-3 sm:px-5', account.archived && 'opacity-60')}
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        style={
          account.color
            ? { backgroundColor: `${account.color}22`, color: account.color }
            : undefined
        }
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <button
        type="button"
        disabled={isDemoSample(account)}
        onClick={() => onEdit(account)}
        className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{account.name}</span>
          {isDemoCreated(account) && <Badge>{t('common.demo')}</Badge>}
          {account.archived && <Badge>{t('common.archive')}</Badge>}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <OwnerBadge ownerId={account.ownerId} />
          <span>
            {t('accounts.list.meta', {
              type: ACCOUNT_TYPE_LABELS[account.type],
              currency: account.currency,
              operations: account.transactionCount,
            })}
          </span>
          {account.note && <span className="truncate">· {account.note}</span>}
        </span>
      </button>
      <span className="text-right">
        <span className={cn('block text-sm font-semibold tabular', balance < 0 && 'text-expense')}>
          {formatMoney(account.balance, account.currency)}
        </span>
        {Number(account.reserved) !== 0 && (
          <span
            className={cn(
              'block text-xs tabular text-muted-foreground',
              Number(account.available) < 0 && 'text-destructive',
            )}
            title={t('accounts.list.reservedInFunds', {
              amount: formatMoney(account.reserved, account.currency),
            })}
          >
            {t('accounts.list.available', {
              amount: formatMoney(account.available, account.currency),
            })}
          </span>
        )}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isDemoSample(account)}
            aria-label={t('common.actionsFor', { name: account.name })}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onEdit(account)}>
            <Pencil /> {t('common.edit')}
          </DropdownMenuItem>
          {!account.archived && (
            <DropdownMenuItem onSelect={() => onTopup(account)}>
              <Plus /> {t('accounts.menu.topUp')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link to={{ pathname: '/finances', search: `?account=${account.id}` }}>
              <History /> {t('accounts.menu.history')}
            </Link>
          </DropdownMenuItem>
          {!account.archived && (
            <DropdownMenuItem onSelect={() => onReconcile(account)}>
              <Scale /> {t('accounts.menu.reconcile')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={toggleArchive} disabled={archive.isPending}>
            {account.archived ? <ArchiveRestore /> : <Archive />}
            {account.archived ? t('common.restore') : t('common.toArchive')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export default function AccountsPage() {
  const accounts = useAccounts();
  const [dialog, setDialog] = useState<{ open: boolean; account: AccountDto | null }>({
    open: false,
    account: null,
  });
  const [reconcile, setReconcile] = useState<AccountDto | null>(null);
  const [topup, setTopup] = useState<AccountDto | null>(null);
  const members = useMembers();
  const openCreate = () => setDialog({ open: true, account: null });
  const openEdit = (account: AccountDto) => setDialog({ open: true, account });

  let content;
  if (accounts.isPending) {
    content = (
      <Card className="space-y-3 p-5" role="status" aria-label={t('accounts.page.loading')}>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </Card>
    );
  } else if (accounts.isError) {
    content = (
      <Card>
        <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
      </Card>
    );
  } else if (accounts.data.length === 0) {
    content = (
      <Card>
        <EmptyState
          icon={<Wallet />}
          title={t('accounts.page.empty.title')}
          description={t('accounts.page.empty.description')}
          action={
            <Button onClick={openCreate}>
              <Plus /> {t('accounts.page.empty.add')}
            </Button>
          }
        />
      </Card>
    );
  } else {
    const active = accounts.data.filter((a) => !a.archived);
    const archived = accounts.data.filter((a) => a.archived);
    const people = (members.data ?? []).filter((m) => active.some((a) => a.ownerId === m.id));
    const groups = [
      ...people.map((m) => ({ id: m.id as string | null, name: m.name, color: m.color })),
      { id: null, name: t('accounts.page.joint'), color: JOINT_COLOR },
    ]
      .map((g) => {
        const own = active.filter((a) =>
          g.id === null ? !people.some((m) => m.id === a.ownerId) : a.ownerId === g.id,
        );
        return { ...g, accounts: own, totals: totalsByCurrency(own) };
      })
      .filter((g) => g.accounts.length > 0);
    content = (
      <div className="space-y-4">
        <CurrencyTotals />
        {/* One table per owner: each member's accounts, then the joint ones. */}
        {groups.map((group) => (
          <Card key={group.id ?? 'joint'} className="overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5 sm:px-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: group.color }}
                  aria-hidden
                />
                {group.name}
              </h2>
              <span className="text-xs text-muted-foreground tabular">
                {group.totals.map((t) => formatMoney(t.sum, t.currency)).join(' · ')}
              </span>
            </div>
            <ul
              className="divide-y"
              aria-label={t('accounts.page.groupLabel', { owner: group.name })}
            >
              {group.accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  onEdit={openEdit}
                  onReconcile={setReconcile}
                  onTopup={setTopup}
                />
              ))}
            </ul>
          </Card>
        ))}
        {archived.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-muted-foreground">{t('common.archive')}</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0 sm:px-0">
              <ul className="divide-y border-t">
                {archived.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    onEdit={openEdit}
                    onReconcile={setReconcile}
                    onTopup={setTopup}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={t('common.accounts')}
        description={t('accounts.page.description')}
        actions={
          <Button onClick={openCreate}>
            <Plus /> {t('accounts.page.new')}
          </Button>
        }
      />
      {content}
      <AccountFormDialog
        open={dialog.open}
        account={dialog.account}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
      <ReconcileDialog account={reconcile} onClose={() => setReconcile(null)} />
      <TopupDialog account={topup} onClose={() => setTopup(null)} />
    </>
  );
}
