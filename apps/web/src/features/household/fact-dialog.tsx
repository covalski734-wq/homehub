import { currentMonth, todayDate, type ActualPaymentInput } from '@homehub/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { FormError } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { FormDialog } from '@/components/ui/form-dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { errorMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useAccounts } from '../accounts/use-accounts';
import { OwnerSelect } from './owner';
import { t } from '@/i18n';

export interface FactRequest {
  kind: 'expense' | 'income' | 'purchase';
  name: string;
  month: string;
  /** Planned amount and its currency (prefilled when the account has that currency). */
  amount: string;
  currency: string;
  ownerId: string | null;
  /** Ticking without an operation is allowed (regular payments only). */
  allowTickOnly: boolean;
  submit: (actual: ActualPaymentInput | null) => Promise<unknown>;
}

/**
 * The fact of a planned line: the real amount, date and account (and who paid). Saving it writes
 * an operation, so the account balance moves; «Только отметить» keeps the old tick-only way.
 */
export function FactDialog({
  request,
  onClose,
}: {
  request: FactRequest | null;
  onClose: () => void;
}) {
  return (
    <FormDialog
      open={request !== null}
      onOpenChange={(open) => !open && onClose()}
      title={
        request
          ? request.kind === 'income'
            ? t('household.fact.receivedTitle', { name: request.name })
            : t('household.fact.paidTitle', { name: request.name })
          : ''
      }
      description={
        request
          ? t('household.fact.planned', { amount: formatMoney(request.amount, request.currency) })
          : undefined
      }
      isDirty={false}
    >
      {request && (
        <FactForm key={request.name + request.month} request={request} onDone={onClose} />
      )}
    </FormDialog>
  );
}

function FactForm({ request, onDone }: { request: FactRequest; onDone: () => void }) {
  const accounts = useAccounts();
  const live = (accounts.data ?? []).filter((a) => !a.archived);
  const preferred =
    live.find((a) => a.ownerId === request.ownerId && a.currency === request.currency) ??
    live.find((a) => a.currency === request.currency) ??
    live[0];
  const [accountId, setAccountId] = useState(preferred?.id ?? '');
  const account = live.find((a) => a.id === accountId);
  const [amount, setAmount] = useState(
    preferred?.currency === request.currency ? request.amount : '',
  );
  const [date, setDate] = useState(
    request.month === currentMonth() ? todayDate() : `${request.month}-01`,
  );
  const [payerId, setPayerId] = useState<string | null>(preferred?.ownerId ?? request.ownerId);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'fact' | 'tick' | null>(null);

  const run = async (actual: ActualPaymentInput | null) => {
    setError(null);
    setPending(actual ? 'fact' : 'tick');
    try {
      await request.submit(actual);
      onDone();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(null);
    }
  };

  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ amount, date, accountId, payerId, note });
      }}
    >
      <DialogBody className="grid gap-4">
        <FormError message={error} />
        {live.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('household.fact.noAccounts')}{' '}
            <Link to="/accounts" className="underline underline-offset-4">
              {t('household.fact.toAccounts')}
            </Link>
          </p>
        ) : (
          <>
            <FormField
              id="fact-account"
              label={
                request.kind === 'income'
                  ? t('household.fact.creditedTo')
                  : t('household.fact.debitedFrom')
              }
            >
              <NativeSelect
                id="fact-account"
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  const next = live.find((a) => a.id === e.target.value);
                  if (next?.ownerId) setPayerId(next.ownerId);
                }}
              >
                {live.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {formatMoney(a.balance, a.currency)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id="fact-amount"
                label={t('common.amountIn', { currency: account?.currency ?? request.currency })}
              >
                <Input
                  id="fact-amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  className="tabular"
                  autoFocus
                />
              </FormField>
              <FormField id="fact-date" label={t('common.date')}>
                <Input
                  id="fact-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id="fact-payer"
                label={
                  request.kind === 'income'
                    ? t('household.fact.recipient')
                    : t('household.fact.payer')
                }
              >
                <OwnerSelect id="fact-payer" value={payerId} onChange={setPayerId} />
              </FormField>
              <FormField id="fact-note" label={t('common.comment')}>
                <Input
                  id="fact-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  autoComplete="off"
                />
              </FormField>
            </div>
          </>
        )}
      </DialogBody>
      <DialogFooter>
        {request.allowTickOnly && (
          <Button
            type="button"
            variant="outline"
            disabled={pending !== null}
            onClick={() => void run(null)}
          >
            {pending === 'tick' && <Loader2 className="animate-spin" aria-hidden />}
            {t('household.fact.tickOnly')}
          </Button>
        )}
        <Button type="submit" disabled={pending !== null || !amount || !accountId || !date}>
          {pending === 'fact' && <Loader2 className="animate-spin" aria-hidden />}
          {request.kind === 'income' ? t('household.fact.credit') : t('household.fact.debit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
