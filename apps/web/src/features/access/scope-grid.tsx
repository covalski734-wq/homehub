import { SCOPE_AREAS, type Scope } from '@homehub/shared';
import { t } from '@/i18n';
import { ACCESS_LABELS, AREA_LABELS } from './labels';
import { levelsOf, scopeOf, toggleScope, type ScopeLevel } from './model';

const scopeHeld = (set: ReadonlySet<Scope>, scope: Scope | null) =>
  scope !== null && set.has(scope);

const LEVELS: { value: ScopeLevel; label: string }[] = [
  { value: 'read', label: ACCESS_LABELS.read },
  { value: 'write', label: ACCESS_LABELS.write },
];

/** Area × (read, write) checkboxes, shared by the token form and the consent page. */
export function ScopeGrid({
  value,
  onChange,
  disabled,
  describedBy,
}: {
  value: readonly Scope[];
  onChange: (next: Scope[]) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  const checked = new Set(value);
  return (
    <table className="w-full max-w-md text-sm" aria-describedby={describedBy}>
      <thead>
        <tr className="text-xs text-muted-foreground">
          <th className="py-1 text-left font-normal">{t('access.scopeGrid.area')}</th>
          {LEVELS.map((level) => (
            <th key={level.value} className="w-24 py-1 text-center font-normal">
              {level.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {SCOPE_AREAS.map((area) => (
          <tr key={area} className="border-t">
            <th scope="row" className="py-1.5 text-left font-medium">
              {AREA_LABELS[area]}
            </th>
            {LEVELS.map((level) => (
              <td key={level.value} className="py-1.5 text-center">
                {/* Read-only areas (conversations) have no write level: an empty cell. */}
                {levelsOf(area).includes(level.value) && (
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    aria-label={t('access.scopeGrid.summary', {
                      area: AREA_LABELS[area],
                      access: level.label,
                    })}
                    checked={scopeHeld(checked, scopeOf(area, level.value))}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange(toggleScope(value, area, level.value, e.target.checked))
                    }
                  />
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
