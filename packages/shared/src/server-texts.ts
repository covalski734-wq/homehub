import type { Language } from './preferences';

/** Localized names for household records. */
const TEXTS = {
  ru: {
    'fund.jointPart': 'Общий',
    'fund.returnLine': 'Вернуть в «{{fund}}»',
  },
  uk: {
    'fund.jointPart': 'Спільний',
    'fund.returnLine': 'Повернути в «{{fund}}»',
  },
} as const satisfies Record<Language, Record<string, string>>;

export type ServerTextKey = keyof (typeof TEXTS)['ru'];

export function serverText(
  language: Language,
  key: ServerTextKey,
  params?: Record<string, string>,
): string {
  return TEXTS[language][key].replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_, name: string) => params?.[name] ?? '',
  );
}

/** Every language's version of a text (to recognise a generated name that nobody renamed). */
export const serverTextVariants = (key: ServerTextKey): string[] =>
  Object.values(TEXTS).map((texts) => texts[key]);
