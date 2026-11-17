import type { PotDto } from '@homehub/shared';
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSavingsMutations } from './api';
import { t } from '@/i18n';

/** The «…» menu of a fund or portfolio: edit, archive, delete, plus the card's own items. */
export function PotMenu({
  pot,
  month,
  onEdit,
  onDelete,
  children,
}: {
  pot: PotDto;
  month: string;
  onEdit: () => void;
  onDelete: () => void;
  children?: ReactNode;
}) {
  const { updatePot } = useSavingsMutations(month);
  const toggleArchive = () => updatePot.mutate({ id: pot.id, data: { archived: !pot.archived } });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.actionsFor', { name: pot.name })}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {children}
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil /> {t('common.edit')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={toggleArchive}>
          {pot.archived ? <ArchiveRestore /> : <Archive />}
          {pot.archived ? t('common.restore') : t('common.toArchive')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDelete} className="text-destructive">
          <Trash2 /> {t('common.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
