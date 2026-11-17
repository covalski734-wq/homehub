import {
  positionCreateSchema,
  positionUpdateSchema,
  type AssetDto,
  type PositionCreateInput,
  type PositionDto,
  type PositionUpdateInput,
  type PotDto,
} from '@homehub/shared';
import { Loader2, Search } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormError } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { DialogBody } from '@/components/ui/dialog';
import { FormDialog } from '@/components/ui/form-dialog';
import { fieldA11y, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/form-errors';
import { schemaResolver } from '@/lib/form-resolver';
import { formatCoins, formatMoney, formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAssetSearch, useSavingsMutations } from './api';
import { AssetIcon } from './asset-icon';
import { FormFooter } from './form-footer';
import { useDebounced } from './hooks';
import { positionValue } from './model';
import { t } from '@/i18n';

export interface PositionDialogState {
  pot: PotDto;
  position: PositionDto | null;
}

const createResolver = schemaResolver(positionCreateSchema);
const updateResolver = schemaResolver(positionUpdateSchema);

export function PositionDialog({
  state,
  month,
  onClose,
}: {
  state: PositionDialogState | null;
  month: string;
  onClose: () => void;
}) {
  return (
    <FormDialog
      open={state !== null}
      onOpenChange={(open) => !open && onClose()}
      title={state?.position ? state.position.asset.name : t('savings.position.addTitle')}
      description={state?.position ? undefined : t('savings.position.addDescription')}
      isDirty={false}
    >
      {state &&
        (state.position ? (
          <QuantityForm
            key={state.position.id}
            pot={state.pot}
            position={state.position}
            month={month}
            onDone={onClose}
          />
        ) : (
          <AddPositionForm key={state.pot.id} pot={state.pot} month={month} onDone={onClose} />
        ))}
    </FormDialog>
  );
}

/** CoinGecko search, then the quantity or its value in the portfolio currency. */
function AddPositionForm({
  pot,
  month,
  onDone,
}: {
  pot: PotDto;
  month: string;
  onDone: () => void;
}) {
  const { addPosition } = useSavingsMutations(month, { silent: true });
  const [formError, setFormError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [asset, setAsset] = useState<AssetDto | null>(null);
  const [by, setBy] = useState<'quantity' | 'value'>('quantity');
  // CoinGecko is asked once typing pauses, not on every letter.
  const debounced = useDebounced(query, 400);
  const search = useAssetSearch(asset ? '' : debounced);
  const existing = asset && pot.positions.find((p) => p.asset.id === asset.id);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    control,
    formState: { errors },
  } = useForm<PositionCreateInput, unknown, z.output<typeof positionCreateSchema>>({
    resolver: createResolver,
    defaultValues: { quantity: '', value: '', avgPrice: '' },
  });
  const amount = useWatch({ control, name: by });
  const amountError = (errors.quantity ?? errors.value)?.message;

  const pick = (next: AssetDto) => {
    setAsset(next);
    setValue('asset', next);
  };
  // One amount field: switching moves the typed number to the other meaning.
  const switchBy = (next: 'quantity' | 'value') => {
    const typed = getValues(by) ?? '';
    setValue(by, '');
    setValue(next, typed);
    setBy(next);
  };

  const submit = handleSubmit(async (payload) => {
    setFormError(null);
    try {
      await addPosition.mutateAsync({ potId: pot.id, data: payload });
      toast.success(existing ? t('savings.position.addedToExisting') : t('savings.position.added'));
      onDone();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['quantity', 'value', 'avgPrice']));
    }
  });

  return (
    <form
      onSubmit={(event) => {
        if (asset) return submit(event);
        event.preventDefault();
      }}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogBody className="grid gap-4">
        <FormError message={formError} />
        {asset ? (
          <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
            <AssetIcon asset={asset} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{asset.name}</p>
              <p className="text-xs text-muted-foreground">
                {asset.symbol}
                {existing &&
                  ` · ${t('savings.position.alreadyHave', { quantity: formatCoins(existing.quantity, asset.symbol) })}`}
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAsset(null)}>
              {t('savings.position.another')}
            </Button>
          </div>
        ) : (
          <div className="grid gap-2">
            <FormField id="asset-search" label={t('savings.position.search')}>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="asset-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('savings.position.searchPlaceholder')}
                  autoComplete="off"
                  className="pl-8"
                  autoFocus
                />
              </div>
            </FormField>
            {search.isError ? (
              <p className="text-sm text-destructive">{errorMessage(search.error)}</p>
            ) : search.data && query.trim().length >= 2 ? (
              search.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('common.nothingFound')}</p>
              ) : (
                <ul
                  className={cn(
                    'max-h-64 divide-y overflow-y-auto rounded-lg border',
                    search.isFetching && 'opacity-60',
                  )}
                  aria-label={t('savings.position.searchResults')}
                >
                  {search.data.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => pick(a)}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                      >
                        <AssetIcon asset={a} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm">{a.name}</span>
                        <span className="text-xs text-muted-foreground">{a.symbol}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : search.isFetching ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
            ) : null}
          </div>
        )}
        {asset && (
          <>
            <SegmentedControl
              label={t('savings.position.by')}
              value={by}
              onChange={switchBy}
              options={[
                { value: 'quantity', label: t('savings.position.byQuantity') },
                { value: 'value', label: t('common.amountIn', { currency: pot.currency }) },
              ]}
            />
            <FormField
              id="asset-amount"
              label={
                by === 'quantity'
                  ? t('savings.position.quantity', { symbol: asset.symbol })
                  : t('savings.position.value', { currency: pot.currency })
              }
              hint={
                by === 'value'
                  ? t('savings.position.valueHint')
                  : t('savings.position.quantityHint')
              }
              error={amountError}
            >
              <Input
                {...fieldA11y('asset-amount', amountError, 'hint')}
                {...register(by)}
                inputMode="decimal"
                autoComplete="off"
                className="tabular"
                autoFocus
              />
            </FormField>
            <FormField
              id="position-avg"
              label={t('savings.position.avgPrice', { currency: pot.currency })}
              hint={t('savings.position.avgPriceHint')}
              error={errors.avgPrice?.message}
            >
              <Input
                {...fieldA11y('position-avg', errors.avgPrice?.message, 'hint')}
                {...register('avgPrice')}
                inputMode="decimal"
                autoComplete="off"
                className="tabular"
              />
            </FormField>
          </>
        )}
      </DialogBody>
      <FormFooter
        pending={addPosition.isPending}
        label={t('common.add')}
        disabled={!asset || !amount}
      />
    </form>
  );
}

/** A position's quantity (with a live «≈ value») and average purchase price. */
function QuantityForm({
  pot,
  position,
  month,
  onDone,
}: {
  pot: PotDto;
  position: PositionDto;
  month: string;
  onDone: () => void;
}) {
  const { updatePosition } = useSavingsMutations(month, { silent: true });
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<PositionUpdateInput, unknown, z.output<typeof positionUpdateSchema>>({
    resolver: updateResolver,
    defaultValues: { quantity: position.quantity, avgPrice: position.avgPrice ?? '' },
  });
  const quantity = useWatch({ control, name: 'quantity' }) ?? '';
  const preview = positionValue(quantity, position.price);

  const submit = handleSubmit(async (payload) => {
    setFormError(null);
    try {
      await updatePosition.mutateAsync({ id: position.id, data: payload });
      toast.success(t('savings.position.quantitySaved'));
      onDone();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['quantity', 'avgPrice']));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="grid gap-4">
        <FormError message={formError} />
        <FormField
          id="position-quantity"
          label={t('savings.position.quantity', { symbol: position.asset.symbol })}
          hint={
            position.price === null
              ? t('savings.position.noRate')
              : t('savings.position.rate', {
                  price: formatPrice(position.price, pot.currency),
                  value: preview !== null ? ` · ≈ ${formatMoney(preview, pot.currency)}` : '',
                })
          }
          error={errors.quantity?.message}
        >
          <Input
            {...fieldA11y('position-quantity', errors.quantity?.message, 'hint')}
            {...register('quantity')}
            inputMode="decimal"
            autoComplete="off"
            className="tabular"
            autoFocus
          />
        </FormField>
        <FormField
          id="position-avg"
          label={t('savings.position.avgPrice', { currency: pot.currency })}
          hint={t('savings.position.avgPriceHint')}
          error={errors.avgPrice?.message}
        >
          <Input
            {...fieldA11y('position-avg', errors.avgPrice?.message, 'hint')}
            {...register('avgPrice')}
            inputMode="decimal"
            autoComplete="off"
            className="tabular"
          />
        </FormField>
      </DialogBody>
      <FormFooter
        pending={updatePosition.isPending}
        label={t('common.save')}
        disabled={!quantity}
      />
    </form>
  );
}
