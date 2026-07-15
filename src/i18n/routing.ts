import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['zh-TW', 'en'],
  defaultLocale: 'zh-TW',
  localePrefix: 'as-needed',
  localeDetection: false,
  localeCookie: false,
  // Page metadata owns hreflang so locale-ineligible URLs can be omitted.
  alternateLinks: false,
})
