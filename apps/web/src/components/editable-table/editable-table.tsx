import { Check, CircleAlert, Loader2, Plus, Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { isDemoSample } from '@/lib/demo';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import { formatMoney } from '@/lib/format';
import { sumByCurrency } from '@/lib/money';
import { CellInput } from './cell-input';
import { DesktopGrid } from './desktop-grid';
import { MobileCards } from './mobile-cards';
import type { Column, Draft, EditableTableProps, TableView } from './types';
import { useCellSaves } from './use-cell-saves';
import { useDrafts } from './use-drafts';
import { useVisibleRows } from './use-visible-rows';

export type {
  CellEditor,
  Column,
  ColumnKey,
  DraftConfig,
  EditableTableProps,
  MobileSummary,
} from './types';

/**
 * Spreadsheet-like table for planning data:
 * - every editable cell is an input; changes save automatically on Enter / leaving the cell;
 * - Esc restores the saved value; ↑/↓ move between rows, Tab between cells;
 * - "+" adds an empty draft row that is created once its required cells are filled;
 * - deleting shows an "Undo" toast instead of a confirmation dialog;
 * - below the `md` breakpoint rows render as cards with the same editable fields; with
 *   `mobileSummary` a card is one compact line that opens the fields on tap;
 * - columns with `desktop: 'more'` live in a per-row panel instead of widening the grid.
 */
export function EditableTable<Row, Extra extends string = never, DraftKey extends string = string>(
  props: EditableTableProps<Row, Extra, DraftKey>,
) {
  const { rows, columns, getRowId, onCommit, draft, onDelete, deleteLabel } = props;
  const tableRef = useRef<HTMLDivElement>(null);
  const saves = useCellSaves();
  const drafts = useDrafts(draft, columns, tableRef);
  const { visibleRows, sort, toggleSort, search, setSearch } = useVisibleRows(
    rows,
    columns,
    props.searchText,
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const moneyColumns = columns.filter((c) => c.editor === 'money' && c.value);
  const selection =
    props.selection ??
    (moneyColumns.length
      ? {
          selected,
          onChange: (ids: string[], on: boolean) =>
            setSelected((previous) => {
              const next = new Set(previous);
              for (const id of ids) {
                if (on) next.add(id);
                else next.delete(id);
              }
              return next;
            }),
        }
      : undefined);
  const chosen = visibleRows.filter((row) => selected.has(getRowId(row)));
  const selectableProps = { ...props, selection };
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());

  /** Deleting shows an «Undo» toast instead of asking for confirmation. */
  const remove = async (row: Row) => {
    if (isDemoSample(row) || !onDelete) return;
    try {
      const undo = await onDelete(row);
      toast.success(deleteLabel ? deleteLabel(row) : t('table.row.deleted'), {
        action: undo
          ? {
              label: t('table.row.undo'),
              onClick: () => {
                undo().catch((error: unknown) => toast.error(errorMessage(error)));
              },
            }
          : undefined,
      });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const toggle = (row: Row) =>
    setOpenCards((prev) => {
      const next = new Set(prev);
      const id = getRowId(row);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const cell = (row: Row, column: Column<Row, Extra>, rowIndex: number) => {
    const canEdit = column.editor && (column.editable?.(row) ?? true);
    if (!canEdit) {
      return (
        <div
          className={cn(
            'min-w-0 truncate px-2 text-sm',
            column.align === 'right' && 'text-right tabular',
          )}
        >
          <fieldset
            disabled={isDemoSample(row) && !['services', 'deductions'].includes(column.key)}
            className="min-w-0"
          >
            {column.render ? column.render(row) : (column.value?.(row) ?? '')}
          </fieldset>
        </div>
      );
    }
    const key = `${getRowId(row)}:${column.key}`;
    return (
      <CellInput
        column={column}
        row={row}
        rowKey={getRowId(row)}
        rowIndex={rowIndex}
        colIndex={columns.indexOf(column)}
        saved={column.value?.(row) ?? ''}
        status={saves.statuses[key]}
        onSave={(value) => void saves.run(key, () => onCommit(row, column.key, value))}
      />
    );
  };

  const draftCell = (d: Draft, column: Column<Row, Extra>, rowIndex: number) =>
    column.editor ? (
      <CellInput
        column={column}
        row={null}
        rowKey={d.tempId}
        rowIndex={rowIndex}
        colIndex={columns.indexOf(column)}
        saved={d.values[column.key] ?? ''}
        onDraftChange={(value) => drafts.update(d.tempId, column.key, value)}
        draftError={d.errors[column.key] || undefined}
      />
    ) : (
      <div className="px-2 text-sm text-muted-foreground">—</div>
    );

  const view: TableView<Row, Extra> = {
    rows: visibleRows,
    drafts: drafts.drafts,
    cell,
    draftCell,
    rowStatus: (row) => saves.rowStatus(getRowId(row)),
    remove: (row) => void remove(row),
    isOpen: (row) => openCards.has(getRowId(row)),
    toggle,
    submitDraft: (tempId) => void drafts.submit(tempId),
    cancelDraft: drafts.cancel,
  };

  const pending = saves.saving || drafts.saving;

  return (
    <div
      className="min-w-0 overflow-hidden rounded-xl border bg-card"
      style={{ containerType: 'inline-size' }}
      data-editable-table
      ref={tableRef}
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
        {props.searchText && (
          <label className="relative flex min-w-28 flex-1 items-center sm:max-w-64">
            <span className="sr-only">{t('table.search')}</span>
            <Search
              className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground"
              aria-hidden
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('table.search')}
              className="h-9 w-full rounded-md border border-input bg-background pr-2 pl-8 text-sm outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30 max-md:h-10 max-md:text-base"
            />
          </label>
        )}
        {props.toolbar}
        <p
          className={cn(
            'ml-auto flex items-center gap-1.5 text-xs text-muted-foreground',
            // Phones have little room: the idle «saved automatically» note is desktop-only.
            !pending && !saves.failed && 'max-md:sr-only',
          )}
          role="status"
          aria-live="polite"
        >
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> {t('table.autosave.saving')}
            </>
          ) : saves.failed ? (
            <>
              <CircleAlert className="size-3.5 text-destructive" aria-hidden />{' '}
              {t('table.autosave.unsaved')}
            </>
          ) : (
            <>
              <Check className="size-3.5" aria-hidden /> {t('table.autosave.hint')}
            </>
          )}
        </p>
      </div>

      <DesktopGrid table={selectableProps} view={view} sort={sort} onSort={toggleSort} />
      <MobileCards table={selectableProps} view={view} />

      {visibleRows.length === 0 && drafts.drafts.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {props.empty ?? t('table.empty')}
        </div>
      )}

      {!props.selection && chosen.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-3 border-t bg-primary/5 px-3 py-3"
          role="status"
        >
          <span className="text-sm">{t('table.selection.count', { count: chosen.length })}</span>
          {moneyColumns.map((column) => {
            const totals = sumByCurrency(
              chosen.flatMap((row) => {
                const amount = column.value?.(row);
                const currency = column.suffix?.(row) ?? (row as { currency?: string }).currency;
                return amount && currency && /^[A-Z]{3}$/.test(currency)
                  ? [{ amount, currency }]
                  : [];
              }),
            );
            return (
              totals.length > 0 && (
                <span key={column.key} className="text-sm tabular">
                  {column.header}:{' '}
                  <strong>
                    {totals.map((v) => formatMoney(v.amount, v.currency)).join(' + ')}
                  </strong>
                </span>
              )
            );
          })}
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            {t('table.selection.clear')}
          </Button>
        </div>
      )}
      {(draft || props.footer) && (
        <div className="flex flex-wrap items-center gap-3 border-t px-3 py-2">
          {draft && (
            <Button
              variant="ghost"
              size="sm"
              onClick={drafts.add}
              className="text-muted-foreground hover:text-foreground"
            >
              <Plus /> {draft.addLabel}
            </Button>
          )}
          {props.footer && <div className="ml-auto text-sm">{props.footer}</div>}
        </div>
      )}
    </div>
  );
}
