/** Planner: incomes, regular payments, purchases, deductions, shares. */
export const PLANNER_ERRORS = {
  PLANNER_VERSION_CONFLICT: 'Строку уже изменили. Данные обновлены — повторите изменение.',
  PLANNER_INCOME_NOT_FOUND: 'Источник дохода не найден',
  PLANNER_RECURRING_NOT_FOUND: 'Регулярный расход не найден',
  PLANNER_DEDUCTION_NOT_FOUND: 'Удержание не найдено',
  PLANNER_PURCHASE_NOT_FOUND: 'Покупка не найдена',
  PLANNER_LINE_NOT_FOUND: 'Строка плана не найдена',
  PLANNER_MONTH_OUTSIDE_LINE: 'Месяц вне периода действия строки',
  PLANNER_CURRENCY_USED:
    'Валюта уже используется в прошлых месяцах. Завершите строку и добавьте новую в нужной валюте.',
  PLANNER_RECURRING_NOT_PLANNED: 'Расход не запланирован на этот месяц',
  PLANNER_ONGOING_PAID_BY_OPERATIONS: 'Траты «в течение месяца» вносятся отдельными операциями',
  PLANNER_INCOME_NOT_PLANNED: 'Доход не запланирован на этот месяц',
  PLANNER_PURCHASE_NEEDS_DATE:
    'Покупка отмечена купленной в этом месяце без даты. Сначала укажите дату.',
  PLANNER_PURCHASE_DATE_REQUIRED: 'Укажите дату покупки',
  PLANNER_PURCHASED_UNDELETABLE:
    'Совершенную покупку нельзя удалить: сначала снимите отметку о покупке или отмените ее',
} as const;
