import type { FundRuleMode, PercentBase } from '@homehub/shared';
import { t } from '@/i18n';

export const MODE_LABELS: Record<FundRuleMode | 'OVERRIDE', string> = {
  FIXED: t('savings.plan.mode.FIXED'),
  PERCENT: t('savings.plan.mode.PERCENT'),
  REMAINDER: t('savings.plan.mode.REMAINDER'),
  OVERRIDE: t('savings.plan.mode.OVERRIDE'),
};

export const BASE_LABELS: Record<PercentBase, string> = {
  NET_INCOME: t('savings.plan.base.NET_INCOME'),
  OWNER_INCOME: t('savings.plan.base.OWNER_INCOME'),
  FREE: t('savings.plan.base.FREE'),
};
