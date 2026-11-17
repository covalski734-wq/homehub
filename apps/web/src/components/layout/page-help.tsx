import { CircleHelp } from 'lucide-react';
import { useLocation } from 'react-router';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { t } from '@/i18n';

interface Help {
  about: string;
  faq: [question: string, answer: string][];
}

/** What each page is for and how to work with it: the «?» next to the page title. */
const HELP: Record<string, () => Help> = {
  '/': () => ({
    about: t('help.overview.about'),
    faq: [
      [t('help.overview.nextMonth.question'), t('help.overview.nextMonth.answer')],
      [t('help.overview.savingsSource.question'), t('help.overview.savingsSource.answer')],
      [t('help.overview.leftToPay.question'), t('help.overview.leftToPay.answer')],
      [t('help.overview.capitalTwice.question'), t('help.overview.capitalTwice.answer')],
    ],
  }),
  '/incomes': () => ({
    about: t('help.incomes.about'),
    faq: [
      [t('help.incomes.differentAmount.question'), t('help.incomes.differentAmount.answer')],
      [t('help.incomes.markReceived.question'), t('help.incomes.markReceived.answer')],
      [t('help.incomes.owner.question'), t('help.incomes.owner.answer')],
    ],
  }),
  '/recurring': () => ({
    about: t('help.recurring.about'),
    faq: [
      [t('help.recurring.markPaid.question'), t('help.recurring.markPaid.answer')],
      [t('help.recurring.sumSelected.question'), t('help.recurring.sumSelected.answer')],
      [t('help.recurring.duringMonth.question'), t('help.recurring.duringMonth.answer')],
      [t('help.recurring.returnToFund.question'), t('help.recurring.returnToFund.answer')],
    ],
  }),
  '/purchases': () => ({
    about: t('help.purchases.about'),
    faq: [
      [t('help.purchases.markBought.question'), t('help.purchases.markBought.answer')],
      [t('help.purchases.postpone.question'), t('help.purchases.postpone.answer')],
    ],
  }),
  '/loans': () => ({
    about: t('help.loans.about'),
    faq: [[t('help.loans.addLoan.question'), t('help.loans.addLoan.answer')]],
  }),
  '/savings': () => ({
    about: t('help.savings.about'),
    faq: [
      [t('help.savings.topUp.question'), t('help.savings.topUp.answer')],
      [t('help.savings.fixMistake.question'), t('help.savings.fixMistake.answer')],
      [t('help.savings.borrow.question'), t('help.savings.borrow.answer')],
      [t('help.savings.plan.question'), t('help.savings.plan.answer')],
      [t('help.savings.auto.question'), t('help.savings.auto.answer')],
      [t('help.savings.history.question'), t('help.savings.history.answer')],
      [t('help.savings.changeAccount.question'), t('help.savings.changeAccount.answer')],
    ],
  }),
  '/scenarios': () => ({
    about: t('help.scenarios.about'),
    faq: [
      [t('help.scenarios.edit.question'), t('help.scenarios.edit.answer')],
      [t('help.scenarios.specialMonth.question'), t('help.scenarios.specialMonth.answer')],
    ],
  }),
  '/accounts': () => ({
    about: t('help.accounts.about'),
    faq: [
      [t('help.accounts.topUp.question'), t('help.accounts.topUp.answer')],
      [t('help.accounts.free.question'), t('help.accounts.free.answer')],
      [t('help.accounts.reconcile.question'), t('help.accounts.reconcile.answer')],
    ],
  }),
  '/finances': () => ({
    about: t('help.finances.about'),
    faq: [
      [t('help.finances.unplanned.question'), t('help.finances.unplanned.answer')],
      [t('help.finances.paymentDeleted.question'), t('help.finances.paymentDeleted.answer')],
    ],
  }),
  '/settings': () => ({
    about: t('help.settings.about'),
    faq: [
      [t('help.settings.addMember.question'), t('help.settings.addMember.answer')],
      [t('help.settings.savingsMode.question'), t('help.settings.savingsMode.answer')],
    ],
  }),
  '/shopping': () => ({
    about: t('help.shopping.about'),
    faq: [],
  }),
  '/chores': () => ({
    about: t('help.chores.about'),
    faq: [],
  }),
};

/** «?» next to the page title: what the page is for, and short answers on how to use it. */
export function PageHelp({ title }: { title: string }) {
  const { pathname } = useLocation();
  const help = (HELP[pathname] ?? HELP[pathname.replace(/\/$/, '')])?.();
  if (!help) return null;
  return (
    <Dialog>
      <DialogTrigger
        className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label={t('help.trigger', { title })}
      >
        <CircleHelp className="size-4.5" aria-hidden />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{help.about}</DialogDescription>
        </DialogHeader>
        {help.faq.length > 0 && (
          <DialogBody className="grid gap-3 pb-5">
            {help.faq.map(([q, a]) => (
              <div key={q}>
                <p className="text-sm font-medium">{q}</p>
                <p className="text-sm text-muted-foreground">{a}</p>
              </div>
            ))}
          </DialogBody>
        )}
      </DialogContent>
    </Dialog>
  );
}
