/** Sign-in, sessions and CSRF protection. */
export const AUTH_ERRORS = {
  AUTH_CSRF_ORIGIN: 'Недопустимый источник запроса',
  AUTH_CSRF_TOKEN: 'Недействительный CSRF-токен',
} as const;
