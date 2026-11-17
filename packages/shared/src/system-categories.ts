import type { CategoryKind } from './enums';

export interface SystemCategory {
  key: string;
  name: string;
  kind: CategoryKind;
  color: string;
}

/** Created for every workspace; `key` keeps seeding idempotent if names are edited later. */
export const SYSTEM_CATEGORIES: readonly SystemCategory[] = [
  { key: 'salary', name: 'Зарплата', kind: 'INCOME', color: '#16a34a' },
  { key: 'freelance', name: 'Подработка', kind: 'INCOME', color: '#0d9488' },
  { key: 'gifts-income', name: 'Подарки', kind: 'INCOME', color: '#65a30d' },
  { key: 'interest', name: 'Проценты и кэшбэк', kind: 'INCOME', color: '#0891b2' },
  { key: 'other-income', name: 'Прочие доходы', kind: 'INCOME', color: '#4b5563' },
  { key: 'groceries', name: 'Продукты', kind: 'EXPENSE', color: '#ea580c' },
  { key: 'cafe', name: 'Кафе и рестораны', kind: 'EXPENSE', color: '#d97706' },
  { key: 'housing', name: 'Жилье и ЖКХ', kind: 'EXPENSE', color: '#2563eb' },
  { key: 'transport', name: 'Транспорт', kind: 'EXPENSE', color: '#7c3aed' },
  { key: 'health', name: 'Здоровье', kind: 'EXPENSE', color: '#dc2626' },
  { key: 'shopping', name: 'Покупки', kind: 'EXPENSE', color: '#db2777' },
  { key: 'entertainment', name: 'Развлечения', kind: 'EXPENSE', color: '#9333ea' },
  { key: 'subscriptions', name: 'Подписки и связь', kind: 'EXPENSE', color: '#0284c7' },
  { key: 'education', name: 'Образование', kind: 'EXPENSE', color: '#0f766e' },
  { key: 'travel', name: 'Путешествия', kind: 'EXPENSE', color: '#059669' },
  { key: 'other-expense', name: 'Прочие расходы', kind: 'EXPENSE', color: '#6b7280' },
];

/**
 * Categories of operations that only move money (fund deposits and withdrawals, top-ups,
 * reconciliations): never income or spending of the plan. Created on first use.
 */
export const LEDGER_CATEGORIES: readonly SystemCategory[] = [
  { key: 'savings-in', name: 'Пополнение накоплений', kind: 'INCOME', color: '#10b981' },
  { key: 'savings-out', name: 'Снятие из накоплений', kind: 'EXPENSE', color: '#f59e0b' },
  { key: 'account-in', name: 'Пополнение счета', kind: 'INCOME', color: '#0ea5e9' },
  { key: 'adjustment-in', name: 'Корректировка остатка (+)', kind: 'INCOME', color: '#94a3b8' },
  { key: 'adjustment-out', name: 'Корректировка остатка (−)', kind: 'EXPENSE', color: '#94a3b8' },
];

export type LedgerCategoryKey =
  'savings-in' | 'savings-out' | 'account-in' | 'adjustment-in' | 'adjustment-out';
