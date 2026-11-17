import type { Scope, ScopeArea } from '@homehub/shared';
import { t } from '@/i18n';
import { scopeSummary, type AreaAccess } from './model';

export const AREA_LABELS: Record<ScopeArea, string> = {
  finance: t('access.areas.finance'),
  planner: t('access.areas.planner'),
  savings: t('access.areas.savings'),
  household: t('access.areas.household'),
};

export const ACCESS_LABELS: Record<AreaAccess, string> = {
  read: t('access.levels.read'),
  write: t('access.levels.write'),
  readWrite: t('access.levels.readWrite'),
};

/** «Финансы: чтение и изменение» for each area a connection may use. */
export const scopeSummaryTexts = (scopes: readonly Scope[]): string[] =>
  scopeSummary(scopes).map(({ area, access }) =>
    t('access.scopeGrid.summary', { area: AREA_LABELS[area], access: ACCESS_LABELS[access] }),
  );
