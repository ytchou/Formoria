import type { Brand, SiteContent } from '@/lib/types/brand'

type StoryProps = {
  brand: Brand
  story?: SiteContent['story']
}

export function Story({ brand, story }: StoryProps) {
  if (!story) {
    return null
  }

  return (
    <section className="px-6 py-12 md:px-10 md:py-16" aria-labelledby="microsite-story">
      <div className="mx-auto max-w-[1280px]">
        <div className="max-w-3xl space-y-4">
          <h2 id="microsite-story" className="text-base font-bold leading-tight text-foreground">
            品牌故事
          </h2>
          <p className="text-sm leading-[1.7] text-muted-foreground">{story}</p>
          {brand.foundingYear && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              創立於 {brand.foundingYear}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
