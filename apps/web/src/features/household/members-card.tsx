import { JOINT_COLOR, MEMBER_COLORS, type MemberDto } from '@homehub/shared';
import { Archive, ArchiveRestore, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useMemberMutations, useMembers } from './api';
import { t } from '@/i18n';

function MemberRow({ member }: { member: MemberDto }) {
  const { update } = useMemberMutations();
  const [name, setName] = useState(member.name);
  const save = (data: Parameters<typeof update.mutate>[0]['data']) =>
    update.mutate({ id: member.id, data });
  return (
    <li className={cn('flex items-center gap-2 py-2', member.archived && 'opacity-60')}>
      <input
        type="color"
        value={member.color}
        aria-label={t('household.members.colorFor', { name: member.name })}
        className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
        onChange={(e) => save({ color: e.target.value })}
      />
      <Input
        value={name}
        aria-label={t('household.members.nameLabel')}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== member.name && save({ name })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="h-9"
      />
      {member.userId && (
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          {t('household.members.hasLogin')}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={
          member.archived
            ? t('household.members.restoreFor', { name: member.name })
            : t('household.members.archiveFor', { name: member.name })
        }
        title={member.archived ? t('common.restore') : t('common.toArchive')}
        onClick={() => save({ archived: !member.archived })}
      >
        {member.archived ? <ArchiveRestore /> : <Archive />}
      </Button>
    </li>
  );
}

/** Who owns money in the household: names and colours used everywhere. */
export function MembersCard() {
  const members = useMembers();
  const { create } = useMemberMutations();
  const [name, setName] = useState('');
  const used = new Set(members.data?.map((m) => m.color));
  const add = () => {
    if (!name.trim()) return;
    create.mutate(
      { name, color: MEMBER_COLORS.find((c) => !used.has(c)) ?? MEMBER_COLORS[0] },
      { onSuccess: () => setName('') },
    );
  };
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4" aria-hidden /> {t('household.members.title')}
          </CardTitle>
          <CardDescription>{t('household.members.description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {members.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <ul className="divide-y">
            {(members.data ?? []).map((m) => (
              <MemberRow key={m.id} member={m} />
            ))}
            <li className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <span
                className="size-9 shrink-0 rounded-md border"
                style={{ backgroundColor: JOINT_COLOR }}
                aria-hidden
              />
              {t('household.members.joint')}
            </li>
          </ul>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('household.members.newName')}
            aria-label={t('household.members.newName')}
            className="h-9"
          />
          <Button type="submit" variant="outline" disabled={!name.trim() || create.isPending}>
            <Plus /> {t('common.add')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
