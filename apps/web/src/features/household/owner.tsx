import { JOINT_COLOR, type MemberDto } from '@homehub/shared';
import type { Column } from '@/components/editable-table/editable-table';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { useMembers } from './api';
import { t } from '@/i18n';

export const JOINT_LABEL = () => t('household.owner.joint');

export function memberOf(members: MemberDto[] | undefined, id: string | null | undefined) {
  return id ? members?.find((m) => m.id === id) : undefined;
}

/** Owner as a colour dot and a name; no owner — «Совместный». */
export function OwnerBadge({
  ownerId,
  color,
  className,
  hideJoint = false,
}: {
  ownerId: string | null | undefined;
  /** A record's own colour overrides the member's. */
  color?: string | null;
  className?: string;
  hideJoint?: boolean;
}) {
  const members = useMembers();
  const member = memberOf(members.data, ownerId);
  if (!member && hideJoint) return null;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-xs', className)}>
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color ?? member?.color ?? JOINT_COLOR }}
        aria-hidden
      />
      <span className="truncate">{member?.name ?? JOINT_LABEL()}</span>
    </span>
  );
}

export function ownerOptions(members: MemberDto[] | undefined, current?: string | null) {
  return [
    { value: '', label: JOINT_LABEL() },
    ...(members ?? [])
      .filter((m) => !m.archived || m.id === current)
      .map((m) => ({ value: m.id, label: m.name })),
  ];
}

export function OwnerSelect({
  id,
  value,
  onChange,
  label,
  disabled,
}: {
  id: string;
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
  disabled?: boolean;
}) {
  const members = useMembers();
  return (
    <NativeSelect
      id={id}
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
    >
      {ownerOptions(members.data, value).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}

/** Editable-table column «Владелец» (the value '' means совместный). */
export function ownerColumn<Row extends { ownerId: string | null }>(
  members: MemberDto[] | undefined,
): Column<Row> {
  return {
    key: 'ownerId',
    header: t('common.owner'),
    editor: 'select',
    options: ownerOptions(members),
    value: (r) => r.ownerId ?? '',
    render: (r) => <OwnerBadge ownerId={r.ownerId} />,
    mobile: 'more',
    desktop: 'more',
    width: '9rem',
  };
}
