import { z } from 'zod';

/** Interface preferences of one user (not shared with the workspace). */
export const LANGUAGES = ['ru', 'uk'] as const;
export type Language = (typeof LANGUAGES)[number];

export const preferencesUpdateSchema = z
  .object({
    language: z.enum(LANGUAGES),
    colorLabels: z.boolean(),
    demoMode: z.literal(false),
  })
  .partial();
export type PreferencesUpdate = z.input<typeof preferencesUpdateSchema>;

export interface PreferencesDto {
  language: Language;
  colorLabels: boolean;
  demoMode: boolean;
}
