/** Household chores and their completions. */
export const CHORES_ERRORS = {
  CHORES_CHORE_NOT_FOUND: 'Дело не найдено',
  CHORES_COMPLETION_NOT_FOUND: 'Отметка не найдена',
  CHORES_ASSIGNEE_NOT_MEMBER: 'Исполнитель должен быть участником пространства',
  CHORES_ALREADY_DONE: 'Это дело уже выполнено',
  CHORES_VERSION_CONFLICT:
    'Дело уже изменил другой участник. Данные обновлены — повторите действие.',
} as const;
