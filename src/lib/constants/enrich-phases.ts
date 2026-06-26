export const ENRICH_PHASES = [
  'clean',
  'detect',
  'slugs',
  'tags',
  'discover',
  'links',
  'images',
  'descriptions',
] as const

export const PHASE_LABELS: Record<string, string> = {
  clean: '清理',
  detect: '偵測',
  slugs: '網址',
  tags: '標籤',
  discover: '搜尋',
  links: '連結',
  images: '圖片',
  descriptions: '描述',
}
