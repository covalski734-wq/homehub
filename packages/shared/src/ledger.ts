import { z } from 'zod';

/**
 * Operations the system writes on its own (fund money, account top-ups, reconciliations). They
 * keep a kind and parameters instead of a Russian description, so every reader sees them in their
 * own language; `description` holds only the user's note, if any.
 */
export const systemOperationKindSchema = z.enum([
  'FUND_DEPOSIT',
  'FUND_WITHDRAWAL',
  'FUND_AUTO_DEPOSIT',
  'FUND_AUTO_WITHDRAWAL',
  'FUND_RETURN',
  'FUND_PART_MOVED',
  'ACCOUNT_TOPUP',
  'RECONCILIATION',
]);
export type SystemOperationKind = z.infer<typeof systemOperationKindSchema>;

/** Parameters of a system operation: names of the fund or part it belongs to. */
export const systemOperationParamsSchema = z.record(z.string(), z.string());
export type SystemOperationParams = z.infer<typeof systemOperationParamsSchema>;
