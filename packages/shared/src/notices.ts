/**
 * Warnings the server computes about the user's data (a plan larger than the money, a missing
 * rate). Like errors, they travel as a code with parameters and are worded by the client
 * (`notices.<CODE>` in the web dictionaries).
 */
export type NoticeCode =
  /** {currency, fund, part} */
  | 'MISSING_RATE'
  /** {amount, currency} */
  | 'REQUIRED_OVER_INCOME'
  /** {amount, currency} */
  | 'PLAN_OVER_MONEY'
  /** {amount, currency, parts} — parts: «fund · part» names, comma separated */
  | 'PLAN_OVER_MONEY_REDUCE'
  /** {fund, part} */
  | 'PART_BELOW_MINIMUM'
  /** {amount, currency} */
  | 'MONTH_PLAN_OVER_INCOME'
  /** {account, amount, currency} */
  | 'ACCOUNT_OVER_RESERVED';

export interface NoticeDto {
  code: NoticeCode;
  params: Record<string, string>;
}
