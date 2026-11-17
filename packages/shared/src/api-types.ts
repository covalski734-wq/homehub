import type { AccountType, CategoryKind, TransactionType } from './enums';
import type { SystemOperationKind, SystemOperationParams } from './ledger';

/** Money values travel as decimal strings to avoid floating point rounding. */
export type MoneyString = string;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * An error response: `error` is a code of ERROR_MESSAGES (errors/index.ts) with its `params`;
 * `message` is only the Russian fallback. Field issues carry codes too (validation-issues.ts).
 */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  params?: Record<string, string | number>;
  issues?: {
    path: string;
    code?: string;
    params?: Record<string, string | number>;
    message: string;
  }[];
}

export interface UserDto {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface WorkspaceDto {
  id: string;
  name: string;
}

export interface MeDto {
  demoMode?: boolean;
  user: UserDto;
  workspace: WorkspaceDto;
  /** OWNER — the first member of the household: the access panel («ИИ и доступы») is theirs. */
  role: 'OWNER' | 'MEMBER';
  csrfToken: string;
  sessionExpiresAt: string;
}

export interface AccountDto {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  initialBalance: MoneyString;
  balance: MoneyString;
  archived: boolean;
  transactionCount: number;
  ownerId: string | null;
  color: string | null;
  note: string;
  /** Part of the balance set aside in fund parts kept on this account. */
  reserved: MoneyString;
  /** Balance minus reserved: what can be spent. */
  available: MoneyString;
  createdAt: string;
}

export interface CategoryDto {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  isSystem: boolean;
  /** A category the system created: the client names it in the reader's language until renamed. */
  systemKey: string | null;
}

export interface TransactionDto {
  id: string;
  type: TransactionType;
  amount: MoneyString;
  currency: string;
  toAmount: MoneyString | null;
  toCurrency: string | null;
  description: string;
  occurredAt: string;
  account: { id: string; name: string };
  toAccount: { id: string; name: string } | null;
  category: { id: string; name: string; color: string; systemKey: string | null } | null;
  createdBy: { id: string; name: string | null; email: string };
  payerId: string | null;
  plannerCategory: string | null;
  isAdjustment: boolean;
  /** Made by the system (fund money, reconciliation): rendered from its kind, see ledger.ts. */
  systemKind: SystemOperationKind | null;
  systemParams: SystemOperationParams | null;
  /** Set when the operation is the fact of a planned item. */
  plan: { kind: 'recurring' | 'purchase' | 'income'; id: string; month: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CurrencyTotalsDto {
  currency: string;
  income: MoneyString;
  expense: MoneyString;
  net: MoneyString;
}

export interface CategorySpendingDto {
  categoryId: string;
  name: string;
  systemKey: string | null;
  color: string;
  currency: string;
  amount: MoneyString;
  share: number;
}

export interface DailyPointDto {
  date: string;
  currency: string;
  income: MoneyString;
  expense: MoneyString;
}

export interface MonthlyPointDto {
  month: string;
  currency: string;
  income: MoneyString;
  expense: MoneyString;
}

export interface BalanceDto {
  currency: string;
  total: MoneyString;
}

export interface FinanceSummaryDto {
  month: string;
  totals: CurrencyTotalsDto[];
  balances: BalanceDto[];
  byCategory: CategorySpendingDto[];
  daily: DailyPointDto[];
  trend: MonthlyPointDto[];
}

export interface BudgetDto {
  id: string;
  month: string;
  currency: string;
  limit: MoneyString;
  spent: MoneyString;
  remaining: MoneyString;
  progress: number;
  category: { id: string; name: string; color: string; systemKey: string | null };
}

export interface HealthDto {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  uptimeSeconds: number;
}
