import type { Language } from '@homehub/shared';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources } from './resources';

/**
 * Interface languages: Russian and Ukrainian, with semantic keys: `t('common.save')`,
 * `t('purchases.title', { count })`. Dictionaries live in `locales/<language>/<module>.json`
 * (see ./resources.ts); a key missing in Ukrainian falls back to Russian. Plurals use i18next
 * suffixes (`_one`, `_few`, `_many`, `_other`) with `count`.
 *
 * The language is chosen in Settings, stored per user on the server and cached in localStorage so
 * the first paint is already in the right language. Changing it reloads the page: labels defined
 * at module level (status names, options) are then evaluated in the new language too.
 */

export const LANGUAGE_STORAGE_KEY = 'homehub.language';

function storedLanguage(): Language {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (value === 'uk' || value === 'ru') return value;
  } catch {
    // storage unavailable (private mode): default language
  }
  return 'ru';
}

void i18next.use(initReactI18next).init({
  lng: storedLanguage(),
  fallbackLng: 'ru',
  resources: {
    ru: { translation: resources.ru },
    uk: { translation: resources.uk },
  },
  defaultNS: 'translation',
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  returnNull: false,
  initAsync: false,
});

export const language = (): Language => (i18next.language === 'uk' ? 'uk' : 'ru');
document.documentElement.lang = language();

/** Locale for Intl formatting of numbers and dates in the current language. */
export const LOCALE = language() === 'uk' ? 'uk-UA' : 'ru-RU';
export const LOCALE_SHORT = language();

/** Translates a semantic key. The language is fixed for the page's life (see above). */
export const t = i18next.t.bind(i18next);

/** Saves the choice locally and reloads so every label is rendered in the new language. */
export function applyLanguage(next: Language, reload = true) {
  if (next === language()) return;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  } catch {
    // Without storage a reload would start in the old language again (and loop): switch in place.
    void i18next.changeLanguage(next);
    return;
  }
  if (reload) window.location.reload();
}
