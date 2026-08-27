import type { ScrapedBrandData } from '@/lib/types/scraper'
import type { PlatformId } from '../../platforms'

export interface PlatformAdapter {
  host: string
  platform?: PlatformId
  matches(url: string): boolean
  parse(html: string, url: string): ScrapedBrandData
}
