import 'i18next';
import type { Dictionary } from './resources';

// Typed keys: t('purchases.title') compiles only if the key exists in the Russian dictionary.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: Dictionary };
  }
}
