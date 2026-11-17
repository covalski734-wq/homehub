import { isDemoSample } from '@/lib/demo';
import type { TransactionDto, TransactionSortField } from '@homehub/shared';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDay, formatFullDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AmountText } from './amount-text';
import { CategoryDot } from './category-dot';
import { transactionSubtitle, transactionTitle } from './transaction-title';
import { t } from '@/i18n';

interface TransactionsTableProps {
  rows: TransactionDto[];
  sortBy: TransactionSortField;
  sortDir: 'asc' | 'desc';
  onSortChange: (field: TransactionSortField, dir: 'asc' | 'desc') => void;
  onEdit: (transaction: TransactionDto) => void;
  onDelete: (transaction: TransactionDto) => void;
  isFetching: boolean;
}

const column = createColumnHelper<TransactionDto>();

function SortIcon({ direction }: { direction: false | 'asc' | 'desc' }) {
  if (direction === 'asc') return <ArrowUp className="size-3.5" aria-hidden />;
  if (direction === 'desc') return <ArrowDown className="size-3.5" aria-hidden />;
  return <ArrowUpDown className="size-3.5 opacity-50" aria-hidden />;
}

function RowActions({
  transaction,
  onEdit,
  onDelete,
}: { transaction: TransactionDto } & Pick<TransactionsTableProps, 'onEdit' | 'onDelete'>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.actionsFor', { name: transactionTitle(transaction) })}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={isDemoSample(transaction)} onSelect={() => onEdit(transaction)}>
          <Pencil /> {t('common.edit')}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={isDemoSample(transaction)}
          onSelect={() => onDelete(transaction)}
        >
          <Trash2 /> {t('common.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Desktop: sortable table. Phone: compact tappable list built from the same row model. */
export function TransactionsTable({
  rows,
  sortBy,
  sortDir,
  onSortChange,
  onEdit,
  onDelete,
  isFetching,
}: TransactionsTableProps) {
  const columns = useMemo(
    () => [
      column.accessor('occurredAt', {
        header: t('common.date'),
        enableSorting: true,
        cell: (info) => (
          <span className="whitespace-nowrap text-muted-foreground tabular">
            {formatDay(info.getValue())}
          </span>
        ),
      }),
      column.display({
        id: 'title',
        header: t('common.operation'),
        cell: ({ row }) => (
          <button
            type="button"
            disabled={isDemoSample(row.original)}
            onClick={() => onEdit(row.original)}
            className="flex min-w-0 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <CategoryDot transaction={row.original} />
            <span className="min-w-0">
              <span className="block truncate font-medium">{transactionTitle(row.original)}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {transactionSubtitle(row.original)}
              </span>
            </span>
          </button>
        ),
      }),
      column.accessor((row) => row.createdBy.name ?? row.createdBy.email, {
        id: 'author',
        header: t('transactions.table.addedBy'),
        enableSorting: false,
        cell: (info) => (
          <span className="text-muted-foreground">{info.getValue().split(' ')[0]}</span>
        ),
      }),
      column.accessor('amount', {
        header: t('common.amount'),
        enableSorting: true,
        cell: ({ row }) => <AmountText transaction={row.original} />,
      }),
      column.display({
        id: 'actions',
        header: () => <span className="sr-only">{t('common.actions')}</span>,
        cell: ({ row }) => (
          <RowActions transaction={row.original} onEdit={onEdit} onDelete={onDelete} />
        ),
      }),
    ],
    [onEdit, onDelete],
  );

  const sorting: SortingState = [{ id: sortBy, desc: sortDir === 'desc' }];
  // The project does not use React Compiler, so TanStack Table's non-memoizable API is fine here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    manualSorting: true,
    manualPagination: true,
    enableSortingRemoval: false,
    enableMultiSort: false,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      const first = next[0];
      if (first && (first.id === 'occurredAt' || first.id === 'amount')) {
        onSortChange(first.id, first.desc ? 'desc' : 'asc');
      }
    },
  });

  return (
    <div className={cn('transition-opacity', isFetching && 'opacity-60')} aria-busy={isFetching}>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const alignRight = header.column.id === 'amount';
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        alignRight && 'text-right',
                        header.column.id === 'actions' && 'w-12',
                      )}
                      aria-sort={
                        sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined
                      }
                    >
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                            alignRight && 'flex-row-reverse',
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <SortIcon direction={sorted} />
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      cell.column.id === 'amount' && 'text-right',
                      cell.column.id === 'title' && 'max-w-0 w-full',
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="divide-y md:hidden">
        {table.getRowModel().rows.map(({ original: tx }) => (
          <li key={tx.id}>
            <button
              type="button"
              disabled={isDemoSample(tx)}
              onClick={() => onEdit(tx)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none active:bg-muted focus-visible:bg-muted"
              aria-label={t('transactions.table.editRow', {
                title: transactionTitle(tx),
                date: formatFullDate(tx.occurredAt),
              })}
            >
              <CategoryDot transaction={tx} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{transactionTitle(tx)}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {formatDay(tx.occurredAt)} · {transactionSubtitle(tx)}
                </span>
              </span>
              <AmountText transaction={tx} className="text-right text-sm" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
