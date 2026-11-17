import { Check, CircleAlert, Loader2 } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { isDemoSample } from '@/lib/demo';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import type { CellEditor, CellStatus, Column } from './types';

const inputBase =
  'h-9 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none transition-[border-color,box-shadow,background-color] hover:border-input focus:border-ring focus:bg-card focus:ring-[3px] focus:ring-ring/30 aria-[invalid=true]:border-destructive aria-[invalid=true]:bg-destructive/5 disabled:cursor-not-allowed disabled:opacity-60 max-md:h-10 max-md:border-input max-md:bg-card max-md:text-base';

function inputMode(editor: CellEditor): 'decimal' | 'numeric' | 'text' {
  if (editor === 'money' || editor === 'percent') return 'decimal';
  return editor === 'day' ? 'numeric' : 'text';
}

/** One editable value. Keeps its own text while focused so server refreshes never clobber typing. */
export function CellInput<Row, Extra extends string>({
  column,
  row,
  rowKey,
  rowIndex,
  colIndex,
  saved,
  status,
  onSave,
  onDraftChange,
  draftError,
}: {
  column: Column<Row, Extra>;
  row: Row | null;
  rowKey: string;
  rowIndex: number;
  colIndex: number;
  saved: string;
  status?: CellStatus;
  onSave?: (value: string) => void;
  onDraftChange?: (value: string) => void;
  draftError?: string;
}) {
  const [text, setText] = useState(saved);
  const [focused, setFocused] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  /** Escape restores the saved value; the blur it causes must not save what was typed. */
  const discardOnBlur = useRef(false);
  // While a save is in flight or failed, keep showing what the user typed (not the old value).
  const holdsText =
    focused || status?.state === 'error' || status?.state === 'saving' || Boolean(onDraftChange);
  const value = holdsText ? text : saved;
  if (!holdsText && text !== saved) setText(saved);

  const editor = column.editor ?? 'text';
  const error =
    localError ?? draftError ?? (status?.state === 'error' ? status.message : undefined);
  const id = `cell-${rowKey}-${column.key}`;

  const commit = (next: string) => {
    if (onDraftChange) return;
    if (next === saved) {
      setLocalError(null);
      return;
    }
    const problem = column.validate?.(next, row) ?? null;
    setLocalError(problem);
    if (!problem) onSave?.(next);
  };

  /**
   * Saving happens exactly once, on blur. Keyboard moves only change focus; when there is no
   * row to move to, the field is blurred so the value is still saved.
   */
  const moveTo = (target: HTMLElement, rowDelta: number) => {
    const table = target.closest('[data-editable-table]');
    const next = table?.querySelector<HTMLElement>(
      `[data-row="${rowIndex + rowDelta}"][data-col="${colIndex}"]`,
    );
    if (next) next.focus();
    else target.blur();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    const target = event.currentTarget;
    if (event.key === 'Escape') {
      event.preventDefault();
      setText(saved);
      setLocalError(null);
      discardOnBlur.current = true;
      target.blur();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      moveTo(target, 1);
      return;
    }
    if (
      target instanceof HTMLInputElement &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    ) {
      event.preventDefault();
      moveTo(target, event.key === 'ArrowDown' ? 1 : -1);
    }
  };

  const common = {
    id,
    disabled: isDemoSample(row),
    'data-row': rowIndex,
    'data-col': colIndex,
    'aria-label': column.header,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : undefined,
    title: error ?? undefined,
    onFocus: () => {
      setFocused(true);
      if (!onDraftChange && status?.state !== 'error') setText(saved);
    },
    onKeyDown,
  } as const;

  const control =
    editor === 'select' ? (
      <select
        {...common}
        value={value}
        className={cn(inputBase, 'cursor-pointer pr-1', column.tone?.(value))}
        onChange={(e) => {
          setText(e.target.value);
          onDraftChange?.(e.target.value);
          if (!onDraftChange) commit(e.target.value);
        }}
        onBlur={() => setFocused(false)}
      >
        {column.optional && <option value="">—</option>}
        {column.options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ) : (
      <input
        {...common}
        type={editor === 'date' ? 'date' : 'text'}
        inputMode={inputMode(editor)}
        autoComplete="off"
        placeholder={
          column.placeholder ?? (editor === 'month' ? t('table.monthPlaceholder') : undefined)
        }
        value={value}
        className={cn(inputBase, column.align === 'right' && 'text-right tabular')}
        onChange={(e) => {
          setText(e.target.value);
          onDraftChange?.(e.target.value);
          if (localError) setLocalError(null);
        }}
        onBlur={(e) => {
          setFocused(false);
          if (discardOnBlur.current) {
            discardOnBlur.current = false;
            return;
          }
          commit(e.target.value);
        }}
      />
    );

  return (
    <div className="relative flex min-w-0 items-center gap-1">
      {control}
      {column.suffix && row && (
        <span className="shrink-0 text-xs text-muted-foreground">{column.suffix(row)}</span>
      )}
      {row && (
        <fieldset disabled={isDemoSample(row)} className="contents">
          {column.afterInput?.(row)}
        </fieldset>
      )}
      {error && (
        <span id={`${id}-error`} role="alert" className="sr-only">
          {error}
        </span>
      )}
    </div>
  );
}

export function RowStatus({ status }: { status?: CellStatus }) {
  if (!status) return <span className="block size-4" aria-hidden />;
  if (status.state === 'saving')
    return (
      <Loader2
        className="size-4 animate-spin text-muted-foreground"
        aria-label={t('common.saving')}
      />
    );
  if (status.state === 'error')
    return (
      <CircleAlert
        className="size-4 text-destructive"
        aria-label={status.message ?? t('table.status.error')}
      />
    );
  return (
    <Check
      className="size-4 text-income animate-out fade-out-0 fill-mode-forwards [animation-delay:1.5s] duration-500"
      aria-label={t('table.status.saved')}
    />
  );
}
