import { signedMoneySchema } from '@homehub/shared';
import { fromCents, toCents } from '@/lib/money';

/** Balance per currency of a group of accounts, currencies in the order they first appear. */
export function totalsByCurrency(
  accounts: readonly { currency: string; balance: string }[],
): { currency: string; sum: string }[] {
  const sums = new Map<string, bigint>();
  for (const account of accounts)
    sums.set(account.currency, (sums.get(account.currency) ?? 0n) + toCents(account.balance));
  return [...sums].map(([currency, cents]) => ({ currency, sum: fromCents(cents) }));
}

/**
 * What a reconciliation would add to the account: the typed bank balance minus the current one.
 * null while the typed value is not an amount yet or matches the balance.
 */
export function reconcileDifference(typed: string, balance: string): string | null {
  const parsed = signedMoneySchema.safeParse(typed);
  if (!parsed.success) return null;
  const diff = toCents(parsed.data) - toCents(balance);
  return diff === 0n ? null : fromCents(diff);
}
