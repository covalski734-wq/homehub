import type { Language } from '@homehub/shared';

/** A user's interface language (`user_settings.language`); Russian when not chosen or unknown. */
export async function userLanguage(d1: D1Database, userId: string | null): Promise<Language> {
  if (!userId) return 'ru';
  const row = await d1
    .prepare('SELECT language FROM user_settings WHERE user_id = ?')
    .bind(userId)
    .first<{ language: string | null }>();
  return row?.language === 'uk' ? 'uk' : 'ru';
}
