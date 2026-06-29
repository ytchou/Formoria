import { routing } from './routing'

type Locale = (typeof routing.locales)[number]

const messageLoaders: Record<Locale, () => Promise<Record<string, unknown>>> = {
  en: () => import('../../messages/en.json').then((module) => module.default),
  'zh-TW': () =>
    import('../../messages/zh-TW.json').then((module) => module.default),
}

export function loadMessages(locale: Locale) {
  return messageLoaders[locale]()
}
