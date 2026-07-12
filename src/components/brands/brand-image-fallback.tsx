import { categoryTint } from '@/lib/taxonomy/ontology'

interface BrandImageFallbackProps {
  name: string
  category: string | null
  size: 'card' | 'detail'
}

export function BrandImageFallback({ name, category, size }: BrandImageFallbackProps) {
  const initial = [...name][0]

  return (
    <div
      data-testid="image-fallback"
      className="flex h-full items-center justify-center"
      style={{ backgroundColor: categoryTint(category) }}
    >
      <span className={`font-bold text-foreground ${size === 'detail' ? 'text-5xl' : 'text-3xl'}`}>
        {initial}
      </span>
    </div>
  )
}
