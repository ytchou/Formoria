import { z } from 'zod'

type Translator = (key: string) => string

export function getProfileSchema(t: Translator) {
  return z.object({
    displayName: z
      .string()
      .max(50, t('settings.validation.displayNameMaxLength'))
      .optional()
      .transform((v) => (v === '' ? null : v ?? null)),
    localePreference: z.enum(['zh-TW', 'en'], {
      error: t('settings.validation.invalidLocale'),
    }),
    emailNotifications: z.coerce.boolean(),
  })
}
