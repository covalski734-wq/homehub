export const TRANSACTION_TYPES = ['INCOME', 'EXPENSE', 'TRANSFER'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const ACCOUNT_TYPES = ['CASH', 'CARD', 'BANK', 'SAVINGS', 'OTHER'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CATEGORY_KINDS = ['INCOME', 'EXPENSE'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const SUPPORTED_CURRENCIES = [
  'PLN',
  'EUR',
  'USD',
  'CAD',
  'RUB',
  'GBP',
  'KZT',
  'BYN',
  'UAH',
  'GEL',
  'AMD',
  'TRY',
  'AED',
  'CNY',
  'THB',
] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];
