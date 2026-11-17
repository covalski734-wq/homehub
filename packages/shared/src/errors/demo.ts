/** Demo mode: the sample workspace next to the real one. */
export const DEMO_ERRORS = {
  // The web client reloads the page on this code, so it has no module prefix.
  MODE_CHANGED: 'Режим изменён в другой вкладке. Обновите страницу.',
  DEMO_SHARED_SETTINGS_READ_ONLY: 'В деморежиме общие настройки доступны только для просмотра.',
  DEMO_INTEGRATIONS_DISABLED: 'В деморежиме интеграции отключены.',
  DEMO_UNAVAILABLE: 'Деморежим недоступен. Выключите и включите его в настройках.',
  DEMO_WRITE_NOT_OWN: 'Можно изменять только записи, созданные вами в деморежиме.',
  DEMO_WRITE_REJECTED: 'Не удалось сохранить демозапись. Проверьте заполненные поля.',
  DEMO_READ_ERROR: 'Не удалось загрузить данные примера.',
} as const;
