import {
  recurringCategorySchema,
  type ChartId,
  type IncomeKind,
  type PurchaseCategory,
  type PurchaseEventType,
  type PurchasePriority,
  type PurchaseStatus,
  type RecurringCategory,
  type RemainingGroup,
} from '@homehub/shared';
import { t } from '@/i18n';

export const INCOME_KIND_LABELS: Record<IncomeKind, string> = {
  SALARY: t('planner.incomeKind.salary'),
  BUSINESS: t('planner.incomeKind.business'),
  BENEFIT: t('planner.incomeKind.benefit'),
  OTHER: t('common.other'),
};

export const RECURRING_CATEGORY_LABELS: Record<RecurringCategory, string> = {
  HOUSING: t('planner.recurringCategory.housing'),
  UTILITIES: t('planner.recurringCategory.utilities'),
  FOOD: t('planner.recurringCategory.food'),
  SUBSCRIPTIONS: t('planner.recurringCategory.subscriptions'),
  COMMUNICATION: t('planner.recurringCategory.communication'),
  EDUCATION: t('planner.recurringCategory.education'),
  INSTALLMENTS: t('planner.recurringCategory.installments'),
  INSURANCE: t('planner.recurringCategory.insurance'),
  TRANSPORT: t('planner.recurringCategory.transport'),
  HEALTH: t('planner.recurringCategory.health'),
  CHILDREN: t('planner.recurringCategory.children'),
  SERVICES: t('planner.recurringCategory.services'),
  OTHER: t('common.other'),
};

/**
 * Fixed color slot per category (validated categorical palette, see index.css --cat-*).
 * Identity follows the category, never its rank; categories without a slot fold into
 * "Другое" in charts that rely on color.
 */
export const CATEGORY_SLOTS: Partial<Record<RecurringCategory | 'PURCHASES', string>> = {
  HOUSING: 'var(--cat-1)',
  PURCHASES: 'var(--cat-2)',
  UTILITIES: 'var(--cat-3)',
  EDUCATION: 'var(--cat-4)',
  INSURANCE: 'var(--cat-5)',
  FOOD: 'var(--cat-6)',
  SUBSCRIPTIONS: 'var(--cat-7)',
  INSTALLMENTS: 'var(--cat-8)',
};
export const OTHER_COLOR = 'var(--cat-other)';

/** Colour slot of a breakdown key (a regular-expense category or 'PURCHASES'), if it has one. */
export function categorySlot(key: string): string | undefined {
  if (key === 'PURCHASES') return CATEGORY_SLOTS.PURCHASES;
  const category = recurringCategorySchema.safeParse(key);
  return category.success ? CATEGORY_SLOTS[category.data] : undefined;
}

/** Groups of the dashboard «left to pay» card. */
export const REMAINING_GROUP_LABELS: Record<RemainingGroup, string> = {
  required: t('planner.dashboard.remaining.group.required'),
  other: t('planner.dashboard.remaining.group.other'),
  purchases: t('planner.dashboard.remaining.group.purchases'),
};

export const PURCHASE_CATEGORY_LABELS: Record<PurchaseCategory, string> = {
  HOME: t('planner.purchaseCategory.home'),
  ELECTRONICS: t('planner.purchaseCategory.electronics'),
  CLOTHING: t('planner.purchaseCategory.clothing'),
  HEALTH: t('planner.purchaseCategory.health'),
  TRAVEL: t('planner.purchaseCategory.travel'),
  EDUCATION: t('planner.purchaseCategory.education'),
  GIFTS: t('planner.purchaseCategory.gifts'),
  TRANSPORT: t('planner.purchaseCategory.transport'),
  HOBBY: t('planner.purchaseCategory.hobby'),
  OTHER: t('common.other'),
};

export const PRIORITY_LABELS: Record<PurchasePriority, string> = {
  HIGH: t('planner.priority.high'),
  MEDIUM: t('planner.priority.medium'),
  LOW: t('planner.priority.low'),
};

export const STATUS_LABELS: Record<PurchaseStatus, string> = {
  ACTIVE: t('planner.purchaseStatus.active'),
  PURCHASED: t('planner.purchaseStatus.purchased'),
  CANCELLED: t('planner.purchaseStatus.cancelled'),
};

export const EVENT_LABELS: Record<PurchaseEventType, string> = {
  CREATED: t('planner.purchaseEvent.created'),
  UPDATED: t('planner.purchaseEvent.updated'),
  RESCHEDULED: t('planner.purchaseEvent.rescheduled'),
  PURCHASED: t('planner.purchaseEvent.purchased'),
  UNPURCHASED: t('planner.purchaseEvent.unpurchased'),
  CANCELLED: t('planner.purchaseEvent.cancelled'),
  RESTORED: t('planner.purchaseEvent.restored'),
};

export const INTERVAL_OPTIONS = [
  { value: '1', label: t('planner.interval.monthly') },
  { value: '2', label: t('planner.interval.everyTwoMonths') },
  { value: '3', label: t('planner.interval.quarterly') },
  { value: '6', label: t('common.everySixMonths') },
  { value: '12', label: t('planner.interval.yearly') },
];

/** Breakdown key → label: a regular-expense category or all purchases. */
export function categoryLabel(key: string): string {
  if (key === 'PURCHASES') return t('planner.breakdown.purchases');
  const category = recurringCategorySchema.safeParse(key);
  return category.success ? RECURRING_CATEGORY_LABELS[category.data] : key;
}

export const CHART_LABELS: Record<ChartId, string> = {
  trend: t('planner.charts.trend'),
  structure: t('planner.charts.structure'),
  savings: t('common.savings'),
  purchases: t('planner.charts.purchases'),
  balance: t('planner.charts.balance'),
  categories: t('planner.charts.categories'),
};

export const CHART_TYPE_LABELS: Record<string, string> = {
  bar: t('planner.chartType.bar'),
  line: t('planner.chartType.line'),
  area: t('planner.chartType.area'),
  bars: t('planner.chartType.bars'),
  donut: t('planner.chartType.donut'),
  list: t('planner.chartType.list'),
  stacked: t('planner.chartType.stacked'),
};

export const creationOptions = [
  { value: 'FORWARD', label: t('planner.creation.forward') },
  { value: 'MONTH', label: t('planner.creation.month') },
];
