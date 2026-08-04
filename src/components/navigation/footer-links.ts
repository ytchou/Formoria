import { localizePath } from '@/i18n/locale-preference'

export function getFooterFullDocumentHref(path: string, locale: string): string {
  return localizePath(path, locale)
}
