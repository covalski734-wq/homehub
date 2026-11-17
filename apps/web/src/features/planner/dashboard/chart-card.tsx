import { CHART_TYPES, type DashboardLayout } from '@homehub/shared';
import { ArrowDown, ArrowUp, Eye, EyeOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { CHART_LABELS, CHART_TYPE_LABELS } from '../labels';
import { t } from '@/i18n';

/** One chart of the saved dashboard layout (its id, whether it is shown, how it is drawn). */
export type ChartSetting = DashboardLayout['charts'][number];

interface ChartCardProps {
  setting: ChartSetting;
  customizing: boolean;
  isFirst: boolean;
  isLast: boolean;
  onChange: (setting: ChartSetting) => void;
  onMove: (delta: -1 | 1) => void;
  children: ReactNode;
}

export function ChartCard({
  setting,
  customizing,
  isFirst,
  isLast,
  onChange,
  onMove,
  children,
}: ChartCardProps) {
  const types: readonly string[] = CHART_TYPES[setting.id];
  return (
    <Card className={setting.visible ? undefined : 'border-dashed opacity-70'}>
      <CardHeader className="flex-wrap items-center">
        <CardTitle>{CHART_LABELS[setting.id]}</CardTitle>
        <div className="flex flex-wrap items-center gap-1">
          <label className="sr-only" htmlFor={`chart-type-${setting.id}`}>
            {t('planner.dashboard.charts.typeLabel', { chart: CHART_LABELS[setting.id] })}
          </label>
          <NativeSelect
            id={`chart-type-${setting.id}`}
            value={setting.type}
            onChange={(e) => onChange({ ...setting, type: e.target.value })}
            className="h-8 w-32 py-0 text-xs sm:h-8"
          >
            {types.map((type) => (
              <option key={type} value={type}>
                {CHART_TYPE_LABELS[type]}
              </option>
            ))}
          </NativeSelect>
          {customizing && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={isFirst}
                onClick={() => onMove(-1)}
                aria-label={t('planner.dashboard.charts.moveUp', {
                  chart: CHART_LABELS[setting.id],
                })}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={isLast}
                onClick={() => onMove(1)}
                aria-label={t('planner.dashboard.charts.moveDown', {
                  chart: CHART_LABELS[setting.id],
                })}
              >
                <ArrowDown />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-pressed={setting.visible}
                onClick={() => onChange({ ...setting, visible: !setting.visible })}
                aria-label={
                  setting.visible
                    ? t('planner.dashboard.charts.hide', { chart: CHART_LABELS[setting.id] })
                    : t('planner.dashboard.charts.show', { chart: CHART_LABELS[setting.id] })
                }
              >
                {setting.visible ? <Eye /> : <EyeOff />}
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      {setting.visible && <CardContent>{children}</CardContent>}
    </Card>
  );
}
