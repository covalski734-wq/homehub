/** Machine access: personal tokens, OAuth connections, MCP. */
export const ACCESS_ERRORS = {
  ACCESS_TOKEN_NOT_FOUND: 'Подключение не найдено',
  ACCESS_TOKEN_NOT_OWN: 'Отозвать подключение может только тот, кто его создал',
  ACCESS_TOKEN_INVALID: 'Токен недействителен, истек или отозван',
  ACCESS_SCOPE_MISSING: 'У подключения нет права «{{scope}}»',
  OAUTH_REQUEST_NOT_FOUND:
    'Запрос на подключение не найден или устарел — начните подключение заново',
  MCP_TOOL_FAILED: 'Не удалось выполнить действие',
} as const;
