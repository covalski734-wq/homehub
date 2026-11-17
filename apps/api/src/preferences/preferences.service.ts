import type { Language, PreferencesDto, preferencesUpdateSchema } from '@homehub/shared';
import type { z } from 'zod';

const DEFAULTS: PreferencesDto = { language: 'ru', colorLabels: true, demoMode: false };

/** Per-user language, colour labels and demo mode; every user changes only their own row. */
export class PreferencesService {
  constructor(private readonly d1: D1Database) {}

  async get(userId: string): Promise<PreferencesDto> {
    const row = await this.d1
      .prepare(
        'SELECT language, color_labels AS colorLabels, demo_mode AS demoMode FROM user_settings WHERE user_id = ?1',
      )
      .bind(userId)
      .first<{ language: Language; colorLabels: number; demoMode: number }>();
    return row
      ? {
          language: row.language,
          colorLabels: Boolean(row.colorLabels),
          demoMode: Boolean(row.demoMode),
        }
      : DEFAULTS;
  }

  /** Only supplied fields change, including concurrent edits from another device. */
  async update(userId: string, input: z.output<typeof preferencesUpdateSchema>) {
    await this.d1
      .prepare(
        `INSERT INTO user_settings (user_id, language, color_labels, updated_at, demo_mode)
         VALUES (?1, COALESCE(?2, 'ru'), COALESCE(?3, 1), ?4, COALESCE(?5, 0))
         ON CONFLICT (user_id) DO UPDATE SET
           language = COALESCE(?2, user_settings.language),
           color_labels = COALESCE(?3, user_settings.color_labels),
           updated_at = ?4,
           demo_mode = COALESCE(?5, user_settings.demo_mode)`,
      )
      .bind(
        userId,
        input.language ?? null,
        input.colorLabels === undefined ? null : Number(input.colorLabels),
        Date.now(),
        input.demoMode === undefined ? null : Number(input.demoMode),
      )
      .run();
    return this.get(userId);
  }
}
