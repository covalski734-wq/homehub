import { ArrowDown, ArrowUp, ArrowUpDown, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { isDemoCreated, isDemoSample } from '@/lib/demo';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import { RowStatus } from './cell-input';
import type { Column, EditableTableProps, TableView } from './types';
import type { SortState } from './use-visible-rows';

/** Track list of the grid: [selection] status, the columns, [actions]. */
function gridLayout<Row, Extra extends string>(
  columns: Column<Row, Extra>[],
  hasSelection: boolean,
  hasActions: boolean,
  actionsWidth: string,
) {
  const selectWidth = hasSelection ? '1.75rem ' : '';
  const template = `${selectWidth}1.5rem ${columns.map((c) => c.width ?? 'minmax(7rem, 1fr)').join(' ')} ${hasActions ? actionsWidth : ''}`;
  // One shared minimum width keeps all rows aligned; details use the viewport width below.
  const minTrack = (width: string) => width.match(/^minmax\(\s*([^,]+)/)?.[1] ?? width;
  const minimumWidth =
    (hasSelection ? 'calc(1.75rem + 0.25rem + ' : 'calc(') +
    '1.5rem + 1rem + ' +
    columns.map((c) => minTrack(c.width ?? '7rem')).join(' + ') +
    (hasActions ? ' + ' + actionsWidth : '') +
    ' + ' +
    (columns.length + (hasActions ? 1 : 0)) * 0.25 +
    'rem)';
  return { template, minimumWidth };
}

const panelClass =
  'grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-3 gap-y-2 px-4 md:pl-10 [&_input]:border-input [&_input]:bg-card [&_select]:border-input [&_select]:bg-card';

/** Wide screens: one CSS grid per row, sticky full-width panels for «more» fields and details. */
export function DesktopGrid<Row, Extra extends string, DraftKey extends string>({
  table,
  view,
  sort,
  onSort,
}: {
  table: EditableTableProps<Row, Extra, DraftKey>;
  view: TableView<Row, Extra>;
  sort: SortState;
  onSort: (key: string) => void;
}) {
  const {
    label,
    columns,
    getRowId,
    onDelete,
    deleteLabel,
    rowActions,
    rowActionsReadOnly = false,
    actionsWidth = '4.5rem',
    expanded,
    rowClassName,
    selection,
  } = table;
  const desktopColumns = columns.filter((c) => c.desktop !== false && c.desktop !== 'more');
  const desktopMore = columns.filter((c) => c.desktop === 'more');
  const hasActions = Boolean(onDelete || rowActions || desktopMore.length > 0);
  const { template, minimumWidth } = gridLayout(
    desktopColumns,
    Boolean(selection),
    hasActions,
    actionsWidth,
  );
  const visibleRows = view.rows;

  const sortButton = (column: Column<Row, Extra>) => {
    if (!column.sortValue) return column.header;
    const active = sort?.key === column.key;
    const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
          column.align === 'right' && 'flex-row-reverse',
        )}
        onClick={() => onSort(column.key)}
      >
        {column.header}
        <Icon className={cn('size-3.5', !active && 'opacity-40')} aria-hidden />
      </button>
    );
  };

  return (
    <div
      role="table"
      aria-label={label}
      className="hidden overflow-x-auto md:block"
      data-table-scroll
    >
      <div style={{ minWidth: minimumWidth }}>
        <div
          role="row"
          className="grid items-center gap-1 border-b bg-muted/30 px-2 py-2 text-xs font-medium text-muted-foreground"
          style={{ gridTemplateColumns: template }}
        >
          {selection && (
            <span role="columnheader" className="flex justify-center">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                aria-label={t('table.selectAll', { column: label })}
                checked={
                  visibleRows.length > 0 &&
                  visibleRows.every((r) => selection.selected.has(getRowId(r)))
                }
                onChange={(e) => selection.onChange(visibleRows.map(getRowId), e.target.checked)}
              />
            </span>
          )}
          {/* sr-only text inside a grid item: an sr-only cell itself would leave the grid and shift columns */}
          <span role="columnheader" className="relative">
            <span className="sr-only">{t('common.status')}</span>
          </span>
          {desktopColumns.map((column) => (
            <span
              key={column.key}
              role="columnheader"
              className={cn('px-2 whitespace-nowrap', column.align === 'right' && 'text-right')}
            >
              {sortButton(column)}
            </span>
          ))}
          {hasActions && (
            <span role="columnheader" className="relative">
              <span className="sr-only">{t('common.actions')}</span>
            </span>
          )}
        </div>
        {visibleRows.map((row, rowIndex) => (
          <Fragment key={getRowId(row)}>
            <div
              role="row"
              className={cn(
                'grid items-center gap-1 border-b px-2 py-1 last:border-b-0 hover:bg-muted/20',
                rowClassName?.(row),
              )}
              style={{ gridTemplateColumns: template }}
            >
              {selection && (
                <span role="cell" className="flex justify-center">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    aria-label={t('table.selectRow')}
                    checked={selection.selected.has(getRowId(row))}
                    onChange={(e) => selection.onChange([getRowId(row)], e.target.checked)}
                  />
                </span>
              )}
              <span role="cell" className="flex justify-center">
                {isDemoCreated(row) ? (
                  <span
                    className="text-[9px] font-semibold text-amber-700"
                    title={t('table.demoCreated')}
                  >
                    D
                  </span>
                ) : (
                  <RowStatus status={view.rowStatus(row)} />
                )}
              </span>
              {desktopColumns.map((column) => (
                <div role="cell" key={column.key} className="min-w-0">
                  {view.cell(row, column, rowIndex)}
                </div>
              ))}
              {hasActions && (
                <div role="cell" className="flex items-center justify-end gap-0.5">
                  <fieldset
                    disabled={isDemoSample(row) && !rowActionsReadOnly}
                    className="contents"
                  >
                    {rowActions?.(row)}
                  </fieldset>
                  {desktopMore.length > 0 && (
                    <Button
                      variant={view.isOpen(row) ? 'secondary' : 'ghost'}
                      size="icon-sm"
                      aria-label={t('table.row.moreFields', {
                        fields: desktopMore.map((c) => c.header.toLowerCase()).join(', '),
                      })}
                      title={desktopMore.map((c) => c.header).join(', ')}
                      aria-expanded={view.isOpen(row)}
                      onClick={() => view.toggle(row)}
                    >
                      <SlidersHorizontal className="text-muted-foreground" />
                    </Button>
                  )}
                  {onDelete && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={
                        deleteLabel
                          ? t('table.row.deleteNamed', { name: deleteLabel(row) })
                          : t('table.row.deleteRow')
                      }
                      disabled={isDemoSample(row)}
                      onClick={() => view.remove(row)}
                    >
                      <Trash2 className="text-muted-foreground" />
                    </Button>
                  )}
                </div>
              )}
            </div>
            {desktopMore.length > 0 && view.isOpen(row) && (
              <div
                role="row"
                className="sticky left-0 border-b bg-muted/20"
                style={{ width: '100cqw' }}
              >
                <div
                  role="cell"
                  aria-colspan={desktopColumns.length + 2}
                  className={cn(panelClass, 'py-3')}
                >
                  {desktopMore.map((column) => (
                    <label key={column.key} className="grid min-w-0 gap-0.5">
                      <span className="px-0.5 text-[11px] text-muted-foreground">
                        {column.header}
                      </span>
                      {view.cell(row, column, rowIndex)}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {expanded &&
              (() => {
                const details = expanded(row);
                return details ? (
                  <div
                    role="row"
                    className="sticky left-0"
                    style={{ width: '100cqw' }}
                    data-expanded-row={getRowId(row)}
                  >
                    <div
                      role="cell"
                      aria-colspan={desktopColumns.length + 1 + (hasActions ? 1 : 0)}
                      className="min-w-0"
                    >
                      <fieldset disabled={isDemoSample(row)} className="min-w-0">
                        {details}
                      </fieldset>
                    </div>
                  </div>
                ) : null;
              })()}
          </Fragment>
        ))}
        {view.drafts.map((d, i) => (
          // The wrapper keeps focus moves into the settings panel inside the draft (no early save).
          <div
            key={d.tempId}
            data-draft={d.tempId}
            className="contents"
            onBlur={(e) => {
              if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)))
                view.submitDraft(d.tempId);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') view.submitDraft(d.tempId);
              if (e.key === 'Escape') view.cancelDraft(d.tempId);
            }}
          >
            <div
              role="row"
              className="grid items-center gap-1 border-b bg-accent/40 px-2 py-1"
              style={{ gridTemplateColumns: template }}
            >
              {selection && <span role="cell" />}
              <span role="cell" className="flex justify-center">
                <RowStatus status={d.status} />
              </span>
              {desktopColumns.map((column) => (
                <div role="cell" key={column.key} className="min-w-0">
                  {view.draftCell(d, column, visibleRows.length + i)}
                </div>
              ))}
              {hasActions && (
                <div role="cell" className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('table.row.removeNew')}
                    onClick={() => view.cancelDraft(d.tempId)}
                  >
                    <X />
                  </Button>
                </div>
              )}
            </div>
            {desktopMore.some((c) => c.editor) && (
              <div
                role="row"
                className="sticky left-0 border-b bg-accent/25"
                style={{ width: '100cqw' }}
              >
                <div
                  role="cell"
                  aria-colspan={desktopColumns.length + 2}
                  className={cn(panelClass, 'py-2.5')}
                >
                  {desktopMore
                    .filter((c) => c.editor)
                    .map((column) => (
                      <label key={column.key} className="grid min-w-0 gap-0.5">
                        <span className="px-0.5 text-[11px] text-muted-foreground">
                          {column.header}
                        </span>
                        {view.draftCell(d, column, visibleRows.length + i)}
                      </label>
                    ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
