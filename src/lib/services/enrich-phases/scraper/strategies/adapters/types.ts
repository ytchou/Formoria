import type { ScrapedBrandData } from '@/lib/types/scraper'

export interface PlatformAdapter {
  host: string
  matches(url: string): boolean
  parse(html: string, url: string): ScrapedBrandData
}
