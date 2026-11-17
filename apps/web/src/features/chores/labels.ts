import type { ChoreArea } from '@homehub/shared';
import {
  Bath,
  CookingPot,
  FileText,
  PawPrint,
  Shirt,
  ShoppingCart,
  Sofa,
  Sparkles,
  Sprout,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { t } from '@/i18n';

export const AREA_LABELS: Record<ChoreArea, string> = {
  KITCHEN: t('chores.areas.KITCHEN'),
  BATHROOM: t('chores.areas.BATHROOM'),
  ROOMS: t('chores.areas.ROOMS'),
  LAUNDRY: t('chores.areas.LAUNDRY'),
  SHOPPING: t('chores.areas.SHOPPING'),
  PLANTS: t('chores.areas.PLANTS'),
  PETS: t('chores.areas.PETS'),
  REPAIRS: t('chores.areas.REPAIRS'),
  PAPERWORK: t('chores.areas.PAPERWORK'),
  OTHER: t('common.other'),
};

export const AREA_ICONS: Record<ChoreArea, LucideIcon> = {
  KITCHEN: CookingPot,
  BATHROOM: Bath,
  ROOMS: Sofa,
  LAUNDRY: Shirt,
  SHOPPING: ShoppingCart,
  PLANTS: Sprout,
  PETS: PawPrint,
  REPAIRS: Wrench,
  PAPERWORK: FileText,
  OTHER: Sparkles,
};

/** Common repeat intervals; any other value from 1 to 365 days can be typed in. */
export const INTERVAL_PRESETS: { value: number | null; label: string }[] = [
  { value: null, label: t('chores.intervals.once') },
  { value: 1, label: t('chores.intervals.daily') },
  { value: 2, label: t('chores.intervals.everyOtherDay') },
  { value: 3, label: t('chores.intervals.every3Days') },
  { value: 7, label: t('chores.intervals.weekly') },
  { value: 14, label: t('chores.intervals.every2Weeks') },
  { value: 30, label: t('chores.intervals.monthly') },
  { value: 90, label: t('chores.intervals.every3Months') },
  { value: 180, label: t('common.everySixMonths') },
  { value: 365, label: t('chores.intervals.yearly') },
];

export function intervalLabel(days: number | null): string {
  const preset = INTERVAL_PRESETS.find((p) => p.value === days);
  if (preset) return preset.label;
  return t('chores.intervals.everyNDays', { days });
}

export const EFFORT_LABELS: Record<number, string> = {
  1: t('chores.effort.quick'),
  2: t('chores.effort.medium'),
  3: t('chores.effort.long'),
};

/** Ready-made chores for an empty list: one tap adds a sensible household routine. */
export const STARTER_CHORES: {
  title: string;
  area: ChoreArea;
  intervalDays: number;
  effort: number;
}[] = [
  { title: t('chores.starter.trash'), area: 'KITCHEN', intervalDays: 2, effort: 1 },
  {
    title: t('chores.starter.dishes'),
    area: 'KITCHEN',
    intervalDays: 1,
    effort: 1,
  },
  { title: t('chores.starter.stove'), area: 'KITCHEN', intervalDays: 3, effort: 1 },
  { title: t('chores.starter.fridge'), area: 'KITCHEN', intervalDays: 30, effort: 2 },
  { title: t('chores.starter.bathroom'), area: 'BATHROOM', intervalDays: 7, effort: 3 },
  { title: t('chores.starter.towels'), area: 'BATHROOM', intervalDays: 7, effort: 1 },
  { title: t('chores.starter.vacuum'), area: 'ROOMS', intervalDays: 7, effort: 2 },
  { title: t('chores.starter.floors'), area: 'ROOMS', intervalDays: 14, effort: 3 },
  { title: t('chores.starter.bedding'), area: 'LAUNDRY', intervalDays: 14, effort: 2 },
  { title: t('chores.starter.plants'), area: 'PLANTS', intervalDays: 4, effort: 1 },
];
