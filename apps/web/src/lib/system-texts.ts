import {
  LEDGER_CATEGORIES,
  SYSTEM_CATEGORIES,
  type NoticeDto,
  type SystemOperationKind,
  type SystemOperationParams,
} from '@homehub/shared';
import { t } from '@/i18n';
import type systemRu from '@/i18n/locales/ru/system.json';

/**
 * Names and texts the server sends as codes, worded in the reader's language: system categories,
 * operations the system made, warnings about the data.
 */

const DEFAULT_NAMES = new Map(
  [...SYSTEM_CATEGORIES, ...LEDGER_CATEGORIES].map((c) => [c.key, c.name] as const),
);
type CategoryKey = keyof (typeof systemRu)['categories'];
const isCategoryKey = (key: string): key is CategoryKey => DEFAULT_NAMES.has(key);

/**
 * A category's name. A system category the household did not rename (its name is still the
 * default one) is named in the reader's language; a renamed or own category keeps its name.
 */
export function categoryName(category: { name: string; systemKey?: string | null } | null): string {
  if (!category) return t('system.noCategory');
  const key = category.systemKey;
  if (key && isCategoryKey(key) && DEFAULT_NAMES.get(key) === category.name)
    return t(`system.categories.${key}`);
  return category.name || t('system.noCategory');
}

/** The text of an operation: the user's note, or what the system made it for. */
export function operationText(operation: {
  description: string;
  systemKind?: SystemOperationKind | null;
  systemParams?: SystemOperationParams | null;
}): string {
  if (operation.description || !operation.systemKind) return operation.description;
  return t(`system.operations.${operation.systemKind}`, {
    fund: '',
    part: '',
    ...operation.systemParams,
  });
}

/** A fund movement's comment; an automatic one without a note says what made it. */
export function movementNote(movement: {
  note: string;
  auto: boolean;
  type: 'DEPOSIT' | 'WITHDRAWAL';
}) {
  if (movement.note || !movement.auto) return movement.note;
  return movement.type === 'DEPOSIT'
    ? t('system.movements.autoDeposit')
    : t('system.movements.autoWithdrawal');
}

export const noticeText = (notice: NoticeDto): string =>
  t(`system.notices.${notice.code}`, { replace: notice.params });

/** An owner's name; the joint owner (no id) has none of its own. */
export const ownerName = (owner: { id?: string | null; ownerId?: string | null; name: string }) =>
  owner.name || t('system.jointOwner');
