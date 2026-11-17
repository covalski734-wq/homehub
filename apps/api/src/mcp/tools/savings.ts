import {
  assetSearchSchema,
  autoAmountSchema,
  autoRuleCreateSchema,
  autoRuleUpdateSchema,
  currentMonth,
  fundOverrideSchema,
  fundRuleSchema,
  idSchema,
  memberCreateSchema,
  memberUpdateSchema,
  monthSchema,
  movementCreateSchema,
  movementMoveSchema,
  movementReturnedSchema,
  movementUpdateSchema,
  positionCreateSchema,
  positionUpdateSchema,
  potCreateSchema,
  potUpdateSchema,
  subaccountCreateSchema,
  subaccountUpdateSchema,
} from '@homehub/shared';
import { z } from 'zod';
import { unprocessable } from '../../lib/http-error';
import { defineTool } from '../tool';

const byId = z.object({ id: idSchema });
const monthQuery = z.object({ month: monthSchema.default(() => currentMonth()) });

/** The routes answer a change with the month overview; tools leave that to the read tool. */
const SEE_OVERVIEW = 'Returns no overview: read it with savings_overview.';

/**
 * Funds (parts, plans, deposits and withdrawals, returns, automatic operations), portfolios of
 * coins and tokens, and the household members who own them.
 */
export const savingsTools = [
  defineTool({
    name: 'savings_part_history',
    title: 'История счетов фонда',
    description:
      'Account additions, removals and restorations in a fund. Removed parts retain their movements.',
    scope: 'savings:read',
    input: byId,
    run: ({ ctx, services }, { id }) => services.savings.funds.partHistory(ctx, id),
  }),
  defineTool({
    name: 'savings_confirm_auto',
    title: 'Подтвердить пополнение',
    description:
      'Confirms a planned monthly deposit. Idempotent for the same rule and month; only confirmed deposits affect balances.',
    scope: 'savings:write',
    input: z.object({ id: idSchema, month: monthSchema }),
    run: ({ ctx, services }, { id, month }) => services.savings.auto.confirm(ctx, id, month),
  }),
  defineTool({
    name: 'savings_confirm_plan',
    title: 'Положить по плану',
    description:
      'Deposits the remaining planned amount for a fund part and month. Confirm pending automatic deposits first.',
    scope: 'savings:write',
    input: z.object({ id: idSchema, month: monthSchema }),
    run: async ({ ctx, services }, { id, month }) => {
      const overview = await services.savings.queries.overview(ctx, month);
      for (const pot of overview.pots) {
        const part = pot.subaccounts.find((s) => s.id === id && !s.archived);
        if (part) return services.savings.movements.confirmPlan(ctx, pot.id, part, month);
      }
      throw unprocessable('SAVINGS_PART_NOT_FOUND_OR_ARCHIVED');
    },
  }),
  defineTool({
    name: 'savings_overview',
    title: 'Накопления',
    description:
      'Funds and portfolios of a month ("YYYY-MM", default current): balances, parts with plans and automatic operations, unreturned withdrawals, positions, totals in the display currency and the savings plan. Money is a decimal string.',
    scope: 'savings:read',
    input: monthQuery,
    run: ({ ctx, services }, { month }) => services.savings.queries.overview(ctx, month),
  }),
  defineTool({
    name: 'savings_wealth',
    title: 'Капитал',
    description:
      'Wealth of a month ("YYYY-MM", default current): accounts and funds by owner and progress of the goals, in the display currency.',
    scope: 'savings:read',
    input: monthQuery,
    run: ({ ctx, services }, { month }) => services.savings.queries.wealth(ctx, month),
  }),
  defineTool({
    name: 'savings_list_movements',
    title: 'История фонда',
    description: 'The full history of deposits and withdrawals of a fund, newest first.',
    scope: 'savings:read',
    input: byId,
    run: ({ ctx, services }, { id }) => services.savings.queries.history(ctx, id),
  }),
  defineTool({
    name: 'savings_search_assets',
    title: 'Поиск актива',
    description:
      'Searches CoinGecko coins, gold tokens and tokenized stocks by name or symbol; the result is the asset to put in a portfolio position.',
    scope: 'savings:read',
    input: assetSearchSchema,
    run: ({ services }, { q }) => services.savings.portfolio.search(q),
  }),
  defineTool({
    name: 'savings_refresh_prices',
    title: 'Обновить курсы',
    description: `Fetches today's asset prices now (at most once per few minutes; fails while CoinGecko asks to wait). ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: z.object({}),
    annotations: { idempotent: true },
    run: ({ ctx, services }) => services.savings.portfolio.refreshPrices(ctx),
  }),
  // ---- funds and portfolios
  defineTool({
    name: 'savings_create_pot',
    title: 'Создать фонд',
    description: `Creates a fund (CASH: money with a goal, the opening balance goes to its first part) or a PORTFOLIO of assets, and returns its id. ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: z.object({ data: potCreateSchema }),
    run: async ({ ctx, services }, { data }) => ({
      id: await services.savings.funds.createPot(ctx, data),
    }),
  }),
  defineTool({
    name: 'savings_update_pot',
    title: 'Изменить фонд',
    description: `Changes only the sent fields of a fund or portfolio (name, goal, owner, archive …); the currency changes only for a portfolio or a fund without history. ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: z.object({ id: idSchema, data: potUpdateSchema }),
    annotations: { idempotent: true },
    run: ({ ctx, services }, { id, data }) => services.savings.funds.updatePot(ctx, id, data),
  }),
  defineTool({
    name: 'savings_delete_pot',
    title: 'Удалить фонд',
    description: `Deletes a fund or portfolio with its parts, movements and positions; the account operations of its movements and its unreturned planner returns go too. ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: byId,
    annotations: { destructive: true, idempotent: true },
    run: ({ ctx, services }, { id }) => services.savings.funds.deletePot(ctx, id),
  }),
  // ---- parts
  defineTool({
    name: 'savings_create_part',
    title: 'Добавить часть фонда',
    description: `Adds a part to a fund (id): its own currency (the fund's by default), owner, the real account the money lies on, opening balance. ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: z.object({ id: idSchema, data: subaccountCreateSchema }),
    run: ({ ctx, services }, { id, data }) => services.savings.funds.createPart(ctx, id, data),
  }),
  defineTool({
    name: 'savings_update_part',
    title: 'Изменить часть фонда',
    description: `Changes only the sent fields of a fund part; a new balance adjusts the opening, history stays. ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: z.object({ id: idSchema, data: subaccountUpdateSchema }),
    annotations: { idempotent: true },
    run: ({ ctx, services }, { id, data }) => services.savings.funds.updatePart(ctx, id, data),
  }),
  defineTool({
    name: 'savings_delete_part',
    title: 'Удалить часть фонда',
    description: `Removes a part from the active fund, releases its reservation and preserves money operations and an audit event. ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: byId,
    annotations: { destructive: true, idempotent: true },
    run: ({ ctx, services }, { id }) => services.savings.funds.deletePart(ctx, id),
  }),
  defineTool({
    name: 'savings_set_part_rule',
    title: 'Правило части',
    description: `Sets the monthly plan rule of a fund part from startMonth ("YYYY-MM"): a FIXED amount or a PERCENT of a base, with min/max (a part has one rule). ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: z.object({ id: idSchema, data: fundRuleSchema }),
    annotations: { idempotent: true },
    run: ({ ctx, services }, { id, data }) => services.savings.funds.setRule(ctx, id, data),
  }),
  defineTool({
    name: 'savings_delete_part_rule',
    title: 'Удалить правило части',
    description: `Removes the plan rule of a fund part (id of the part). ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: byId,
    annotations: { destructive: true, idempotent: true },
    run: ({ ctx, services }, { id }) => services.savings.funds.deleteRule(ctx, id),
  }),
  defineTool({
    name: 'savings_set_part_plan',
    title: 'План части на месяц',
    description: `Sets the planned amount of a fund part for one month ("YYYY-MM"); amount null removes the override so the rule applies again. ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: z.object({ id: idSchema, data: fundOverrideSchema }),
    annotations: { idempotent: true },
    run: ({ ctx, services }, { id, data }) => services.savings.funds.setOverride(ctx, id, data),
  }),
  // ---- money
  defineTool({
    name: 'savings_add_movement',
    title: 'Пополнить или снять',
    description: `Deposits into or withdraws from a fund (id) and returns the movement id; the amount is a positive decimal string in the part's currency, date "YYYY-MM-DD". subaccountId may be omitted when the fund has one part; a withdrawal with repayMonth creates a planner payment to put the money back. ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: z.object({ id: idSchema, data: movementCreateSchema }),
    run: async ({ ctx, services }, { id, data }) => ({
      id: await services.savings.movements.add(ctx, id, data),
    }),
  }),
  defineTool({
    name: 'savings_update_movement',
    title: 'Изменить движение',
    description: `Changes the amount, date or comment of a deposit or withdrawal (only the sent fields). ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: z.object({ id: idSchema, data: movementUpdateSchema }),
    annotations: { idempotent: true },
    run: ({ ctx, services }, { id, data }) => services.savings.movements.update(ctx, id, data),
  }),
  defineTool({
    name: 'savings_delete_movement',
    title: 'Удалить движение',
    description: `Deletes a deposit or withdrawal with the account operation and the planner return it made. ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: byId,
    annotations: { destructive: true, idempotent: true },
    run: ({ ctx, services }, { id }) => services.savings.movements.remove(ctx, id),
  }),
  defineTool({
    name: 'savings_set_returned',
    title: 'Отметить возврат',
    description: `Marks a withdrawal taken as a debt to the fund as returned (or not returned). ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: z.object({ id: idSchema, data: movementReturnedSchema }),
    annotations: { idempotent: true },
    run: ({ ctx, services }, { id, data }) =>
      services.savings.movements.setReturned(ctx, id, data.returned),
  }),
  defineTool({
    name: 'savings_move_return',
    title: 'Перенести возврат',
    description: `Moves the return of a withdrawal to another month ("YYYY-MM"). ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: z.object({ id: idSchema, data: movementMoveSchema }),
    annotations: { idempotent: true },
    run: ({ ctx, services }, { id, data }) =>
      services.savings.movements.moveReturn(ctx, id, data.repayMonth),
  }),
  // ---- automatic operations
  defineTool({
    name: 'savings_create_auto',
    title: 'Автооперация',
    description: `Creates a monthly automatic deposit or withdrawal of a fund part (id of the part) on a day of month, from startMonth to endMonth ("YYYY-MM"); deposits require savings_confirm_auto; withdrawals due by today are made at once. ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: z.object({ id: idSchema, data: autoRuleCreateSchema }),
    run: ({ ctx, services }, { id, data }) => services.savings.auto.create(ctx, id, data),
  }),
  defineTool({
    name: 'savings_update_auto',
    title: 'Изменить автооперацию',
    description: `Changes the day, end month or comment of an automatic operation (only the sent fields). ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: z.object({ id: idSchema, data: autoRuleUpdateSchema }),
    annotations: { idempotent: true },
    run: ({ ctx, services }, { id, data }) => services.savings.auto.update(ctx, id, data),
  }),
  defineTool({
    name: 'savings_set_auto_amount',
    title: 'Сумма автооперации',
    description: `Sets the amount of an automatic operation for one month only (MONTH) or for that month and the following ones (FORWARD). ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: z.object({ id: idSchema, data: autoAmountSchema }),
    annotations: { idempotent: true },
    run: ({ ctx, services }, { id, data }) => services.savings.auto.setAmount(ctx, id, data),
  }),
  defineTool({
    name: 'savings_delete_auto',
    title: 'Удалить автооперацию',
    description: `Deletes an automatic operation; movements it already made stay. ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: byId,
    annotations: { destructive: true, idempotent: true },
    run: ({ ctx, services }, { id }) => services.savings.auto.remove(ctx, id),
  }),
  // ---- portfolio positions
  defineTool({
    name: 'savings_add_position',
    title: 'Добавить позицию',
    description: `Adds an asset (from savings_search_assets) to a portfolio (id) with either a quantity or a value in the portfolio currency at today's price, and an optional average purchase price. ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: z.object({ id: idSchema, data: positionCreateSchema }),
    run: ({ ctx, services }, { id, data }) => services.savings.portfolio.add(ctx, id, data),
  }),
  defineTool({
    name: 'savings_update_position',
    title: 'Изменить позицию',
    description: `Changes the quantity or the average purchase price of a portfolio position. ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: z.object({ id: idSchema, data: positionUpdateSchema }),
    annotations: { idempotent: true },
    run: ({ ctx, services }, { id, data }) => services.savings.portfolio.update(ctx, id, data),
  }),
  defineTool({
    name: 'savings_delete_position',
    title: 'Удалить позицию',
    description: `Deletes a portfolio position. ${SEE_OVERVIEW}`,
    scope: 'savings:write',
    input: byId,
    annotations: { destructive: true, idempotent: true },
    run: ({ ctx, services }, { id }) => services.savings.portfolio.remove(ctx, id),
  }),
  // ---- household members
  defineTool({
    name: 'household_list_members',
    title: 'Участники',
    description:
      'Household members (people who own accounts, funds and plan lines), with colour and archive flag.',
    scope: 'household:read',
    input: z.object({}),
    run: ({ ctx, services }) => services.members.list(ctx.workspaceId),
  }),
  defineTool({
    name: 'household_create_member',
    title: 'Добавить участника',
    description:
      'Adds a household member with a name and a colour ("#rrggbb"); returns all members.',
    scope: 'household:write',
    input: z.object({ data: memberCreateSchema }),
    run: ({ ctx, services }, { data }) => services.members.create(ctx, data),
  }),
  defineTool({
    name: 'household_update_member',
    title: 'Изменить участника',
    description:
      'Changes the name, colour or archive flag of a member (only the sent fields); returns all members.',
    scope: 'household:write',
    input: z.object({ id: idSchema, data: memberUpdateSchema }),
    annotations: { idempotent: true },
    run: ({ ctx, services }, { id, data }) => services.members.update(ctx, id, data),
  }),
];
