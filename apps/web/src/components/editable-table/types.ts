import type { ReactNode } from 'react';

export type CellEditor = 'text' | 'money' | 'percent' | 'day' | 'select' | 'month' | 'date';

/**
 * A column is a field of the row, or one of the `Extra` names a table declares for computed
 * columns (e.g. «kind» built from two flags). A misspelt key does not compile, and `onCommit`
 * receives the same union, so comparing the key with a typo is a type error too.
 */
export type ColumnKey<Row, Extra extends string = never> = (keyof Row & string) | Extra;

export interface Column<Row, Extra extends string = never> {
  key: ColumnKey<Row, Extra>;
  header: string;
  editor?: CellEditor;
  /** Read-only cell content (used when `editor` is absent or `editable` returns false). */
  render?: (row: Row) => ReactNode;
  value?: (row: Row) => string;
  options?: readonly { value: string; label: string }[];
  /** Status colour of a select by its value (a `tone-*` class; Settings can switch tones off). */
  tone?: (value: string) => string | undefined;
  /** Short text after the input, e.g. the currency of a money cell. */
  suffix?: (row: Row) => string;
  /** Contextual action next to an existing value (not shown in a new draft). */
  afterInput?: (row: Row) => ReactNode;
  editable?: (row: Row) => boolean;
  validate?: (value: string, row: Row | null) => string | null;
  sortValue?: (row: Row) => string | number;
  align?: 'left' | 'right';
  width?: string;
  /** Card layout on phones: title, amount (right), detail (always shown), more (behind «Подробнее»), hidden. */
  mobile?: 'title' | 'amount' | 'detail' | 'more' | 'hidden';
  /**
   * false: phone cards only — wide screens show the field elsewhere (default true).
   * 'more': rarely edited setting, shown in the row's expandable panel on wide screens.
   */
  desktop?: boolean | 'more';
  placeholder?: string;
  /** Allows an empty value (e.g. optional end month); empty means null for the server. */
  optional?: boolean;
}

/** Read-only line of a collapsed phone card; tapping it opens the editable fields. */
export interface MobileSummary<Row> {
  /** Quick control before the title that works without opening the card (e.g. «paid»). */
  leading?: (row: Row) => ReactNode;
  subtitle?: (row: Row) => ReactNode;
  amount: (row: Row) => ReactNode;
}

/**
 * The «+» row. `defaults` names every value `create` reads, so `values.name` is a string, not
 * `string | undefined`, and a key missing from the defaults does not compile.
 */
export interface DraftConfig<Key extends string> {
  defaults: Record<Key, string>;
  required: NoInfer<Key>[];
  create: (values: Record<NoInfer<Key>, string>) => Promise<unknown>;
  addLabel: string;
}

export type CellStatus = { state: 'saving' | 'saved' | 'error'; message?: string };

export type Draft = {
  tempId: string;
  values: Record<string, string>;
  status?: CellStatus;
  errors: Record<string, string>;
};

export interface EditableTableProps<
  Row,
  Extra extends string = never,
  DraftKey extends string = string,
> {
  label: string;
  rows: Row[];
  columns: Column<Row, Extra>[];
  getRowId: (row: Row) => string;
  onCommit: (row: Row, key: ColumnKey<Row, Extra>, value: string) => Promise<unknown>;
  draft?: DraftConfig<DraftKey>;
  /** Deletes a row; may return an undo function shown in the toast. */
  onDelete?: (row: Row) => Promise<(() => Promise<unknown>) | void>;
  deleteLabel?: (row: Row) => string;
  rowActions?: (row: Row) => ReactNode;
  /** View-only actions such as expanding a client remain available on demo samples. */
  rowActionsReadOnly?: boolean;
  /** Fixed width of the actions column: every row is its own grid, so it must not be auto. */
  actionsWidth?: string;
  expanded?: (row: Row) => ReactNode;
  mobileSummary?: MobileSummary<Row>;
  rowClassName?: (row: Row) => string | undefined;
  searchText?: (row: Row) => string;
  toolbar?: ReactNode;
  footer?: ReactNode;
  /** Checkboxes on the left (wide screens): the caller keeps the selection and shows its sum. */
  selection?: {
    selected: ReadonlySet<string>;
    onChange: (ids: string[], on: boolean) => void;
  };
  empty?: ReactNode;
}

/** What the desktop grid and the phone cards share: the visible rows, drafts and cell renderers. */
export interface TableView<Row, Extra extends string> {
  rows: Row[];
  drafts: Draft[];
  /** Editable or read-only content of one cell (the index addresses ↑/↓ keyboard moves). */
  cell: (row: Row, column: Column<Row, Extra>, rowIndex: number) => ReactNode;
  draftCell: (draft: Draft, column: Column<Row, Extra>, rowIndex: number) => ReactNode;
  rowStatus: (row: Row) => CellStatus | undefined;
  remove: (row: Row) => void;
  /** Phone card opened / desktop «more» panel shown. */
  isOpen: (row: Row) => boolean;
  toggle: (row: Row) => void;
  submitDraft: (tempId: string) => void;
  cancelDraft: (tempId: string) => void;
}
