import {
  fieldIssues,
  isValidDate,
  isValidMonth,
  percentSchema,
  plannerMoneySchema,
} from '@homehub/shared';
import type { z } from 'zod';
import { t } from '@/i18n';
import { issueText } from '@/lib/errors';

/** Cell validators reuse the server's Zod schemas, so the browser and the API agree. */
function fromSchema(schema: z.ZodType) {
  return (value: string): string | null => {
    const result = schema.safeParse(value);
    if (result.success) return null;
    const [issue] = fieldIssues(result.error);
    return issue ? issueText(issue) : t('table.validation.invalid');
  };
}

export const validateMoney = fromSchema(plannerMoneySchema);
export const validatePercent = fromSchema(percentSchema);

export function validateRequired(value: string): string | null {
  return value.trim() ? null : t('table.validation.required');
}

export function validateMonth(value: string): string | null {
  return isValidMonth(value) ? null : t('table.validation.month');
}

export function validateOptionalMonth(value: string): string | null {
  return value === '' ? null : validateMonth(value);
}

export function validateDate(value: string): string | null {
  return isValidDate(value) ? null : t('table.validation.date');
}

export function validateDay(value: string): string | null {
  if (value === '') return null;
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? null : t('table.validation.day');
}

/** "3 000,50" → "3000.50" for display-independent server input. */
export function normalizeAmount(value: string): string {
  return value.trim().replace(/\s/g, '').replace(',', '.');
}
