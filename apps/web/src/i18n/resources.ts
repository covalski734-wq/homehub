import ruAccess from './locales/ru/access.json';
import ruAccounts from './locales/ru/accounts.json';
import ruAuth from './locales/ru/auth.json';
import ruBudgets from './locales/ru/budgets.json';
import ruCategories from './locales/ru/categories.json';
import ruChores from './locales/ru/chores.json';
import ruCommon from './locales/ru/common.json';
import ruDashboard from './locales/ru/dashboard.json';
import ruErrors from './locales/ru/errors.json';
import ruHelp from './locales/ru/help.json';
import ruHousehold from './locales/ru/household.json';
import ruLayout from './locales/ru/layout.json';
import ruPlanner from './locales/ru/planner.json';
import ruSavings from './locales/ru/savings.json';
import ruSettings from './locales/ru/settings.json';
import ruShopping from './locales/ru/shopping.json';
import ruSystem from './locales/ru/system.json';
import ruTable from './locales/ru/table.json';
import ruTransactions from './locales/ru/transactions.json';
import ukAccess from './locales/uk/access.json';
import ukAccounts from './locales/uk/accounts.json';
import ukAuth from './locales/uk/auth.json';
import ukBudgets from './locales/uk/budgets.json';
import ukCategories from './locales/uk/categories.json';
import ukChores from './locales/uk/chores.json';
import ukCommon from './locales/uk/common.json';
import ukDashboard from './locales/uk/dashboard.json';
import ukErrors from './locales/uk/errors.json';
import ukHelp from './locales/uk/help.json';
import ukHousehold from './locales/uk/household.json';
import ukLayout from './locales/uk/layout.json';
import ukPlanner from './locales/uk/planner.json';
import ukSavings from './locales/uk/savings.json';
import ukSettings from './locales/uk/settings.json';
import ukShopping from './locales/uk/shopping.json';
import ukSystem from './locales/uk/system.json';
import ukTable from './locales/uk/table.json';
import ukTransactions from './locales/uk/transactions.json';

/**
 * Dictionaries by module: `locales/<language>/<module>.json`, merged into one namespace so a key
 * reads as `<module>.<path>` (`purchases.title`). Russian is the reference: key types come from
 * it, and dictionary.test.ts requires Ukrainian to have exactly the same keys.
 */
export const resources = {
  ru: {
    access: ruAccess,
    accounts: ruAccounts,
    auth: ruAuth,
    budgets: ruBudgets,
    categories: ruCategories,
    chores: ruChores,
    common: ruCommon,
    dashboard: ruDashboard,
    errors: ruErrors,
    help: ruHelp,
    household: ruHousehold,
    layout: ruLayout,
    planner: ruPlanner,
    savings: ruSavings,
    settings: ruSettings,
    shopping: ruShopping,
    system: ruSystem,
    table: ruTable,
    transactions: ruTransactions,
  },
  uk: {
    access: ukAccess,
    accounts: ukAccounts,
    auth: ukAuth,
    budgets: ukBudgets,
    categories: ukCategories,
    chores: ukChores,
    common: ukCommon,
    dashboard: ukDashboard,
    errors: ukErrors,
    help: ukHelp,
    household: ukHousehold,
    layout: ukLayout,
    planner: ukPlanner,
    savings: ukSavings,
    settings: ukSettings,
    shopping: ukShopping,
    system: ukSystem,
    table: ukTable,
    transactions: ukTransactions,
  },
};

export type Dictionary = typeof resources.ru;
