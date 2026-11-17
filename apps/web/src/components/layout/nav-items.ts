import {
  TrendingUp,
  PiggyBank,
  CreditCard,
  Ellipsis,
  LayoutGrid,
  ListChecks,
  Repeat,
  Settings,
  ShoppingBag,
  ShoppingCart,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { t } from '@/i18n';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Pages that work with a selected month keep it when navigating. */
  monthAware: boolean;
}

/** Planning is the core of HomeHub; bookkeeping tools stay available as extras. */
export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: t('layout.nav.planning'),
    items: [
      { to: '/', label: t('layout.nav.overview'), icon: LayoutGrid, monthAware: true },
      { to: '/incomes', label: t('common.incomes'), icon: WalletCards, monthAware: true },
      { to: '/recurring', label: t('layout.nav.recurring'), icon: Repeat, monthAware: true },
      { to: '/purchases', label: t('layout.nav.purchases'), icon: ShoppingBag, monthAware: true },
      { to: '/loans', label: t('layout.nav.loans'), icon: CreditCard, monthAware: true },
      { to: '/savings', label: t('common.savings'), icon: PiggyBank, monthAware: true },
      { to: '/scenarios', label: t('layout.nav.scenarios'), icon: TrendingUp, monthAware: true },
    ],
  },
  // Category limits and the operations summary stay off the menu (pages still work by link).
  {
    title: t('layout.nav.home'),
    items: [
      { to: '/shopping', label: t('layout.nav.shopping'), icon: ShoppingCart, monthAware: false },
      { to: '/chores', label: t('layout.nav.chores'), icon: ListChecks, monthAware: false },
    ],
  },
  {
    title: '',
    items: [{ to: '/settings', label: t('common.settings'), icon: Settings, monthAware: false }],
  },
];

const MORE: NavItem = {
  to: '/more',
  label: t('layout.nav.more'),
  icon: Ellipsis,
  monthAware: true,
};

/** Bottom bar on phones for home pages. */
export const MOBILE_ITEMS: NavItem[] = [
  { to: '/', label: t('layout.nav.overview'), icon: LayoutGrid, monthAware: true },
  { to: '/recurring', label: t('common.expenses'), icon: Repeat, monthAware: true },
  { to: '/purchases', label: t('layout.nav.purchases'), icon: ShoppingBag, monthAware: true },
  { to: '/shopping', label: t('layout.nav.shoppingShort'), icon: ShoppingCart, monthAware: false },
  { to: '/chores', label: t('layout.nav.choresShort'), icon: ListChecks, monthAware: false },
  MORE,
];
