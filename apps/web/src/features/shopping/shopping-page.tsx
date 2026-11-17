import { parseShoppingText, type ShoppingItemDto } from '@homehub/shared';
import { Check, Loader2, Plus, ShoppingCart, Sparkles, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { aisleOf, AISLES } from './aisles';
import {
  useAddShoppingItems,
  useClearShoppingCart,
  useRemoveShoppingItem,
  useShoppingList,
  useToggleShoppingItem,
} from './api';
import { t } from '@/i18n';

function ItemRow({
  item,
  onToggle,
  onRemove,
}: {
  item: ShoppingItemDto;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex min-h-12 items-center gap-1 pr-1 pl-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={item.checked}
        aria-label={
          item.checked
            ? t('shopping.item.returnToList', { title: item.title })
            : t('shopping.item.putInCart', { title: item.title })
        }
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-2 pl-1.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors',
            item.checked ? 'border-income bg-income text-white' : 'border-muted-foreground/40',
          )}
        >
          {item.checked && <Check className="size-4" aria-hidden />}
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            item.checked && 'text-muted-foreground line-through',
          )}
        >
          {item.title}
        </span>
        {item.quantity && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular">
            {item.quantity}
          </span>
        )}
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('shopping.item.delete', { title: item.title })}
        onClick={onRemove}
      >
        <X className="text-muted-foreground" />
      </Button>
    </li>
  );
}

/** The household's shopping list: add in one line, tick off in the store, clear afterwards. */
export default function ShoppingPage() {
  const list = useShoppingList();
  const add = useAddShoppingItems();
  const clear = useClearShoppingCart();
  const toggleItem = useToggleShoppingItem();
  const removeItem = useRemoveShoppingItem();
  const [text, setText] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const items = parseShoppingText(text);
    if (items.length === 0) return;
    setText('');
    add.mutate(items);
  };

  const toggle = (item: ShoppingItemDto) =>
    toggleItem.mutate({ id: item.id, checked: !item.checked });
  const remove = (item: ShoppingItemDto) => removeItem.mutate({ id: item.id });

  const header = <PageHeader title={t('shopping.title')} description={t('shopping.description')} />;

  if (list.isPending)
    return (
      <>
        {header}
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="mt-4 h-64 w-full rounded-xl" />
      </>
    );
  if (list.isError)
    return (
      <>
        {header}
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      </>
    );

  const open = list.data.items.filter((i) => !i.checked);
  const inCart = list.data.items.filter((i) => i.checked);
  const groups = AISLES.map((aisle) => ({
    aisle,
    items: open.filter((i) => aisleOf(i.title) === aisle.id),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      {header}
      <div className="space-y-4">
        <form onSubmit={submit} className="flex gap-2">
          <label htmlFor="shopping-add" className="sr-only">
            {t('shopping.form.label')}
          </label>
          <Input
            id="shopping-add"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('shopping.form.placeholder')}
            autoComplete="off"
            enterKeyHint="done"
          />
          <Button
            type="submit"
            disabled={add.isPending || !text.trim()}
            aria-label={t('common.add')}
          >
            {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            <span className="max-sm:sr-only">{t('common.add')}</span>
          </Button>
        </form>

        {list.data.suggestions.length > 0 && (
          <section aria-label={t('shopping.frequent')}>
            <h2 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5" aria-hidden /> {t('shopping.frequent')}
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {list.data.suggestions.map((s) => (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => add.mutate([{ title: s.title, quantity: '' }])}
                  className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Plus className="size-3 text-muted-foreground" aria-hidden />
                  {s.title}
                </button>
              ))}
            </div>
          </section>
        )}

        {open.length === 0 && inCart.length === 0 ? (
          <Card className="px-4 py-10 text-center">
            <ShoppingCart className="mx-auto size-8 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-medium">{t('shopping.empty.title')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('shopping.empty.description')}</p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            {open.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {t('shopping.allInCart')}
              </p>
            ) : (
              groups.map(({ aisle, items }) => (
                <section
                  key={aisle.id}
                  aria-label={aisle.label}
                  className="border-b last:border-b-0"
                >
                  <h2 className="flex items-center gap-1.5 bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    <span aria-hidden>{aisle.emoji}</span> {aisle.label}
                    <span className="ml-auto tabular">{items.length}</span>
                  </h2>
                  <ul className="divide-y">
                    {items.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        onToggle={() => toggle(item)}
                        onRemove={() => remove(item)}
                      />
                    ))}
                  </ul>
                </section>
              ))
            )}
            {inCart.length > 0 && (
              <section aria-label={t('shopping.cart.title')} className="border-t bg-muted/10">
                <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <h2 className="text-xs font-medium text-muted-foreground">
                    {t('shopping.cart.heading', { number: inCart.length })}
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={clear.isPending}
                    onClick={() =>
                      clear.mutate(undefined, {
                        onSuccess: () => toast.success(t('shopping.cart.cleared')),
                      })
                    }
                  >
                    <Trash2 /> {t('shopping.cart.clear')}
                  </Button>
                </div>
                <ul className="divide-y">
                  {inCart.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      onToggle={() => toggle(item)}
                      onRemove={() => remove(item)}
                    />
                  ))}
                </ul>
              </section>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
