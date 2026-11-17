import { ChevronDown, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isDemoCreated, isDemoSample } from '@/lib/demo';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import { RowStatus } from './cell-input';
import type { EditableTableProps, TableView } from './types';

/**
 * Below the `md` breakpoint every row is a card with the same editable fields; with
 * `mobileSummary` a card is one compact line that opens the fields on tap.
 */
export function MobileCards<Row, Extra extends string, DraftKey extends string>({
  table,
  view,
}: {
  table: EditableTableProps<Row, Extra, DraftKey>;
  view: TableView<Row, Extra>;
}) {
  const {
    label,
    columns,
    getRowId,
    onDelete,
    rowActions,
    rowActionsReadOnly = false,
    expanded,
    mobileSummary,
    rowClassName,
  } = table;
  const editableColumns = columns.filter((c) => c.mobile !== 'hidden');
  const title = editableColumns.find((c) => c.mobile === 'title');
  const amount = editableColumns.find((c) => c.mobile === 'amount');

  return (
    <ul className="divide-y md:hidden" aria-label={label}>
      {view.rows.map((row, rowIndex) => {
        const selection = table.selection && (
          <input
            type="checkbox"
            className="size-4 shrink-0 accent-primary"
            aria-label={t('table.selectRow')}
            checked={table.selection.selected.has(getRowId(row))}
            onChange={(e) => table.selection?.onChange([getRowId(row)], e.target.checked)}
          />
        );
        const cardOpen = view.isOpen(row);
        // A compact card opens straight into every field: there is no second «more» step.
        const more = mobileSummary ? [] : editableColumns.filter((c) => c.mobile === 'more');
        const details = editableColumns.filter(
          (c) =>
            c.mobile === 'detail' ||
            c.mobile === undefined ||
            ((cardOpen || mobileSummary) && c.mobile === 'more'),
        );
        const status = isDemoCreated(row) ? (
          <span className="text-[10px] font-medium text-amber-700" title={t('table.demoCreated')}>
            {t('common.demo')}
          </span>
        ) : (
          <RowStatus status={view.rowStatus(row)} />
        );
        if (mobileSummary && !cardOpen) {
          const titleText = title?.value?.(row) ?? title?.render?.(row);
          return (
            <li
              key={getRowId(row)}
              className={cn('flex min-h-14 items-center gap-2 px-3 py-1.5', rowClassName?.(row))}
            >
              {selection}
              {mobileSummary.leading && (
                <fieldset disabled={isDemoSample(row)} className="flex shrink-0 items-center">
                  {mobileSummary.leading(row)}
                </fieldset>
              )}
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                aria-expanded={false}
                aria-label={t('table.card.open', { name: String(titleText ?? '') })}
                onClick={() => view.toggle(row)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{titleText}</span>
                  {mobileSummary.subtitle && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {mobileSummary.subtitle(row)}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right text-sm font-semibold tabular">
                  {mobileSummary.amount(row)}
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
              {view.rowStatus(row) || isDemoCreated(row) ? status : null}
            </li>
          );
        }
        return (
          <li key={getRowId(row)} className={cn('space-y-2 px-3 py-3', rowClassName?.(row))}>
            {mobileSummary && (
              <button
                type="button"
                className="-mx-1 flex w-[calc(100%+0.5rem)] items-center justify-between rounded-md px-1 text-xs text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                aria-expanded
                onClick={() => view.toggle(row)}
              >
                {t('table.card.editing')}
                <span className="inline-flex items-center gap-1">
                  {t('common.collapse')} <ChevronDown className="size-4 rotate-180" aria-hidden />
                </span>
              </button>
            )}
            <div className="flex items-start gap-2">
              {selection}
              <div className="min-w-0 flex-1">{title && view.cell(row, title, rowIndex)}</div>
              {amount && <div className="w-36 shrink-0">{view.cell(row, amount, rowIndex)}</div>}
              <div className="flex items-center pt-2">
                <span>{status}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {details.map((column) => (
                <label key={column.key} className="grid gap-0.5">
                  <span className="px-0.5 text-[11px] text-muted-foreground">{column.header}</span>
                  {view.cell(row, column, rowIndex)}
                </label>
              ))}
            </div>
            {(rowActions || onDelete || more.length > 0) && (
              <div className="flex flex-wrap items-center justify-end gap-1">
                {more.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mr-auto text-muted-foreground"
                    aria-expanded={cardOpen}
                    onClick={() => view.toggle(row)}
                  >
                    {cardOpen ? t('common.collapse') : t('table.card.more')}
                  </Button>
                )}
                <fieldset disabled={isDemoSample(row) && !rowActionsReadOnly} className="contents">
                  {rowActions?.(row)}
                </fieldset>
                {onDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isDemoSample(row)}
                    onClick={() => view.remove(row)}
                  >
                    <Trash2 /> {t('common.delete')}
                  </Button>
                )}
              </div>
            )}
            <fieldset disabled={isDemoSample(row)} className="min-w-0">
              {expanded?.(row)}
            </fieldset>
          </li>
        );
      })}
      {view.drafts.map((d, i) => (
        <li
          key={d.tempId}
          data-draft={d.tempId}
          className="space-y-2 bg-accent/40 px-3 py-3"
          onBlur={(e) => {
            if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)))
              view.submitDraft(d.tempId);
          }}
        >
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {editableColumns
              .filter((c) => c.editor)
              .map((column) => (
                <label
                  key={column.key}
                  className={cn('grid gap-0.5', column.mobile === 'title' && 'col-span-2')}
                >
                  <span className="px-0.5 text-[11px] text-muted-foreground">{column.header}</span>
                  {view.draftCell(d, column, view.rows.length + i)}
                </label>
              ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => view.cancelDraft(d.tempId)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => view.submitDraft(d.tempId)}
              disabled={d.status?.state === 'saving'}
            >
              {d.status?.state === 'saving' && <Loader2 className="animate-spin" aria-hidden />}{' '}
              {t('common.save')}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
